# Privacy Policy for GitTab

**Last updated: April 5, 2026**

## Overview

GitTab is a browser extension that helps you save, organize, and restore your browser tabs. We are committed to protecting your privacy.

## Data Collection

**GitTab does not collect, transmit, or share any user data.**

- All saved tab data (URLs, titles, session names) is stored exclusively on your local machine using Chrome's `chrome.storage.local` API.
- No data is ever sent to external servers, analytics services, or third parties.
- No personal information is collected at any time.

## Permissions

GitTab requests the following browser permissions, all used exclusively for local functionality:

| Permission | Purpose |
|---|---|
| `tabs` | Read tab URLs/titles for saving, close tabs after committing, discard inactive tabs |
| `windows` | Open restored sessions in a new browser window |
| `storage` | Save and retrieve tab session data locally on your device |
| `favicon` | Display website favicons in the dashboard |
| `contextMenus` | Provide right-click menu items for quick tab saving |

## Data Storage

- All data is stored locally in your browser using `chrome.storage.local`.
- Data persists across browser restarts but is tied to your Chrome profile.
- You can export your data as a JSON file and import it into another browser or profile.
- Clearing browser data or uninstalling the extension will permanently delete all saved sessions.

## Third-Party Services

GitTab uses **Google Fonts** (Inter, Space Grotesk, Material Symbols) loaded via standard CDN links. Google's font service may log standard web request data (IP address, user agent) as described in [Google's Privacy Policy](https://policies.google.com/privacy). No other third-party services are used.

## Changes to This Policy

We may update this privacy policy from time to time. Any changes will be reflected in the "Last updated" date above.

## Contact

If you have questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/MostafaSalama/git-tab).
