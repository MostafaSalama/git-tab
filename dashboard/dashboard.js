/**
 * GitTab Dashboard Logic
 * Full repository view: search, browse, restore, rename, and delete sessions/tabs.
 */

const { GitTabStorage, GitTabUtils } = globalThis;

// DOM references
const elements = {
  sessionsList:     document.getElementById('sessions-list'),
  searchInput:      document.getElementById('search-input'),
  searchClear:      document.getElementById('search-clear'),
  searchResultsInfo: document.getElementById('search-results-info'),
  totalSessions:    document.getElementById('total-sessions'),
  totalTabs:        document.getElementById('total-tabs'),
  btnDiscard:       document.getElementById('btn-discard'),
  toast:            document.getElementById('toast'),
  confirmOverlay:   document.getElementById('confirm-overlay'),
  confirmTitle:     document.getElementById('confirm-title'),
  confirmMessage:   document.getElementById('confirm-message'),
  confirmOk:        document.getElementById('confirm-ok'),
  confirmCancel:    document.getElementById('confirm-cancel'),
};

// State
let allSessions = [];
let filteredSessions = null;
let expandedSessions = new Set();
let confirmCallback = null;

/* =====================
   Initialization
   ===================== */

document.addEventListener('DOMContentLoaded', async () => {
  await loadSessions();
  bindEvents();
  // Focus search on load
  elements.searchInput.focus();
});

// Listen for storage changes (e.g., from popup commits)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[GitTabStorage.STORAGE_KEY]) {
    loadSessions();
  }
});

/* =====================
   Data Loading
   ===================== */

async function loadSessions() {
  allSessions = await GitTabStorage.getAllSessions();
  updateStats();

  if (filteredSessions !== null) {
    // Re-apply current search
    performSearch(elements.searchInput.value);
  } else {
    renderSessions(allSessions);
  }
}

function updateStats() {
  let totalTabs = 0;
  for (const s of allSessions) {
    totalTabs += s.tabs.length;
  }
  elements.totalSessions.textContent = allSessions.length;
  elements.totalTabs.textContent = totalTabs;
}

/* =====================
   Rendering
   ===================== */

function renderSessions(sessions) {
  if (sessions.length === 0 && !elements.searchInput.value) {
    renderEmptyState();
    return;
  }

  if (sessions.length === 0 && elements.searchInput.value) {
    renderNoResults();
    return;
  }

  elements.sessionsList.innerHTML = sessions.map(session => renderSessionCard(session)).join('');

  // Re-apply expanded states
  for (const id of expandedSessions) {
    const card = document.querySelector(`[data-session-id="${id}"]`);
    if (card) card.classList.add('expanded');
  }
}

function renderSessionCard(session) {
  const isPinned = session.isPinned ? 'session-card--pinned' : '';
  const isExpanded = expandedSessions.has(session.id) ? 'expanded' : '';
  const icon = session.isPinned ? 'bookmark' : 'folder';
  const tabCountText = GitTabUtils.formatTabCount(session.tabs.length);
  const timeText = GitTabUtils.timeAgo(session.createdAt);

  const tabsHtml = session.tabs.map(tab => renderTabItem(session.id, tab)).join('');

  return `
    <div class="session-card ${isPinned} ${isExpanded}" data-session-id="${session.id}">
      <div class="session-header" data-action="toggle" data-session-id="${session.id}">
        <div class="session-header-left">
          <span class="material-symbols-outlined session-icon">${icon}</span>
          <span class="session-name" id="session-name-${session.id}" title="${escapeHtml(session.name)}">${escapeHtml(session.name)}</span>
        </div>
        <div class="session-meta">
          <span class="session-tab-count">${tabCountText}</span>
          <span class="session-time">${timeText}</span>
          <div class="session-actions">
            <button class="session-action-btn" data-action="restore-session" data-session-id="${session.id}" title="Restore all tabs">
              <span class="material-symbols-outlined" style="font-size:18px;">open_in_new</span>
            </button>
            ${session.id === GitTabStorage.READ_LATER_ID ? '' : `
            <button class="session-action-btn" data-action="rename-session" data-session-id="${session.id}" title="Rename session">
              <span class="material-symbols-outlined" style="font-size:18px;">edit</span>
            </button>
            `}
            <button class="session-action-btn session-action-btn--danger" data-action="delete-session" data-session-id="${session.id}" title="Delete session">
              <span class="material-symbols-outlined" style="font-size:18px;">delete</span>
            </button>
          </div>
          <span class="material-symbols-outlined session-chevron">expand_more</span>
        </div>
      </div>
      <div class="session-tabs">
        <div class="tabs-container">
          ${tabsHtml || '<p style="font-family: Space Grotesk, monospace; font-size: 12px; color: var(--outline); padding: 12px 0;">No tabs in this session</p>'}
        </div>
      </div>
    </div>
  `;
}

function renderTabItem(sessionId, tab) {
  const domain = GitTabUtils.extractDomain(tab.url);
  const faviconUrl = GitTabUtils.getFaviconUrl(tab.url);

  return `
    <div class="tab-item" data-tab-id="${tab.id}" data-session-id="${sessionId}">
      ${faviconUrl
        ? `<img class="tab-favicon" src="${faviconUrl}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="tab-favicon-placeholder" style="display:none"><span class="material-symbols-outlined" style="font-size:10px;">language</span></div>`
        : `<div class="tab-favicon-placeholder"><span class="material-symbols-outlined" style="font-size:10px;">language</span></div>`
      }
      <div class="tab-info" data-action="open-tab" data-url="${escapeHtml(tab.url)}" title="${escapeHtml(tab.title)}&#10;${escapeHtml(tab.url)}">
        <div class="tab-title">${escapeHtml(tab.title)}</div>
        <div class="tab-url">${escapeHtml(domain)}</div>
      </div>
      <div class="tab-actions">
        <button class="tab-action-btn tab-action-btn--open" data-action="open-tab" data-url="${escapeHtml(tab.url)}" title="Open tab">
          <span class="material-symbols-outlined" style="font-size:16px;">open_in_new</span>
        </button>
        <button class="tab-action-btn tab-action-btn--danger" data-action="delete-tab" data-tab-id="${tab.id}" data-session-id="${sessionId}" title="Delete tab">
          <span class="material-symbols-outlined" style="font-size:16px;">close</span>
        </button>
      </div>
    </div>
  `;
}

function renderEmptyState() {
  elements.sessionsList.innerHTML = `
    <div class="empty-state">
      <span class="material-symbols-outlined empty-icon">inventory_2</span>
      <h2 class="empty-title">Your repository is empty</h2>
      <p class="empty-text">
        Click the GitTab icon in your browser toolbar to start committing tabs and sessions.
        They'll appear here for browsing and restoring.
      </p>
    </div>
  `;
}

function renderNoResults() {
  elements.sessionsList.innerHTML = `
    <div class="no-results">
      <span class="material-symbols-outlined no-results-icon">search_off</span>
      <p class="no-results-text">No tabs match your search</p>
    </div>
  `;
}

/* =====================
   Search
   ===================== */

const debouncedSearch = GitTabUtils.debounce((query) => {
  performSearch(query);
}, 150);

function performSearch(query) {
  const q = query.trim().toLowerCase();

  if (!q) {
    filteredSessions = null;
    elements.searchClear.classList.remove('visible');
    elements.searchResultsInfo.classList.remove('visible');
    renderSessions(allSessions);
    return;
  }

  elements.searchClear.classList.add('visible');

  // Filter sessions: keep sessions with at least one matching tab
  filteredSessions = [];
  let totalMatches = 0;

  for (const session of allSessions) {
    const matchingTabs = session.tabs.filter(tab =>
      (tab.title && tab.title.toLowerCase().includes(q)) ||
      (tab.url && tab.url.toLowerCase().includes(q))
    );

    if (matchingTabs.length > 0 || session.name.toLowerCase().includes(q)) {
      filteredSessions.push({
        ...session,
        tabs: matchingTabs.length > 0 ? matchingTabs : session.tabs
      });
      totalMatches += matchingTabs.length || session.tabs.length;
    }
  }

  // Show results info
  elements.searchResultsInfo.textContent = `Found ${totalMatches} tab${totalMatches !== 1 ? 's' : ''} in ${filteredSessions.length} session${filteredSessions.length !== 1 ? 's' : ''}`;
  elements.searchResultsInfo.classList.add('visible');

  // Auto-expand filtered sessions
  for (const s of filteredSessions) {
    expandedSessions.add(s.id);
  }

  renderSessions(filteredSessions);
}

/* =====================
   Event Handlers
   ===================== */

function bindEvents() {
  // Search
  elements.searchInput.addEventListener('input', (e) => {
    debouncedSearch(e.target.value);
  });

  elements.searchClear.addEventListener('click', () => {
    elements.searchInput.value = '';
    performSearch('');
    elements.searchInput.focus();
  });

  // Discard inactive tabs
  elements.btnDiscard.addEventListener('click', async () => {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'DISCARD_INACTIVE' });
      if (response?.success) {
        showToast(`Discarded ${response.discardedCount} inactive tab${response.discardedCount !== 1 ? 's' : ''} ✓`);
      } else {
        showToast(response?.error ?? 'Failed to discard tabs');
      }
    } catch (e) {
      showToast('Failed to discard tabs');
    }
  });

  // Confirm dialog buttons
  elements.confirmCancel.addEventListener('click', closeConfirm);
  elements.confirmOverlay.addEventListener('click', (e) => {
    if (e.target === elements.confirmOverlay) closeConfirm();
  });
  elements.confirmOk.addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    closeConfirm();
  });

  // Delegated click handler for all session/tab actions
  elements.sessionsList.addEventListener('click', handleSessionListClick);

  // Keyboard shortcut: Escape to clear search
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (elements.searchInput.value) {
        elements.searchInput.value = '';
        performSearch('');
      }
    }
    // Ctrl/Cmd + K to focus search
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      elements.searchInput.focus();
      elements.searchInput.select();
    }
  });
}

/**
 * Delegated click handler for the sessions list.
 */
function handleSessionListClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;

  switch (action) {
    case 'toggle':
      toggleSession(target.dataset.sessionId);
      break;

    case 'restore-session':
      e.stopPropagation();
      restoreSession(target.dataset.sessionId);
      break;

    case 'rename-session':
      e.stopPropagation();
      startRenameSession(target.dataset.sessionId);
      break;

    case 'delete-session':
      e.stopPropagation();
      confirmDeleteSession(target.dataset.sessionId);
      break;

    case 'open-tab':
      e.stopPropagation();
      openTab(target.dataset.url);
      break;

    case 'delete-tab':
      e.stopPropagation();
      handleDeleteTab(target.dataset.sessionId, target.dataset.tabId);
      break;
  }
}

function toggleSession(sessionId) {
  if (expandedSessions.has(sessionId)) {
    expandedSessions.delete(sessionId);
  } else {
    expandedSessions.add(sessionId);
  }

  const card = document.querySelector(`[data-session-id="${sessionId}"].session-card`);
  if (card) card.classList.toggle('expanded');
}

async function restoreSession(sessionId) {
  const session = allSessions.find(s => s.id === sessionId);
  if (!session || session.tabs.length === 0) {
    showToast('No tabs to restore');
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'RESTORE_SESSION',
      tabs: session.tabs
    });

    if (response?.success) {
      showToast(`Restored ${response.restoredCount} tabs ✓`);
    } else {
      showToast(response?.error ?? 'Failed to restore session');
    }
  } catch (e) {
    showToast('Failed to restore session');
  }
}

function startRenameSession(sessionId) {
  if (sessionId === GitTabStorage.READ_LATER_ID) {
    showToast('Read Later cannot be renamed');
    return;
  }

  const nameEl = document.getElementById(`session-name-${sessionId}`);
  if (!nameEl) return;

  const currentName = nameEl.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'session-name-input';
  input.value = currentName;

  nameEl.replaceWith(input);
  input.focus();
  input.select();

  const finishRename = async () => {
    const newName = input.value.trim();
    if (newName && newName !== currentName) {
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'RENAME_SESSION',
          sessionId,
          newName
        });
        if (response?.success) {
          showToast('Session renamed ✓');
        } else {
          showToast(response?.error ?? 'Could not rename session');
        }
      } catch (e) {
        showToast('Could not rename session');
      }
    }
    await loadSessions();
  };

  input.addEventListener('blur', finishRename);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { input.blur(); }
    if (e.key === 'Escape') { input.value = currentName; input.blur(); }
  });
}

function confirmDeleteSession(sessionId) {
  const session = allSessions.find(s => s.id === sessionId);
  if (!session) return;

  const isReadLater = session.id === GitTabStorage.READ_LATER_ID;
  const title = isReadLater ? 'Clear Read Later?' : 'Delete Session?';
  const message = isReadLater
    ? `This will remove all ${session.tabs.length} tabs from Read Later.`
    : `This will permanently delete "${session.name}" and its ${session.tabs.length} tabs.`;

  showConfirm(title, message, async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'DELETE_SESSION',
        sessionId
      });
      if (!response?.success) {
        showToast(response?.error ?? 'Could not delete session');
        return;
      }
      expandedSessions.delete(sessionId);
      showToast(isReadLater ? 'Read Later cleared ✓' : 'Session deleted ✓');
      await loadSessions();
    } catch (e) {
      showToast('Could not delete session');
    }
  });
}

async function openTab(url) {
  if (!url) return;
  try {
    const response = await chrome.runtime.sendMessage({ action: 'RESTORE_TAB', url });
    if (response?.success) return;
    showToast(response?.error ?? 'Could not open tab');
    chrome.tabs.create({ url });
  } catch (e) {
    chrome.tabs.create({ url });
  }
}

async function handleDeleteTab(sessionId, tabId) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'DELETE_TAB',
      sessionId,
      tabId
    });
    if (!response?.success) {
      showToast(response?.error ?? 'Could not delete tab');
      return;
    }
  } catch (e) {
    showToast('Could not delete tab');
    return;
  }

  const tabEl = document.querySelector(`[data-tab-id="${tabId}"]`);
  if (tabEl) {
    tabEl.style.transition = 'all 200ms ease';
    tabEl.style.opacity = '0';
    tabEl.style.transform = 'translateX(-10px)';
    tabEl.style.maxHeight = '0';
    tabEl.style.padding = '0';
    tabEl.style.margin = '0';
    setTimeout(() => loadSessions(), 220);
  } else {
    await loadSessions();
  }
}

/* =====================
   Confirm Dialog
   ===================== */

function showConfirm(title, message, callback) {
  elements.confirmTitle.textContent = title;
  elements.confirmMessage.textContent = message;
  confirmCallback = callback;
  elements.confirmOverlay.classList.add('visible');
}

function closeConfirm() {
  elements.confirmOverlay.classList.remove('visible');
  confirmCallback = null;
}

/* =====================
   Helpers
   ===================== */

function showToast(message, duration = 2500) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  setTimeout(() => elements.toast.classList.remove('show'), duration);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
