/**
 * GitTab Background Service Worker
 * Handles tab operations: commit, discard, and session management.
 * Stays dormant when not processing messages.
 */

// Import shared modules
importScripts('shared/storage.js', 'shared/utils.js');

// Access via namespace to avoid redeclaring identifiers already in global scope from importScripts
const Storage = globalThis.GitTabStorage;
const Utils = globalThis.GitTabUtils;

/** Serialize chrome.storage.local writes to avoid lost updates from concurrent readers/writers. */
let storageMutex = Promise.resolve();

function enqueueStorage(fn) {
  const next = storageMutex.then(() => fn());
  storageMutex = next.catch(() => {});
  return next;
}

/**
 * If removing these tabs would leave the window empty, open the GitTab dashboard first so the window stays open.
 */
async function ensureWindowSurvivesAfterRemovals(windowId, tabIdsToRemove) {
  const tabs = await chrome.tabs.query({ windowId });
  const removeSet = new Set(tabIdsToRemove);
  const staying = tabs.filter(t => !removeSet.has(t.id));
  if (staying.length === 0) {
    await chrome.tabs.create({
      windowId,
      active: true,
      url: chrome.runtime.getURL('dashboard/dashboard.html')
    });
  }
}

/* =====================
   Context Menu Setup
   ===================== */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'gittab-save-tab',
    title: 'Save this tab to GitTab',
    contexts: ['page', 'frame']
  });
  chrome.contextMenus.create({
    id: 'gittab-save-all',
    title: 'Save all tabs in this window',
    contexts: ['page', 'frame']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'gittab-save-tab') {
    if (tab && Utils.isCommittableUrl(tab.url)) {
      await commitCurrentTab({
        tabId: tab.id,
        title: tab.title,
        url: tab.url,
        favIconUrl: tab.favIconUrl || ''
      });
    }
  } else if (info.menuItemId === 'gittab-save-all') {
    if (tab) {
      await commitSession(null, tab.windowId);
    }
  }
});

/* =====================
   Keyboard Shortcuts
   ===================== */

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'commit-current-tab') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && Utils.isCommittableUrl(tab.url)) {
      await commitCurrentTab({
        tabId: tab.id,
        title: tab.title,
        url: tab.url,
        favIconUrl: tab.favIconUrl || ''
      });
    }
  } else if (command === 'commit-all-tabs') {
    const win = await chrome.windows.getCurrent();
    if (win) {
      await commitSession(null, win.id);
    }
  }
});

/* =====================
   Message Handler
   ===================== */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => {
    console.error('[GitTab] Error handling message:', err);
    sendResponse({ success: false, error: err.message });
  });
  return true;
});

async function handleMessage(message) {
  switch (message.action) {
    case 'COMMIT_CURRENT_TAB':
      return commitCurrentTab(message.tabData);

    case 'COMMIT_SESSION':
      return commitSession(message.sessionName, message.windowId);

    case 'DISCARD_INACTIVE':
      return discardInactiveTabs();

    case 'RESTORE_TAB':
      return restoreTab(message.url);

    case 'RESTORE_SESSION':
      return restoreSession(message.tabs);

    case 'RESTORE_SESSION_NEW_WINDOW':
      return restoreSessionNewWindow(message.tabs);

    case 'GET_ACTIVE_TAB':
      return getActiveTab();

    case 'GET_TAB_COUNT':
      return getTabCount(message.windowId);

    case 'DELETE_TAB':
      return enqueueStorage(() => Storage.deleteTab(message.sessionId, message.tabId))
        .then(() => ({ success: true }))
        .catch(err => ({ success: false, error: err.message }));

    case 'DELETE_SESSION':
      return enqueueStorage(() => Storage.deleteSession(message.sessionId))
        .then(() => ({ success: true }))
        .catch(err => ({ success: false, error: err.message }));

    case 'RENAME_SESSION':
      return enqueueStorage(() => Storage.renameSession(message.sessionId, message.newName))
        .then(() => ({ success: true }))
        .catch(err => ({ success: false, error: err.message }));

    case 'UNDO_LAST_ACTION':
      return handleUndo();

    case 'GET_TRASH':
      return handleGetTrash();

    case 'EXPORT_DATA':
      return handleExport();

    case 'IMPORT_DATA':
      return handleImport(message.jsonString, message.replaceAll);

    default:
      return { success: false, error: `Unknown action: ${message.action}` };
  }
}

/* =====================
   Commit Operations
   ===================== */

async function commitCurrentTab(tabData) {
  if (!Utils.isCommittableUrl(tabData?.url)) {
    return { success: false, error: 'Cannot commit this page type' };
  }

  try {
    const tab = await enqueueStorage(async () => {
      await Storage.getReadLaterSession();
      return Storage.addTabToSession(Storage.READ_LATER_ID, {
        title: tabData.title,
        url: tabData.url,
        favIconUrl: tabData.favIconUrl || ''
      });
    });

    // Stash in trash for undo (commit undo = remove from storage + reopen URL)
    await Storage.setTrash({
      type: 'commit-tab',
      sessionId: Storage.READ_LATER_ID,
      tab: { ...tab },
      deletedAt: Date.now()
    });

    if (tabData.tabId) {
      try {
        const { windowId } = await chrome.tabs.get(tabData.tabId);
        await ensureWindowSurvivesAfterRemovals(windowId, [tabData.tabId]);
        await chrome.tabs.remove(tabData.tabId);
      } catch (e) {
        console.warn('[GitTab] Could not close tab:', e.message);
      }
    }

    return { success: true, tab };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function commitSession(sessionName, windowId) {
  if (windowId == null) {
    return { success: false, error: 'No window' };
  }

  const tabs = await chrome.tabs.query({ windowId });

  const committable = tabs.filter(tab =>
    !tab.pinned &&
    tab.url &&
    Utils.isCommittableUrl(tab.url)
  );

  if (committable.length === 0) {
    return { success: false, error: 'No tabs to commit' };
  }

  const name = sessionName || Utils.formatSessionName(new Date());

  try {
    const session = await enqueueStorage(() =>
      Storage.createSession(name, committable.map(t => ({
        title: t.title,
        url: t.url,
        favIconUrl: t.favIconUrl || ''
      })))
    );

    // Stash in trash for undo (commit undo = remove session + reopen URLs)
    await Storage.setTrash({
      type: 'commit-session',
      session: { ...session },
      deletedAt: Date.now()
    });

    const tabIds = committable.map(t => t.id);
    try {
      await ensureWindowSurvivesAfterRemovals(windowId, tabIds);
      await chrome.tabs.remove(tabIds);
    } catch (e) {
      console.warn('[GitTab] Could not close some tabs:', e.message);
    }

    return { success: true, session };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/* =====================
   Restore Operations
   ===================== */

async function restoreTab(url) {
  const tab = await chrome.tabs.create({ url, active: true });
  return { success: true, tabId: tab.id };
}

async function restoreSession(tabs) {
  for (let i = 0; i < tabs.length; i++) {
    await chrome.tabs.create({ url: tabs[i].url, active: i === 0 });
  }
  return { success: true, restoredCount: tabs.length };
}

/**
 * Restore all tabs in a new window, preserving order.
 */
async function restoreSessionNewWindow(tabs) {
  if (!tabs || tabs.length === 0) {
    return { success: false, error: 'No tabs to restore' };
  }

  // Create window with the first tab
  const win = await chrome.windows.create({ url: tabs[0].url, focused: true });

  // Add remaining tabs in order
  for (let i = 1; i < tabs.length; i++) {
    await chrome.tabs.create({
      windowId: win.id,
      url: tabs[i].url,
      active: false,
      index: i
    });
  }

  return { success: true, restoredCount: tabs.length, windowId: win.id };
}

/* =====================
   Memory Management
   ===================== */

async function discardInactiveTabs() {
  const tabs = await chrome.tabs.query({ active: false, discarded: false });
  let discarded = 0;

  for (const tab of tabs) {
    if (tab.url && Utils.isCommittableUrl(tab.url)) {
      try {
        await chrome.tabs.discard(tab.id);
        discarded++;
      } catch (e) {
        // Some tabs can't be discarded
      }
    }
  }

  return { success: true, discardedCount: discarded };
}

/* =====================
   Tab Info
   ===================== */

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    return {
      success: true,
      tab: {
        tabId: tab.id,
        title: tab.title,
        url: tab.url,
        favIconUrl: tab.favIconUrl || ''
      }
    };
  }
  return { success: false, error: 'No active tab' };
}

async function getTabCount(windowId) {
  if (windowId == null) {
    return { success: false, error: 'No window', count: 0, total: 0 };
  }

  const tabs = await chrome.tabs.query({ windowId });
  const committable = tabs.filter(t =>
    !t.pinned &&
    t.url &&
    Utils.isCommittableUrl(t.url)
  );
  return { success: true, count: committable.length, total: tabs.length };
}

/* =====================
   Undo / Trash
   ===================== */

async function handleUndo() {
  try {
    const result = await enqueueStorage(() => Storage.undoLastDelete());
    if (!result) {
      return { success: false, error: 'Nothing to undo' };
    }

    // For commit undos, reopen the tabs
    if (result.type === 'commit-tab' && result.url) {
      await chrome.tabs.create({ url: result.url, active: true });
    } else if (result.type === 'commit-session' && result.urls) {
      for (const url of result.urls) {
        await chrome.tabs.create({ url, active: false });
      }
    }

    return { success: true, restored: result };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleGetTrash() {
  const trash = await Storage.getTrash();
  return { success: true, trash };
}

/* =====================
   Export / Import
   ===================== */

async function handleExport() {
  try {
    const json = await Storage.exportData();
    return { success: true, json };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleImport(jsonString, replaceAll = false) {
  try {
    const result = await enqueueStorage(() => Storage.importData(jsonString, replaceAll));
    return { success: true, ...result };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

