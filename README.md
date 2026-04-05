# <img src="icons/icon48.png" width="28" align="top" /> GitTab

**Save, organize, and restore your browser tabs like Git commits.**

GitTab is a lightweight, high-performance Chrome extension that solves tab overload and excessive memory consumption. Capture snapshots ("commits") of your open tabs, safely close them to free up system resources, and quickly restore them from a centralized, searchable dashboard.

---

## ✨ Features

### Popup Action Menu
- **Commit Current Tab** — Save the active tab to your "Read Later" list and close it instantly
- **Commit Entire Session** — Bundle all open tabs into a named snapshot and close them to free RAM
- **Open Repository** — Jump to the full dashboard to browse all your saved sessions
- **Undo** — Toast with clickable "Undo" link appears after every commit

### Context Menu & Keyboard Shortcuts
- **Right-click menu** — "Save this tab to GitTab" and "Save all tabs in this window" on any page
- **`Alt+S`** — Commit current tab without opening the popup
- **`Alt+Shift+S`** — Commit all tabs in the current window
- **Customizable** — Remap shortcuts at `chrome://extensions/shortcuts`

### Dashboard (The Repository)
- **Browse Sessions** — View all saved sessions as expandable cards with tab counts and timestamps
- **Real-time Search** — Filter across all sessions by tab title or URL in under 500ms
- **Restore** — Re-open a single tab or an entire session, in the current window or a **new window**
- **Rename & Delete** — Inline rename sessions, delete individual tabs or full sessions
- **Undo / Trash** — Floating "Undo" button recovers the last deleted or committed item (30-min window)
- **Export** — Download all your saved sessions as a `gittab_backup_YYYY-MM-DD.json` file
- **Import** — Upload a backup JSON to merge sessions into your existing data (no overwrites)
- **Memory Management** — Discard inactive browser tabs to free RAM without closing them

### Privacy First
- 🔒 **100% local storage** — All data stays on your machine via `chrome.storage.local`
- 🚫 **No external requests** — Zero tracking, analytics, or remote databases
- 💤 **Zero background drain** — Service worker stays dormant when not in use

---

## 📸 Screenshots

<table>
  <tr>
    <td align="center"><strong>Popup</strong></td>
    <td align="center"><strong>Dashboard</strong></td>
  </tr>
  <tr>
    <td><img src="screenshots/popup-preview.png" width="280" alt="GitTab Popup" /></td>
    <td><img src="screenshots/dashboard-preview.png" width="500" alt="GitTab Dashboard" /></td>
  </tr>
</table>

---

## 🚀 Installation

### From Source (Developer Mode)

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/git-tab.git
   ```

2. **Open Chrome Extensions**
   - Navigate to `chrome://extensions/`
   - Enable **Developer mode** (toggle in the top-right corner)

3. **Load the extension**
   - Click **"Load unpacked"**
   - Select the `git-tab` project directory

4. **Pin it** — Click the puzzle icon in Chrome's toolbar and pin GitTab for quick access

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Alt+S` | Commit current tab to Read Later |
| `Alt+Shift+S` | Commit all tabs in this window |

Customize at `chrome://extensions/shortcuts`.

---

## 🏗️ Architecture

```
git-tab/
├── manifest.json              # Manifest V3 configuration
├── background.js              # Service worker (tab ops, context menu, shortcuts)
├── popup/
│   ├── popup.html             # Extension popup (350×480)
│   ├── popup.css              # Design system + popup styles
│   └── popup.js               # Popup interaction logic
├── dashboard/
│   ├── dashboard.html         # Full-page repository view
│   ├── dashboard.css          # Dashboard styles
│   └── dashboard.js           # Search, restore, export/import, undo logic
├── shared/
│   ├── storage.js             # Chrome storage API wrapper + trash + export/import
│   └── utils.js               # Time formatting, ID gen, helpers
├── icons/                     # Extension icons (16, 48, 128px)
```

### Data Flow

```
                              ┌──────────────────┐
  Right-click / Alt+S ───────▶│                  │
                              │                  │   chrome.tabs
  ┌─────────┐  sendMessage   │  Background       │──────────────▶ Browser Tabs
  │  Popup   │──────────────▶│  Service Worker   │
  └─────────┘                │                  │   chrome.windows
                              │                  │──────────────▶ New Window
  ┌───────────┐  sendMessage  │                  │
  │ Dashboard │──────────────▶│                  │
  └───────────┘               └────────┬─────────┘
        │                              │
        │   direct access    chrome.storage.local
        │                              │
        ▼                              ▼
     ┌──────────────────────────────────────┐
     │  gittab_data  │  gittab_trash        │
     └──────────────────────────────────────┘
```

---

## 🎨 Design System

GitTab follows a custom design system called **"The Technical Manuscript"** — inspired by well-organized codebases, terminal aesthetics, and editorial design.

| Token | Description |
|---|---|
| **Typography** | Inter (headlines/body) + Space Grotesk (labels/technical data) |
| **Surfaces** | Tonal hierarchy — no hard borders, structure via background shifts |
| **Accent** | Green "commit pillar" (2px left bar on hover) |
| **Animations** | `cubic-bezier(0.2, 0, 0, 1)` — fast-in, minimal-out |
| **Borders** | "Ghost borders" at 15% opacity — whispers, not shouts |

---

## 📦 Data Model

### Sessions (`gittab_data`)

```json
{
  "sessions": [
    {
      "id": "sess_read_later",
      "name": "Read Later",
      "isPinned": true,
      "createdAt": 1712300000000,
      "tabs": [
        {
          "id": "tab_abc12345",
          "title": "Page Title",
          "url": "https://example.com",
          "favIconUrl": "https://example.com/favicon.ico",
          "addedAt": 1712300000000
        }
      ]
    }
  ]
}
```

### Trash (`gittab_trash`)

Single-entry undo buffer. Holds the last deleted or committed item for 30 minutes.

```json
{
  "type": "commit-tab",
  "sessionId": "sess_read_later",
  "tab": { "id": "tab_abc12345", "title": "...", "url": "..." },
  "deletedAt": 1712300000000
}
```

| Trash Type | Trigger | Undo Action |
|---|---|---|
| `tab` | Delete single tab | Re-insert tab into session |
| `session` | Delete session | Re-insert full session |
| `session-clear` | Clear Read Later | Restore all cleared tabs |
| `commit-tab` | Commit current tab | Remove from storage + reopen URL |
| `commit-session` | Commit entire session | Remove from storage + reopen all URLs |

---

## ⚙️ Permissions

| Permission | Why |
|---|---|
| `tabs` | Read URLs/titles, close tabs, discard inactive tabs |
| `windows` | Open restored sessions in a new window |
| `storage` | Save tab data locally on the user's machine |
| `favicon` | Display website favicons in the dashboard |
| `contextMenus` | Right-click "Save this tab" / "Save all tabs" menu items |

---

## 🛠️ Tech Stack

- **Platform:** Chrome Manifest V3
- **Language:** Vanilla JavaScript (no frameworks, no build step)
- **Styling:** Vanilla CSS with custom properties (design tokens)
- **Storage:** `chrome.storage.local`
- **Fonts:** Google Fonts (Inter, Space Grotesk, Material Symbols)

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "Add my feature"`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

<p align="center">
  <sub>Built with ❤️ for tab hoarders everywhere</sub>
</p>
