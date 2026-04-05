/**
 * GitTab Popup Logic
 * Handles all user interactions in the popup action menu.
 */

const { GitTabStorage, GitTabUtils } = globalThis;

// DOM references
const elements = {
  currentTargetUrl: document.getElementById('current-target-url'),
  tabCountLabel:    document.getElementById('tab-count-label'),
  btnCommitTab:     document.getElementById('btn-commit-tab'),
  btnCommitSession: document.getElementById('btn-commit-session'),
  btnOpenRepo:      document.getElementById('btn-open-repo'),
  sessionNameWrapper: document.getElementById('session-name-wrapper'),
  sessionNameInput: document.getElementById('session-name-input'),
  btnSessionConfirm: document.getElementById('btn-session-confirm'),
  btnSessionCancel: document.getElementById('btn-session-cancel'),
  recentList:       document.getElementById('recent-list'),
  toast:            document.getElementById('toast'),
};

// Current tab data (cached on load)
let activeTabData = null;
let currentWindowId = null;

/* =====================
   Initialization
   ===================== */

document.addEventListener('DOMContentLoaded', async () => {
  await loadActiveTab();
  await loadTabCount();
  await loadRecentCommits();
  bindEvents();
});

/**
 * Load the currently active tab info and display in the header chip.
 */
async function loadActiveTab() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'GET_ACTIVE_TAB' });
    if (response?.success) {
      activeTabData = response.tab;
      const domain = GitTabUtils.extractDomain(activeTabData.url);
      elements.currentTargetUrl.textContent = domain;
      elements.currentTargetUrl.title = activeTabData.url;
    } else {
      elements.currentTargetUrl.textContent = 'No active tab';
    }
  } catch (e) {
    elements.currentTargetUrl.textContent = 'Error loading tab';
    console.error('[GitTab Popup] loadActiveTab error:', e);
  }
}

/**
 * Load the count of committable tabs in the current window.
 */
async function loadTabCount() {
  try {
    const win = await chrome.windows.getCurrent();
    currentWindowId = win?.id ?? null;

    if (currentWindowId == null) {
      elements.tabCountLabel.textContent = 'Could not detect this window';
      return;
    }

    const response = await chrome.runtime.sendMessage({
      action: 'GET_TAB_COUNT',
      windowId: currentWindowId
    });

    if (response?.success) {
      elements.tabCountLabel.textContent =
        `Bundle all ${response.count} open tabs into a snapshot`;
    } else {
      elements.tabCountLabel.textContent =
        response?.error ? `Tabs: ${response.error}` : 'Could not count tabs';
    }
  } catch (e) {
    console.error('[GitTab Popup] loadTabCount error:', e);
    elements.tabCountLabel.textContent = 'Could not count tabs';
  }
}

/**
 * Load the 3 most recent commits and render them.
 */
async function loadRecentCommits() {
  try {
    const commits = await GitTabStorage.getRecentCommits(3);

    if (commits.length === 0) {
      elements.recentList.innerHTML = '<p class="recent-empty">No commits yet</p>';
      return;
    }

    elements.recentList.innerHTML = commits.map(commit => `
      <div class="recent-item">
        <div class="recent-item-left">
          <span class="material-symbols-outlined recent-item-icon">history</span>
          <span class="recent-item-name" title="${escapeHtml(commit.tab.title)}">
            ${escapeHtml(GitTabUtils.truncate(commit.tab.title, 20))}
          </span>
        </div>
        <span class="recent-item-time">${GitTabUtils.timeAgo(commit.tab.addedAt)}</span>
      </div>
    `).join('');
  } catch (e) {
    console.error('[GitTab Popup] loadRecentCommits error:', e);
  }
}

/* =====================
   Event Handlers
   ===================== */

function bindEvents() {
  // Commit Current Tab
  elements.btnCommitTab.addEventListener('click', handleCommitTab);

  // Commit Session — show naming input
  elements.btnCommitSession.addEventListener('click', handleShowSessionInput);

  // Session name confirm
  elements.btnSessionConfirm.addEventListener('click', handleCommitSession);

  // Session name cancel
  elements.btnSessionCancel.addEventListener('click', handleCancelSession);

  // Enter key in session name input
  elements.sessionNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleCommitSession();
    if (e.key === 'Escape') handleCancelSession();
  });

  // Open Repository
  elements.btnOpenRepo.addEventListener('click', handleOpenRepo);
}

/**
 * Commit the active tab to "Read Later" and close it.
 */
async function handleCommitTab() {
  if (!activeTabData) {
    showToast('No active tab to commit');
    return;
  }

  if (!GitTabUtils.isCommittableUrl(activeTabData.url)) {
    showToast('Cannot commit this page type');
    return;
  }

  setButtonLoading(elements.btnCommitTab, true);

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'COMMIT_CURRENT_TAB',
      tabData: activeTabData
    });

    if (response?.success) {
      showUndoToast('Tab committed ✓');
      setTimeout(() => loadRecentCommits(), 300);
    } else {
      showToast('Error: ' + (response?.error ?? 'Something went wrong'));
    }
  } catch (e) {
    showToast('Failed to commit tab');
    console.error('[GitTab Popup] commitTab error:', e);
  } finally {
    setButtonLoading(elements.btnCommitTab, false);
  }
}

/**
 * Show the session name input form.
 */
function handleShowSessionInput() {
  const autoName = GitTabUtils.formatSessionName(new Date());
  elements.sessionNameInput.value = autoName;
  elements.sessionNameWrapper.classList.add('visible');
  elements.sessionNameInput.focus();
  elements.sessionNameInput.select();
}

/**
 * Cancel session commit and hide input.
 */
function handleCancelSession() {
  elements.sessionNameWrapper.classList.remove('visible');
  elements.sessionNameInput.value = '';
}

/**
 * Confirm and commit the entire session.
 */
async function handleCommitSession() {
  const name = elements.sessionNameInput.value.trim();
  if (!name) {
    elements.sessionNameInput.focus();
    return;
  }

  if (currentWindowId == null) {
    showToast('Could not detect this window');
    return;
  }

  setButtonLoading(elements.btnSessionConfirm, true, 'Committing…');

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'COMMIT_SESSION',
      sessionName: name,
      windowId: currentWindowId
    });

    if (response?.success) {
      showUndoToast(`Session committed: ${response.session.tabs.length} tabs ✓`);
      handleCancelSession();
      setTimeout(() => loadRecentCommits(), 300);
    } else {
      showToast('Error: ' + (response?.error ?? 'Something went wrong'));
    }
  } catch (e) {
    showToast('Failed to commit session');
    console.error('[GitTab Popup] commitSession error:', e);
  } finally {
    setButtonLoading(elements.btnSessionConfirm, false, 'Commit');
  }
}

/**
 * Open the dashboard in a new tab.
 */
function handleOpenRepo() {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  window.close();
}

/* =====================
   Helpers
   ===================== */

/**
 * Show a toast notification.
 */
function showToast(message, duration = 2500) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  setTimeout(() => elements.toast.classList.remove('show'), duration);
}

/**
 * Set a button's loading state.
 */
function setButtonLoading(btn, loading, text) {
  if (loading) {
    btn.style.pointerEvents = 'none';
    btn.style.opacity = '0.7';
    if (text) btn.innerHTML = `<span class="spinner"></span> ${text}`;
  } else {
    btn.style.pointerEvents = '';
    btn.style.opacity = '';
    if (text) btn.textContent = text;
  }
}

/**
 * Escape HTML to prevent XSS in dynamic content.
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

/**
 * Show a toast with an Undo link after commits.
 */
function showUndoToast(message, duration = 4000) {
  elements.toast.innerHTML = `
    ${escapeHtml(message)}
    <span class="toast-undo" style="margin-left:12px;text-decoration:underline;cursor:pointer;opacity:0.8">Undo</span>
  `;
  elements.toast.classList.add('show');

  const undoLink = elements.toast.querySelector('.toast-undo');
  if (undoLink) {
    undoLink.addEventListener('click', async () => {
      try {
        const resp = await chrome.runtime.sendMessage({ action: 'UNDO_LAST_ACTION' });
        if (resp?.success) {
          showToast('Undone ✓');
          setTimeout(() => loadRecentCommits(), 300);
        } else {
          showToast(resp?.error ?? 'Undo failed');
        }
      } catch {
        showToast('Undo failed');
      }
    }, { once: true });
  }

  setTimeout(() => elements.toast.classList.remove('show'), duration);
}
