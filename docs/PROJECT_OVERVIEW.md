# Slack Scrapping Extension - Project Overview

## Executive Summary

**Project Name:** Slack Scrapping Extension
**Type:** Chrome Browser Extension (Manifest v3)
**Version:** 1.0.0
**Primary Language:** TypeScript (100%)
**UI Framework:** React 18.2.0
**Build System:** Webpack 5 + TypeScript

**Purpose:** Automate data extraction and user interaction on Slack workspaces by:
- Scraping messages, channels, and user lists from Slack DOM
- Automating bulk messaging to users
- Persisting collected data to local storage
- Exporting data as JSON

---

## Quick Facts for AI Agents

| Aspect | Details |
|--------|---------|
| **Entry Points** | 3 separate Webpack bundles (popup, content, background) |
| **DOM Target** | Slack workspace at `https://*.slack.com/*` |
| **Storage** | Chrome's `chrome.storage.local` API |
| **Messaging** | Chrome extension message passing protocol |
| **Type Safety** | Full TypeScript with strict mode enabled |
| **Code Size** | ~500 lines of TypeScript across 3 main files |
| **Dependencies** | Minimal: React, React-DOM, @types/chrome |
| **Build Output** | JavaScript bundles in `dist/` folder |

---

## Core Components

### 1. Popup UI (React Component)
- **File:** `src/popup/App.tsx` (176 lines)
- **Purpose:** User interface for extension controls
- **Responsibility:**
  - Display scraping status
  - Render statistics (message count, channel count, user count)
  - Provide action buttons (Start/Stop, Message Users, Export, Clear)
  - Accept message template input from user
  - Communicate with content script

### 2. Content Script (DOM Scraper)
- **File:** `src/content/index.ts` (407 lines)
- **Purpose:** Runs on Slack pages to extract data and automate interactions
- **Responsibility:**
  - Query DOM for messages, channels, users
  - Perform automated clicks and form interactions
  - Send messages to users via Slack UI
  - Report status back to popup
  - Persist data to storage

### 3. Background Service Worker
- **File:** `src/background/index.ts` (33 lines)
- **Purpose:** Extension lifecycle management
- **Responsibility:**
  - Initialize storage on first install
  - Relay messages between popup and content script
  - Manage extension lifecycle events

---

## Data Architecture

### Main Data Structure
```typescript
interface SlackData {
  messages: SlackMessage[];      // Array of extracted messages
  channels: SlackChannel[];      // Array of discovered channels
  users: SlackUser[];            // Array of discovered users
}
```

### Storage Location
- **API:** `chrome.storage.local`
- **Keys:**
  - `isActive` (boolean) - Scraping state
  - `slackData` (SlackData object) - Collected data

### Data Persistence Flow
```
Popup → Content Script → SlackScraper → chrome.storage.local
         ↓
    Periodic updates (every 5 seconds)
```

---

## Communication Patterns

### Popup ↔ Content Script (Message Passing)

**Popup sends:**
```javascript
chrome.tabs.sendMessage(tabId, {
  action: 'startScraping' | 'stopScraping' | 'performCustomClicks' | 'performInitialClicks' | 'messageAllUsers',
  content?: string  // Only for messageAllUsers action
})
```

**Content Script responds:**
```javascript
chrome.runtime.sendMessage({
  action: 'updateClickStatus' | 'dataUpdated',
  status?: string,      // For updateClickStatus
  data?: SlackData      // For dataUpdated
})
```

### Chrome Storage → Components

**Popup uses:**
```javascript
const { isActive, slackData } = await chrome.storage.local.get(['isActive', 'slackData'])
```

**Content Script uses:**
```javascript
const { isActive } = await chrome.storage.local.get('isActive')
```

---

## Technology Stack

### Runtime Dependencies
```
react@^18.2.0           - UI framework
react-dom@^18.2.0       - React DOM rendering
```

### Build Tools
```
webpack@^5.89.0         - Module bundler
typescript@^5.3.3       - Language
ts-loader@^9.5.1        - TypeScript→JavaScript transpiler
html-webpack-plugin@^5.6.0  - HTML template generation
copy-webpack-plugin@^11.0.0 - Copy static files
style-loader@^3.3.3     - CSS injection
css-loader@^6.8.1       - CSS parsing
```

### Type Definitions
```
@types/react@^18.2.45      - React types
@types/react-dom@^18.2.18  - React DOM types
@types/chrome@^0.0.254     - Chrome extension APIs
```

### Linting & Code Quality
```
eslint@^8.55.0                         - Code linter
@typescript-eslint/*@^6.14.0           - TypeScript rules
eslint-plugin-react@^7.33.2            - React rules
eslint-plugin-react-hooks@^4.6.0       - React Hooks rules
```

---

## Build Pipeline

### Development Build
```bash
npm run dev
→ webpack --mode development --watch
→ Rebuilds on file changes
→ Output to dist/
```

### Production Build
```bash
npm run build
→ webpack --mode production
→ Minified output
→ Optimized bundle size
```

### Output Artifacts
```
dist/
├── popup.js           - React app bundle
├── popup.html         - Popup container HTML
├── content.js         - Content script bundle
├── background.js      - Service worker bundle
├── manifest.json      - Extension manifest (copied)
└── [vendor hashes].js - Extracted common code
```

---

## Key Features

### ✓ Data Extraction
- **Messages:** Periodic DOM queries every 5 seconds
- **Channels:** Discover channel sidebar items
- **Users:** Extract user profiles from Slack UI
- **Deduplication:** Automatically skips duplicate entries

### ✓ User Automation
- **Directory Navigation:** Auto-click to reach user list
- **Bulk Messaging:** Send message to multiple users
- **Pagination Support:** Navigate through user pages
- **Status Tracking:** Real-time feedback on progress

### ✓ Data Management
- **Persistence:** chrome.storage.local for data survival
- **Export:** Download as JSON file
- **Clear:** Reset all collected data

### ✓ UI Features
- Toggle scraping on/off
- View live statistics
- Custom message composition
- Export and clear buttons
- Status indicator display

---

## Extension Lifecycle

1. **Installation:**
   - User loads unpacked extension
   - background.js initializes
   - chrome.storage.local set to empty SlackData

2. **When User Opens Slack:**
   - Manifest matches URL pattern `https://*.slack.com/*`
   - content.js injected
   - SlackScraper class initialized

3. **User Interaction:**
   - User clicks extension icon → popup.html opens
   - React App component renders
   - State loaded from chrome.storage.local
   - User triggers actions via buttons

4. **Action Execution:**
   - Popup sends chrome.tabs.sendMessage
   - Content script processes action
   - Updates to storage.local
   - Status sent back to popup via chrome.runtime.sendMessage

---

## DOM Selectors (Critical)

These selectors are used to locate elements on Slack pages. They may break if Slack updates their UI.

**Messages:**
- Message element: `[data-qa="message"]`
- Message text: `[data-qa="message-text"]`
- Message sender: `[data-qa="message-sender_name"]`
- Message timestamp: `[data-qa="message-timestamp"]`

**Channels:**
- Channel item: `[data-qa="channel_sidebar_name"]`
- Current channel: `[data-qa="channel_name"]`

**Users:**
- User cell: `.p-explorer_grid__cell`
- Member element: `[data-qa="member"]`
- Member name: `[data-qa="member-name"]`
- Member real name: `[data-qa="member-real-name"]`
- Member ID: `data-member-id` attribute

**UI Elements:**
- Message button in profile: `.p-member_profile_buttons__button--message`
- Rich text editor: `.ql-editor`
- Send button: `.c-wysiwyg_container__button--send`
- Pagination forward: `[data-qa="c-pagination_forward_btn"]`

---

## Important Constants & Patterns

### Blocklist (Hardcoded)
```typescript
const blockList = ["01Booster_Akiko Iwamoto"];
// Users in this list will not receive messages
```

### User Name Validation Regex
```typescript
const regex = /^[a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF!@#\$%\^&\*\(\)_\+\-=\[\]\{\};:'",\.<>\/\?\\|`~ ]*$/
// Validates user names contain only allowed characters
```

### Timing Constants
- **Scrape Interval:** 5000ms (5 seconds)
- **Element Wait Timeout:** 100000ms (100 seconds)
- **Element Poll Interval:** 250ms
- **Render Wait:** 3000ms (after element found)
- **User Message Step:** i += 10 (every 10th user)

---

## Permissions & Access

### Required Permissions (manifest.json)
```json
{
  "permissions": ["activeTab", "storage", "scripting"],
  "host_permissions": ["https://*.slack.com/*"]
}
```

| Permission | Scope | Purpose |
|-----------|-------|---------|
| `activeTab` | Current browser tab | Access active tab info |
| `storage` | Extension storage | Persist data locally |
| `scripting` | Script injection | Inject content scripts |
| `https://*.slack.com/*` | All Slack domains | DOM access on Slack pages |

---

## Known Limitations

1. **UI Dependency:** Uses hardcoded Slack CSS selectors (breaks on UI changes)
2. **Timing-Dependent:** Race conditions from fixed timeouts
3. **Sequential Processing:** Operations run one-at-a-time (no parallelization)
4. **No Error Recovery:** Silent failures with warnings
5. **Memory Unbounded:** No size limits on storage
6. **Single Domain:** Only works on Slack (no multi-workspace support)
7. **Manual Reload:** Extension reload required after code changes in dev
8. **Service Worker Timeout:** Background service worker terminates after 5 min inactivity

---

## Export Format

### JSON Output Structure
```json
{
  "messages": [
    {
      "text": "Hello everyone",
      "user": "john_doe",
      "timestamp": "2024-01-15T10:30:00Z",
      "channel": "general"
    }
  ],
  "channels": [
    {
      "name": "general",
      "id": "C01234567"
    }
  ],
  "users": [
    {
      "name": "john_doe",
      "id": "U01234567",
      "realName": "John Doe"
    }
  ]
}
```

**File:** `slack-data.json` (downloaded to user's default download folder)

---

## Development Environment

### Required
- Node.js (v14+)
- npm or yarn
- Chrome browser (v88+)

### Setup
```bash
npm install              # Install dependencies
npm run build           # Build for production
npm run dev             # Build for development
npm run type-check      # TypeScript validation
npm run clean           # Remove dist/
```

### Loading in Chrome
1. Open `chrome://extensions/`
2. Enable "Developer Mode"
3. Click "Load unpacked"
4. Select `dist/` folder from project

### Debugging
- Content script: Open page DevTools → Console
- Popup: Right-click extension icon → Inspect
- Background worker: chrome://extensions → Service Worker link

---

## File Organization

```
slack-scrapping-extension/
├── src/
│   ├── popup/              # React UI component
│   │   ├── App.tsx        # Main React component (176 lines)
│   │   ├── App.css        # Popup styling
│   │   ├── index.tsx      # React entry point
│   │   └── index.html     # HTML template (350x500px)
│   ├── content/            # DOM scraping logic
│   │   └── index.ts       # Content script (407 lines)
│   └── background/         # Extension coordination
│       └── index.ts       # Service worker (33 lines)
├── public/
│   └── manifest.json       # Extension manifest (v3)
├── dist/                   # Build output (generated)
├── node_modules/           # Dependencies
├── docs/                   # Documentation
├── package.json            # Dependencies & scripts
├── tsconfig.json           # TypeScript config
├── webpack.config.js       # Build config
├── .eslintrc.json          # Linting rules
└── .gitignore              # Git rules
```

---

## Success Criteria for AI Agents

When working with this codebase, AI agents should:

1. **Understand the three-layer architecture:** UI (React) → Content Script (DOM) → Storage (Chrome API)
2. **Respect DOM selector brittleness:** Changes to Slack UI will break selectors
3. **Follow message protocol:** Use exact action names and data structures
4. **Type-check all changes:** Strict TypeScript mode is enforced
5. **Maintain backwards compatibility:** Storage schema should not break existing data
6. **Consider manifest v3 limitations:** Service worker lifecycle, permissions
7. **Test in Chrome:** Extension APIs don't work in Node.js or other browsers
8. **Handle async operations:** Promises, async/await, chrome API callbacks
9. **Avoid race conditions:** Proper await/timeout handling
10. **Persist data safely:** chrome.storage.local API with error handling

---

## Next Steps for Development

1. Review `ARCHITECTURE.md` for detailed system design
2. Read `CODE_STRUCTURE.md` for file-by-file breakdown
3. Check `API_REFERENCE.md` for all data structures and interfaces
4. Follow `INTEGRATION_GUIDE.md` to add new features
5. Use `BUILD_AND_DEPLOY.md` for build and deployment instructions

