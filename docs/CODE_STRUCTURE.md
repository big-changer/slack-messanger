# Slack Scrapping Extension - Code Structure

## File Organization

```
src/
├── popup/                          # React UI component
│   ├── App.tsx                    # Main React component (176 lines)
│   ├── App.css                    # Popup styling (basic styles)
│   ├── index.tsx                  # React DOM entry point
│   └── index.html                 # HTML template (350x500px)
│
├── content/                        # DOM scraping and automation
│   └── index.ts                   # Content script with SlackScraper class (407 lines)
│
└── background/                     # Extension lifecycle
    └── index.ts                   # Service worker (33 lines)

Configuration Files:
├── public/
│   └── manifest.json              # Chrome extension manifest v3 (27 lines)
├── webpack.config.js              # Build configuration
├── tsconfig.json                  # TypeScript configuration
├── package.json                   # Dependencies and scripts
├── .eslintrc.json                 # ESLint rules
└── .gitignore                     # Git ignore patterns
```

---

## src/popup/App.tsx (176 lines)

**Purpose:** Main React component that provides the user interface for the extension.

**Key Responsibilities:**
1. Display current scraping status
2. Show statistics (message count, channel count, user count)
3. Provide action buttons (Start/Stop, Message Users, Export, Clear)
4. Accept message template input from user
5. Communicate with content script via Chrome messaging API
6. Persist UI state to Chrome storage

### Component State

```typescript
const [isActive, setIsActive] = useState<boolean>(false)
// Controls scraping on/off toggle

const [data, setData] = useState<SlackData>({
  messages: [],
  channels: [],
  users: []
})
// Holds all scraped data

const [currentClickStatus, setCurrentClickStatus] = useState<string>('')
// Displays status of user messaging operation

const [messageContent, setMessageContent] = useState<string>('')
// Holds user's message template for bulk messaging
```

### Key Methods

#### toggleScraping()
```typescript
const toggleScraping = () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const action = isActive ? 'stopScraping' : 'startScraping'
    chrome.tabs.sendMessage(tabs[0].id, { action })
  })
  chrome.storage.local.set({ isActive: !isActive })
  setIsActive(!isActive)
}
```
- Toggles scraping on/off
- Sends message to content script
- Updates Chrome storage
- Updates local React state

#### handleMessageAllUsers()
```typescript
const handleMessageAllUsers = () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, {
      action: 'messageAllUsers',
      content: messageContent
    })
  })
}
```
- Gets active tab
- Sends message template to content script
- Content script handles automation

#### handleExportData()
```typescript
const handleExportData = () => {
  const dataStr = JSON.stringify(data, null, 2)
  const blob = new Blob([dataStr], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'slack-data.json'
  a.click()
  URL.revokeObjectURL(url)
}
```
- Serializes data to JSON
- Creates downloadable blob
- Triggers browser download
- File name: `slack-data.json`

#### handleClearData()
```typescript
const handleClearData = () => {
  chrome.storage.local.set({
    slackData: { messages: [], channels: [], users: [] }
  })
  setData({ messages: [], channels: [], users: [] })
}
```
- Resets all collected data
- Clears Chrome storage
- Resets React state

### Lifecycle Hooks

#### useEffect - Initial Load
```typescript
useEffect(() => {
  chrome.storage.local.get(['isActive', 'slackData'], (result) => {
    if (result.isActive) setIsActive(true)
    if (result.slackData) setData(result.slackData)
  })
}, [])
```
- Runs on component mount
- Loads state from Chrome storage
- Initializes UI with persisted data

#### useEffect - Message Listener
```typescript
useEffect(() => {
  const listener = (message: any) => {
    if (message.action === 'updateClickStatus') {
      setCurrentClickStatus(message.status)
    } else if (message.action === 'dataUpdated') {
      setData(message.data)
    }
  }
  chrome.runtime.onMessage.addListener(listener)
  return () => chrome.runtime.onMessage.removeListener(listener)
}, [])
```
- Listens for messages from content script
- Updates UI in real-time
- Updates statistics display
- Cleanup on unmount

### UI Structure

```
┌─────────────────────────────────────┐
│  Slack Scrapping Extension          │
├─────────────────────────────────────┤
│                                     │
│  Status: [Active/Inactive]          │
│                                     │
│  [Start/Stop Scraping] button       │
│                                     │
│  Statistics:                        │
│  ├─ Messages: 42                    │
│  ├─ Channels: 5                     │
│  └─ Users: 123                      │
│                                     │
│  Message Template:                  │
│  ├─ <textarea>Hello...</textarea>  │
│  └─ [Message All Users] button      │
│                                     │
│  Current Status:                    │
│  └─ <status display>                │
│                                     │
│  [Export] [Clear] buttons           │
│                                     │
└─────────────────────────────────────┘
```

**Dimensions:** 350px wide × 500px tall

---

## src/popup/index.tsx (10 lines)

**Purpose:** React DOM entry point for the popup.

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './App.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(<App />)
```

**Responsibility:** Mount React App component to DOM element with id "root"

---

## src/popup/index.html (19 lines)

**Purpose:** HTML template for the popup window.

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Slack Scrapping Extension</title>
    <style>
      body {
        width: 350px;
        height: 500px;
        margin: 0;
        font-family: system-ui, -apple-system;
      }
      #root {
        width: 100%;
        height: 100%;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

**Characteristics:**
- Dimensions: 350px × 500px
- CSS sets up root element
- Webpack injects script tags automatically

---

## src/popup/App.css

**Purpose:** Basic styling for popup UI.

Contains:
- Button styles
- Text area styles
- Layout and spacing
- Color scheme

---

## src/content/index.ts (407 lines)

**Purpose:** Content script that runs on Slack pages. Handles DOM scraping and user automation.

**Core Class: SlackScraper**

### Properties

```typescript
private isActive: boolean = false
// Scraping active/inactive state

private messages: SlackMessage[] = []
// Collected messages

private channels: SlackChannel[] = []
// Discovered channels

private users: SlackUser[] = []
// Discovered users

private scrapingInterval: NodeJS.Timeout | null = null
// Interval ID for periodic scraping
```

### Constructor

```typescript
constructor() {
  this.setupMessageListener()
  this.checkInitialState()
}
```

- Sets up message listener for popup commands
- Checks if scraping should be active (from storage)

### Public Methods

#### startScraping()

```typescript
public startScraping(): void {
  if (this.isActive) return
  this.isActive = true

  this.scrapingInterval = setInterval(() => {
    this.scrapeMessages()
    this.scrapeChannels()
    this.scrapeUsers()
    this.saveData()
  }, 5000)  // Every 5 seconds

  console.log('Starting Slack scraping...')
}
```

**Behavior:**
1. Sets `isActive = true`
2. Creates 5-second interval
3. Each interval calls: scrapeMessages, scrapeChannels, scrapeUsers, saveData
4. Logs to console

---

#### stopScraping()

```typescript
public stopScraping(): void {
  if (!this.isActive) return
  this.isActive = false

  if (this.scrapingInterval) {
    clearInterval(this.scrapingInterval)
    this.scrapingInterval = null
  }

  console.log('Stopping Slack scraping...')
}
```

**Behavior:**
1. Sets `isActive = false`
2. Clears interval timer
3. Logs to console

---

#### scrapeMessages()

```typescript
private scrapeMessages(): void {
  const elements = document.querySelectorAll('[data-qa="message"]')

  elements.forEach((element) => {
    const text = element.querySelector('[data-qa="message-text"]')?.textContent || ''
    const user = element.querySelector('[data-qa="message-sender_name"]')?.textContent || ''
    const timestamp = element.querySelector('[data-qa="message-timestamp"]')?.textContent || ''
    const channel = this.currentChannel || 'unknown'

    // Deduplication
    const exists = this.messages.some(m =>
      m.text === text &&
      m.user === user &&
      m.timestamp === timestamp
    )

    if (!exists && text && user) {
      this.messages.push({ text, user, timestamp, channel })
    }
  })

  console.log(`Found ${elements.length} messages`)
}
```

**Behavior:**
1. Queries all `[data-qa="message"]` elements
2. For each message:
   - Extracts text, user, timestamp, channel
   - Checks if already in collection (deduplication)
   - Adds if new
3. Logs message count

---

#### scrapeChannels()

```typescript
private scrapeChannels(): void {
  const elements = document.querySelectorAll('[data-qa="channel_sidebar_name"]')

  elements.forEach((element) => {
    const name = element.textContent || ''
    const id = (element as HTMLElement).dataset.channelId || ''

    if (name && !this.channels.some(c => c.name === name && c.id === id)) {
      this.channels.push({ name, id })
    }
  })

  console.log(`Found ${elements.length} channels`)
}
```

**Behavior:**
1. Queries all `[data-qa="channel_sidebar_name"]` elements
2. For each channel: extracts name and ID
3. Adds if not already present
4. Logs channel count

---

#### scrapeUsers()

```typescript
private scrapeUsers(): void {
  const elements = document.querySelectorAll('[data-qa="member"]')

  elements.forEach((element) => {
    const name = element.querySelector('[data-qa="member-name"]')?.textContent || ''
    const id = element.getAttribute('data-member-id') || ''
    const realName = element.querySelector('[data-qa="member-real-name"]')?.textContent || ''

    if (name && !this.users.some(u => u.id === id)) {
      this.users.push({ name, id, realName })
    }
  })

  console.log(`Found ${elements.length} users`)
}
```

**Behavior:**
1. Queries all `[data-qa="member"]` elements
2. For each user: extracts name, ID, real name
3. Adds if not already present (by ID)
4. Logs user count

---

#### saveData()

```typescript
private saveData(): void {
  const slackData: SlackData = {
    messages: this.messages,
    channels: this.channels,
    users: this.users
  }

  chrome.storage.local.set({ slackData })

  chrome.runtime.sendMessage({
    action: 'dataUpdated',
    data: slackData
  }).catch(() => {
    // Popup might not be open
  })
}
```

**Behavior:**
1. Creates SlackData object from internal state
2. Saves to chrome.storage.local
3. Sends message to popup (with error handling if popup closed)

---

#### messageAllUsersInPage(content: string)

```typescript
public async messageAllUsersInPage(content: string): Promise<void> {
  const userCells = document.getElementsByClassName('p-explorer_grid__cell')

  for (let i = 0; i < userCells.length; i += 10) {
    const userCell = userCells[i] as HTMLElement

    // 1. Click user cell
    userCell.click()
    await this.waitForElement('.p-member_profile_buttons__button--message')

    // 2. Click message button
    const messageButton = document.querySelector('.p-member_profile_buttons__button--message')
    if (!messageButton) {
      console.warn('message button not found')
      continue
    }
    (messageButton as HTMLElement).click()

    // 3. Wait for message input
    const editor = await this.waitForElement('.ql-editor', 5000)
    if (!editor) {
      console.warn('message editor not found')
      history.back()
      continue
    }

    // 4. Get member name for validation
    const memberNameEl = userCell.querySelector('[data-qa="member-name"]')
    const memberName = memberNameEl?.textContent || ''

    // 5. Validate against blocklist and regex
    if (this.isBlocklisted(memberName) || !this.isValidName(memberName)) {
      history.back()
      continue
    }

    // 6. Insert message
    document.execCommand('insertText', false, content)

    // 7. Click send
    const sendButton = document.querySelector('.c-wysiwyg_container__button--send')
    if (sendButton) {
      (sendButton as HTMLElement).click()
    }

    // 8. Return to list
    history.back()

    // 9. Update status
    chrome.runtime.sendMessage({
      action: 'updateClickStatus',
      status: `Messaging user ${i + 1} of ${userCells.length}`
    })
  }

  // 10. Check for pagination
  const nextPageBtn = document.querySelector('[data-qa="c-pagination_forward_btn"]')
  if (nextPageBtn && nextPageBtn.getAttribute('aria-disabled') !== 'true') {
    nextPageBtn.click()
    await new Promise(resolve => setTimeout(resolve, 2000))
    await this.messageAllUsersInPage(content)
  }
}
```

**Behavior:**
1. Gets all user cells (every 10th user)
2. For each user:
   - Click to open profile
   - Click message button
   - Type message
   - Send message
   - Return to list
   - Update progress
3. Check for pagination and recursively process next page
4. Validates against blocklist
5. Validates name format

---

#### performInitialClicks()

```typescript
public async performInitialClicks(): Promise<void> {
  const sidebarItems = document.getElementsByClassName('p-channel_sidebar__name')

  if (sidebarItems.length >= 4) {
    (sidebarItems[3] as HTMLElement).click()
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  const directoryBtn = document.querySelector('#unified_directory')
  if (directoryBtn) {
    (directoryBtn as HTMLElement).click()
  }
}
```

**Behavior:**
1. Clicks 4th channel in sidebar
2. Waits 1 second
3. Clicks directory toggle button

---

#### performCustomClicks()

```typescript
public async performCustomClicks(): Promise<void> {
  // Implementation varies based on specific use case
  // Typically performs hardcoded click sequence
}
```

**Behavior:** Performs custom click sequence (implementation dependent)

---

### Private Methods

#### waitForElement(selector, timeout, interval)

```typescript
private async waitForElement(
  selector: string,
  timeout = 100000,
  interval = 250
): Promise<HTMLElement | null> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    const element = document.querySelector(selector)
    if (element) {
      // Wait for render
      await new Promise(resolve => setTimeout(resolve, 3000))
      return element as HTMLElement
    }

    // Poll every 250ms
    await new Promise(resolve => setTimeout(resolve, interval))
  }

  return null
}
```

**Behavior:**
1. Polls DOM every 250ms
2. Returns element when found
3. Waits additional 3 seconds after element found
4. Returns null if timeout (100 seconds default)

---

#### isBlocklisted(name: string)

```typescript
private isBlocklisted(name: string): boolean {
  const blocklist = ["01Booster_Akiko Iwamoto"]
  return blocklist.includes(name)
}
```

**Behavior:** Checks if user is in blocklist

---

#### isValidName(name: string)

```typescript
private isValidName(name: string): boolean {
  const regex = /^[a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF!@#\$%\^&\*\(\)_\+\-=\[\]\{\};:'",\.<>\/\?\\|`~ ]*$/
  return regex.test(name)
}
```

**Behavior:** Validates name matches allowed character set

---

#### setupMessageListener()

```typescript
private setupMessageListener(): void {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case 'startScraping':
        this.startScraping()
        break
      case 'stopScraping':
        this.stopScraping()
        break
      case 'performInitialClicks':
        this.performInitialClicks()
        break
      case 'performCustomClicks':
        this.performCustomClicks()
        break
      case 'messageAllUsers':
        this.messageAllUsersInPage(request.content)
        break
    }
  })
}
```

**Behavior:** Registers listener for popup commands

---

#### checkInitialState()

```typescript
private async checkInitialState(): Promise<void> {
  const { isActive } = await chrome.storage.local.get('isActive')
  if (isActive) {
    this.startScraping()
  }
}
```

**Behavior:** Resume scraping if it was active before page refresh

---

## src/background/index.ts (33 lines)

**Purpose:** Service worker managing extension lifecycle and message relay.

```typescript
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    isActive: false,
    slackData: { messages: [], channels: [], users: [] }
  })
  console.log('Extension installed, storage initialized')
})

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Relay messages from content script to popup
  chrome.runtime.sendMessage(request).catch((error) => {
    console.log('Could not relay message, popup probably not open:', error)
  })
})
```

**Responsibilities:**
1. Initialize storage on install
2. Handle extension lifecycle events
3. Relay messages between content script and popup

---

## public/manifest.json (27 lines)

**Purpose:** Chrome extension manifest declaring permissions and entry points.

```json
{
  "manifest_version": 3,
  "name": "Slack Scrapping Extension",
  "version": "1.0.0",
  "description": "A Chrome extension for scraping and automating interactions with Slack workspaces",

  "permissions": [
    "activeTab",
    "storage",
    "scripting"
  ],

  "host_permissions": [
    "https://*.slack.com/*"
  ],

  "background": {
    "service_worker": "background.js"
  },

  "content_scripts": [{
    "matches": ["https://*.slack.com/*"],
    "js": ["content.js"]
  }],

  "action": {
    "default_popup": "popup.html",
    "default_title": "Slack Scrapping Extension"
  }
}
```

**Key Sections:**
- `manifest_version`: Must be 3 (Chrome requirement)
- `permissions`: Declares what APIs extension can use
- `host_permissions`: Declares which websites extension can access
- `background`: Service worker entry point
- `content_scripts`: Content script injection rules
- `action`: Popup UI configuration

---

## Configuration Files

### webpack.config.js

```javascript
const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const CopyWebpackPlugin = require('copy-webpack-plugin')

module.exports = {
  entry: {
    popup: './src/popup/index.tsx',
    content: './src/content/index.ts',
    background: './src/background/index.ts'
  },

  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true
  },

  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        exclude: /node_modules/
      },
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader']
      }
    ]
  },

  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    alias: { '@': path.resolve(__dirname, 'src') }
  },

  plugins: [
    new HtmlWebpackPlugin({
      template: './src/popup/index.html',
      filename: 'popup.html',
      chunks: ['popup']
    }),
    new CopyWebpackPlugin({
      patterns: [{ from: 'public', to: '.' }]
    })
  ],

  optimization: {
    splitChunks: { chunks: 'all' }
  }
}
```

**Purpose:** Configure Webpack to build three separate bundles

**Key Points:**
- Three entry points (popup, content, background)
- TypeScript loader transpiles .tsx/.ts files
- CSS loader processes styles
- HtmlWebpackPlugin generates popup.html
- CopyWebpackPlugin copies manifest.json to dist/

---

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["DOM", "DOM.Iterable", "ES6"],
    "allowJs": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "strict": true,
    "module": "CommonJS",
    "moduleResolution": "node",
    "jsx": "react-jsx",
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Key Settings:**
- `strict: true` - Enforces strict type checking
- `jsx: "react-jsx"` - React 17+ JSX transform
- `target: "ES2020"` - Modern JavaScript output
- `module: "CommonJS"` - CommonJS module format

---

### package.json

```json
{
  "name": "slack-scrapping-extension",
  "version": "1.0.0",
  "description": "A Chrome extension for scraping Slack",
  "scripts": {
    "build": "webpack --mode production",
    "dev": "webpack --mode development --watch",
    "clean": "rimraf dist",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.254",
    "@types/react": "^18.2.45",
    "@types/react-dom": "^18.2.18",
    "@typescript-eslint/eslint-plugin": "^6.14.0",
    "@typescript-eslint/parser": "^6.14.0",
    "copy-webpack-plugin": "^11.0.0",
    "css-loader": "^6.8.1",
    "eslint": "^8.55.0",
    "eslint-plugin-react": "^7.33.2",
    "eslint-plugin-react-hooks": "^4.6.0",
    "html-webpack-plugin": "^5.6.0",
    "rimraf": "^5.0.5",
    "style-loader": "^3.3.3",
    "ts-loader": "^9.5.1",
    "typescript": "^5.3.3",
    "webpack": "^5.89.0",
    "webpack-cli": "^5.1.4"
  }
}
```

---

## Build Artifacts (dist/)

After running `npm run build`, the dist/ folder contains:

```
dist/
├── popup.js          # React bundle
├── popup.html        # Generated from src/popup/index.html
├── content.js        # Content script bundle
├── background.js     # Service worker bundle
├── manifest.json     # Copied from public/
└── [vendor].js       # Split chunks from optimization
```

**These files are loaded into Chrome via "Load unpacked"**

---

## Summary Table

| File | Lines | Type | Responsibility |
|------|-------|------|-----------------|
| App.tsx | 176 | React | UI, state, user interaction |
| index.ts (content) | 407 | TypeScript | DOM scraping, automation |
| index.ts (background) | 33 | TypeScript | Lifecycle, message relay |
| manifest.json | 27 | JSON | Extension configuration |
| webpack.config.js | ~50 | JS | Build configuration |
| tsconfig.json | ~30 | JSON | TypeScript configuration |

**Total Source Code: ~616 lines of TypeScript/React**

