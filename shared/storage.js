/**
 * GitTab Storage API
 * Thin wrapper over chrome.storage.local for managing sessions and tabs.
 */

const STORAGE_KEY = 'gittab_data';
const TRASH_KEY = 'gittab_trash';
const READ_LATER_ID = 'sess_read_later';
const TRASH_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Get the full data object from storage.
 * @returns {Promise<{sessions: Array}>}
 */
async function getData() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || { sessions: [] };
}

/**
 * Persist the full data object to storage.
 * @param {Object} data
 */
async function setData(data) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
  } catch (e) {
    throw new Error(e.message || 'Could not save data (storage may be full)');
  }
}

/**
 * Ensure a "Read Later" session always exists and return it.
 * @returns {Promise<Object>} The Read Later session
 */
async function getReadLaterSession() {
  const data = await getData();
  let session = data.sessions.find(s => s.id === READ_LATER_ID);

  if (!session) {
    session = {
      id: READ_LATER_ID,
      name: 'Read Later',
      createdAt: Date.now(),
      isPinned: true,
      tabs: []
    };
    data.sessions.unshift(session);
    await setData(data);
  }

  return session;
}

/**
 * Add a tab to a specific session.
 * @param {string} sessionId
 * @param {{title: string, url: string, favIconUrl: string}} tabObj
 * @returns {Promise<Object>} The added tab (with generated id)
 */
async function addTabToSession(sessionId, tabObj) {
  const data = await getData();
  let session = data.sessions.find(s => s.id === sessionId);

  if (!session) {
    // If sessionId is READ_LATER_ID, create it
    if (sessionId === READ_LATER_ID) {
      await getReadLaterSession();
      const freshData = await getData();
      session = freshData.sessions.find(s => s.id === READ_LATER_ID);
      // Re-read data so we work with the fresh copy
      Object.assign(data, freshData);
    } else {
      throw new Error(`Session "${sessionId}" not found`);
    }
  }

  const tab = {
    id: generateId('tab'),
    title: tabObj.title || 'Untitled',
    url: tabObj.url,
    favIconUrl: tabObj.favIconUrl || '',
    addedAt: Date.now()
  };

  session.tabs.unshift(tab);
  await setData(data);
  return tab;
}

/**
 * Create a new named session with an array of tabs.
 * @param {string} name
 * @param {Array<{title: string, url: string, favIconUrl: string}>} tabs
 * @returns {Promise<Object>} The created session
 */
async function createSession(name, tabs) {
  const data = await getData();

  const session = {
    id: generateId('sess'),
    name: name,
    createdAt: Date.now(),
    isPinned: false,
    tabs: tabs.map(t => ({
      id: generateId('tab'),
      title: t.title || 'Untitled',
      url: t.url,
      favIconUrl: t.favIconUrl || '',
      addedAt: Date.now()
    }))
  };

  // Insert after "Read Later" if it exists, otherwise at the beginning
  const readLaterIndex = data.sessions.findIndex(s => s.id === READ_LATER_ID);
  if (readLaterIndex >= 0) {
    data.sessions.splice(readLaterIndex + 1, 0, session);
  } else {
    data.sessions.unshift(session);
  }

  await setData(data);
  return session;
}

/**
 * Delete a single tab from a session. Stashes it in trash for undo.
 * @param {string} sessionId
 * @param {string} tabId
 */
async function deleteTab(sessionId, tabId) {
  const data = await getData();
  const session = data.sessions.find(s => s.id === sessionId);
  if (!session) return;

  const removedTab = session.tabs.find(t => t.id === tabId);

  // Stash in trash before removing
  if (removedTab) {
    await setTrash({
      type: 'tab',
      sessionId: sessionId,
      sessionName: session.name,
      tab: { ...removedTab },
      deletedAt: Date.now()
    });
  }

  session.tabs = session.tabs.filter(t => t.id !== tabId);

  // If session is now empty and not pinned, remove it
  if (session.tabs.length === 0 && !session.isPinned) {
    data.sessions = data.sessions.filter(s => s.id !== sessionId);
  }

  await setData(data);
}

/**
 * Delete an entire session. Stashes it in trash for undo.
 * @param {string} sessionId
 */
async function deleteSession(sessionId) {
  const data = await getData();

  if (sessionId === READ_LATER_ID) {
    const session = data.sessions.find(s => s.id === READ_LATER_ID);
    if (session && session.tabs.length > 0) {
      // Stash the cleared tabs
      await setTrash({
        type: 'session-clear',
        sessionId: READ_LATER_ID,
        sessionName: 'Read Later',
        tabs: [...session.tabs],
        deletedAt: Date.now()
      });
      session.tabs = [];
    }
  } else {
    const session = data.sessions.find(s => s.id === sessionId);
    if (session) {
      await setTrash({
        type: 'session',
        session: { ...session, tabs: [...session.tabs] },
        deletedAt: Date.now()
      });
    }
    data.sessions = data.sessions.filter(s => s.id !== sessionId);
  }

  await setData(data);
}

/**
 * Rename a session.
 * @param {string} sessionId
 * @param {string} newName
 */
async function renameSession(sessionId, newName) {
  const trimmed = (newName || '').trim();
  if (!trimmed) {
    throw new Error('Name cannot be empty');
  }
  if (sessionId === READ_LATER_ID) {
    throw new Error('Read Later cannot be renamed');
  }
  const data = await getData();
  const session = data.sessions.find(s => s.id === sessionId);
  if (session) {
    session.name = trimmed;
    await setData(data);
  }
}

/**
 * Get all sessions sorted by most recent first (pinned always on top).
 * @returns {Promise<Array>}
 */
async function getAllSessions() {
  const data = await getData();
  const pinned = data.sessions.filter(s => s.isPinned);
  const unpinned = data.sessions.filter(s => !s.isPinned);

  // Sort unpinned by createdAt descending
  unpinned.sort((a, b) => b.createdAt - a.createdAt);

  return [...pinned, ...unpinned];
}

/**
 * Get the N most recent commits (tabs added) across all sessions.
 * @param {number} count
 * @returns {Promise<Array<{sessionName: string, tab: Object}>>}
 */
async function getRecentCommits(count = 3) {
  const data = await getData();
  const allTabs = [];

  for (const session of data.sessions) {
    for (const tab of session.tabs) {
      allTabs.push({
        sessionName: session.name,
        sessionId: session.id,
        tab
      });
    }
  }

  // Sort by addedAt descending
  allTabs.sort((a, b) => b.tab.addedAt - a.tab.addedAt);
  return allTabs.slice(0, count);
}

/**
 * Generate a unique ID with a prefix.
 * @param {string} prefix e.g. 'sess', 'tab'
 * @returns {string}
 */
function generateId(prefix) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}_${id}`;
}

/* =====================
   Trash / Undo System
   ===================== */

/**
 * Save an item to the single-entry trash.
 * @param {Object} trashItem
 */
async function setTrash(trashItem) {
  try {
    await chrome.storage.local.set({ [TRASH_KEY]: trashItem });
  } catch (e) {
    console.warn('[GitTab] Could not save trash:', e.message);
  }
}

/**
 * Get the current trash item (or null if empty/expired).
 * @returns {Promise<Object|null>}
 */
async function getTrash() {
  const result = await chrome.storage.local.get(TRASH_KEY);
  const trash = result[TRASH_KEY];
  if (!trash) return null;

  // Expire after TRASH_TTL
  if (Date.now() - trash.deletedAt > TRASH_TTL) {
    await clearTrash();
    return null;
  }
  return trash;
}

/**
 * Clear the trash.
 */
async function clearTrash() {
  await chrome.storage.local.remove(TRASH_KEY);
}

/**
 * Undo the last delete by restoring from trash.
 * @returns {Promise<{type: string, name: string}|null>} What was restored
 */
async function undoLastDelete() {
  const trash = await getTrash();
  if (!trash) return null;

  const data = await getData();

  if (trash.type === 'tab') {
    // Restore a single tab back into its session
    let session = data.sessions.find(s => s.id === trash.sessionId);
    if (!session) {
      // Session was also removed (was empty + unpinned), re-create it
      session = {
        id: trash.sessionId,
        name: trash.sessionName || 'Restored Session',
        createdAt: Date.now(),
        isPinned: false,
        tabs: []
      };
      data.sessions.push(session);
    }
    session.tabs.unshift(trash.tab);
    await setData(data);
    await clearTrash();
    return { type: 'tab', name: trash.tab.title };

  } else if (trash.type === 'session') {
    // Restore an entire session
    const readLaterIdx = data.sessions.findIndex(s => s.id === READ_LATER_ID);
    if (readLaterIdx >= 0) {
      data.sessions.splice(readLaterIdx + 1, 0, trash.session);
    } else {
      data.sessions.unshift(trash.session);
    }
    await setData(data);
    await clearTrash();
    return { type: 'session', name: trash.session.name };

  } else if (trash.type === 'session-clear') {
    // Restore cleared Read Later tabs
    let session = data.sessions.find(s => s.id === READ_LATER_ID);
    if (!session) {
      session = {
        id: READ_LATER_ID,
        name: 'Read Later',
        createdAt: Date.now(),
        isPinned: true,
        tabs: []
      };
      data.sessions.unshift(session);
    }
    session.tabs = [...trash.tabs, ...session.tabs];
    await setData(data);
    await clearTrash();
    return { type: 'session-clear', name: 'Read Later' };

  } else if (trash.type === 'commit-tab') {
    // Undo a tab commit: remove from storage, reopen the URL
    const session = data.sessions.find(s => s.id === trash.sessionId);
    if (session) {
      session.tabs = session.tabs.filter(t => t.id !== trash.tab.id);
    }
    await setData(data);
    await clearTrash();
    return { type: 'commit-tab', name: trash.tab.title, url: trash.tab.url };

  } else if (trash.type === 'commit-session') {
    // Undo a session commit: remove session from storage, reopen all URLs
    data.sessions = data.sessions.filter(s => s.id !== trash.session.id);
    await setData(data);
    await clearTrash();
    return {
      type: 'commit-session',
      name: trash.session.name,
      urls: trash.session.tabs.map(t => t.url)
    };
  }

  return null;
}

/* =====================
   Export / Import
   ===================== */

/**
 * Export all data as a JSON string.
 * @returns {Promise<string>}
 */
async function exportData() {
  const data = await getData();
  return JSON.stringify(data, null, 2);
}

/**
 * Import data from a JSON string. Merges with existing data.
 * Imported sessions get new IDs to avoid collisions.
 * Read Later tabs from import merge into existing Read Later.
 * @param {string} jsonString
 * @param {boolean} replaceAll - if true, replaces all existing data
 * @returns {Promise<{sessionsAdded: number, tabsAdded: number}>}
 */
async function importData(jsonString, replaceAll = false) {
  let imported;
  try {
    imported = JSON.parse(jsonString);
  } catch {
    throw new Error('Invalid JSON file');
  }

  if (!imported || !Array.isArray(imported.sessions)) {
    throw new Error('Invalid GitTab backup format: missing sessions array');
  }

  if (replaceAll) {
    // Replace all — give new IDs but keep structure
    const newSessions = imported.sessions.map(s => ({
      ...s,
      id: s.id === READ_LATER_ID ? READ_LATER_ID : generateId('sess'),
      tabs: s.tabs.map(t => ({ ...t, id: generateId('tab') }))
    }));
    await setData({ sessions: newSessions });
    const totalTabs = newSessions.reduce((sum, s) => sum + s.tabs.length, 0);
    return { sessionsAdded: newSessions.length, tabsAdded: totalTabs };
  }

  // Merge strategy
  const data = await getData();
  let sessionsAdded = 0;
  let tabsAdded = 0;

  for (const importedSession of imported.sessions) {
    if (importedSession.id === READ_LATER_ID || importedSession.isPinned) {
      // Merge Read Later tabs into existing Read Later
      await getReadLaterSession(); // ensure it exists
      const freshData = await getData();
      const readLater = freshData.sessions.find(s => s.id === READ_LATER_ID);
      if (readLater) {
        const existingUrls = new Set(readLater.tabs.map(t => t.url));
        for (const tab of importedSession.tabs) {
          if (!existingUrls.has(tab.url)) {
            readLater.tabs.push({ ...tab, id: generateId('tab') });
            tabsAdded++;
          }
        }
        Object.assign(data, freshData);
      }
    } else {
      // Add as a new session with a new ID
      const newSession = {
        ...importedSession,
        id: generateId('sess'),
        tabs: importedSession.tabs.map(t => ({ ...t, id: generateId('tab') }))
      };
      data.sessions.push(newSession);
      sessionsAdded++;
      tabsAdded += newSession.tabs.length;
    }
  }

  await setData(data);
  return { sessionsAdded, tabsAdded };
}

// Export for use in other modules
if (typeof globalThis !== 'undefined') {
  globalThis.GitTabStorage = {
    getData,
    setData,
    getReadLaterSession,
    addTabToSession,
    createSession,
    deleteTab,
    deleteSession,
    renameSession,
    getAllSessions,
    getRecentCommits,
    generateId,
    setTrash,
    getTrash,
    clearTrash,
    undoLastDelete,
    exportData,
    importData,
    READ_LATER_ID,
    TRASH_KEY,
    STORAGE_KEY
  };
}
