/**
 * GitTab Storage API
 * Thin wrapper over chrome.storage.local for managing sessions and tabs.
 */

const STORAGE_KEY = 'gittab_data';
const READ_LATER_ID = 'sess_read_later';

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
 * Delete a single tab from a session.
 * @param {string} sessionId
 * @param {string} tabId
 */
async function deleteTab(sessionId, tabId) {
  const data = await getData();
  const session = data.sessions.find(s => s.id === sessionId);
  if (!session) return;

  session.tabs = session.tabs.filter(t => t.id !== tabId);

  // If session is now empty and not pinned, remove it
  if (session.tabs.length === 0 && !session.isPinned) {
    data.sessions = data.sessions.filter(s => s.id !== sessionId);
  }

  await setData(data);
}

/**
 * Delete an entire session.
 * @param {string} sessionId
 */
async function deleteSession(sessionId) {
  // Don't allow deleting the Read Later session itself, just clear it
  const data = await getData();

  if (sessionId === READ_LATER_ID) {
    const session = data.sessions.find(s => s.id === READ_LATER_ID);
    if (session) session.tabs = [];
  } else {
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

// Export for use in other modules (ES module style, loaded via <script>)
// In a Chrome extension context, we use globalThis to share across files
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
    READ_LATER_ID,
    STORAGE_KEY
  };
}
