/**
 * GitTab Utilities
 * Time formatting, helpers, and shared constants.
 */

/**
 * Format a timestamp into a human-readable "time ago" string.
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} e.g. "2m ago", "1h ago", "3d ago"
 */
function timeAgo(timestamp) {
  if (timestamp == null || !Number.isFinite(Number(timestamp))) {
    return '—';
  }
  const now = Date.now();
  const diff = now - Number(timestamp);

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (weeks < 4) return `${weeks}w ago`;
  return `${months}mo ago`;
}

/**
 * Auto-generate a session name from a date.
 * @param {Date} [date] - defaults to now
 * @returns {string} e.g. "session_2026-04-05_0633"
 */
function formatSessionName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `session_${y}-${m}-${d}_${h}${min}`;
}

/**
 * Extract the domain from a URL for display purposes.
 * @param {string} url
 * @returns {string} e.g. "github.com"
 */
function extractDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Whether a tab URL can be committed / counted / discarded (normal web pages).
 * @param {string} url
 * @returns {boolean}
 */
function isCommittableUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim().toLowerCase();
  return (
    !u.startsWith('chrome://') &&
    !u.startsWith('chrome-extension://') &&
    !u.startsWith('about:') &&
    !u.startsWith('edge://')
  );
}

/**
 * Truncate a string to a max length with ellipsis.
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(str, maxLen = 40) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

/**
 * Get the favicon URL using Chrome's built-in favicon service.
 * @param {string} pageUrl - The URL of the page
 * @returns {string} Chrome favicon URL
 */
function getFaviconUrl(pageUrl) {
  try {
    const url = new URL(chrome.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', pageUrl);
    url.searchParams.set('size', '16');
    return url.toString();
  } catch {
    return '';
  }
}

/**
 * Format a tab count into a display string.
 * @param {number} count
 * @returns {string} e.g. "12 tabs", "1 tab"
 */
function formatTabCount(count) {
  return `${count} tab${count !== 1 ? 's' : ''}`;
}

/**
 * Debounce a function.
 * @param {Function} fn
 * @param {number} delay in ms
 * @returns {Function}
 */
function debounce(fn, delay = 200) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// Export
if (typeof globalThis !== 'undefined') {
  globalThis.GitTabUtils = {
    timeAgo,
    formatSessionName,
    extractDomain,
    isCommittableUrl,
    truncate,
    getFaviconUrl,
    formatTabCount,
    debounce
  };
}
