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
 * @param {number} windowId
 * @param {number[]} tabIdsToRemove
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

/**
 * Message handler — all popup/dashboard communication goes through here.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => {
    console.error('[GitTab] Error handling message:', err);
    sendResponse({ success: false, error: err.message });
  });
  return true; // Keep the message channel open for async response
});

/**
 * Route messages to the appropriate handler.
 * @param {Object} message
 * @returns {Promise<Object>}
 */
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

    default:
      return { success: false, error: `Unknown action: ${message.action}` };
  }
}

/**
 * Commit the current active tab to "Read Later" and close it.
 */
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

/**
 * Commit all tabs in the current window as a new session and close them.
 * Skips pinned tabs and non-committable URLs.
 */
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

/**
 * Discard inactive tabs to free memory (without closing them).
 */
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

/**
 * Restore a single tab by opening its URL.
 */
async function restoreTab(url) {
  const tab = await chrome.tabs.create({ url, active: true });
  return { success: true, tabId: tab.id };
}

/**
 * Restore all tabs in a session (first tab is focused).
 */
async function restoreSession(tabs) {
  for (let i = 0; i < tabs.length; i++) {
    await chrome.tabs.create({ url: tabs[i].url, active: i === 0 });
  }
  return { success: true, restoredCount: tabs.length };
}

/**
 * Get info about the currently active tab.
 */
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

/**
 * Get the count of open (non-pinned) committable tabs in a window.
 */
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
