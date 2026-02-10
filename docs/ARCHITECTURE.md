# Slack Scrapping Extension - Architecture & System Design

## System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                     Chrome Browser Environment                    │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Extension Isolated Context                  │    │
│  │                                                          │    │
│  │  ┌──────────────────┐         ┌──────────────────┐     │    │
│  │  │ Background       │◄────────┤ Popup UI         │     │    │
│  │  │ Service Worker   │         │ (React)          │     │    │
│  │  │                  │         │                  │     │    │
│  │  │ - Lifecycle      │         │ - Controls       │     │    │
│  │  │ - Message relay  │         │ - Display        │     │    │
│  │  │ - Storage init   │         │ - Stats          │     │    │
│  │  └──────────────────┘         └──────────────────┘     │    │
│  │         ▲                               │               │    │
│  │         │                               │               │    │
│  │         └───────────────┬───────────────┘               │    │
│  │                         │                              │    │
│  │                    Message Passing                     │    │
│  │                    (chrome.runtime)                    │    │
│  │                         │                              │    │
│  └─────────────────────────┼──────────────────────────────┘    │
│                            │                                    │
│                            │                                    │
│  ┌─────────────────────────▼──────────────────────────────┐    │
│  │              Page Content Context                       │    │
│  │                                                         │    │
│  │  ┌──────────────────────────────────────────────┐     │    │
│  │  │ Content Script (SlackScraper Class)         │     │    │
│  │  │                                              │     │    │
│  │  │ - Query DOM                                  │     │    │
│  │  │ - Scrape messages/channels/users             │     │    │
│  │  │ - Automate interactions (clicks, forms)      │     │    │
│  │  │ - Report status                              │     │    │
│  │  │ - Persist to storage                         │     │    │
│  │  └──────────────────────────────────────────────┘     │    │
│  │                         │                             │    │
│  │  Injected Message Listeners:                         │    │
│  │  - startScraping()     ◄─┐                           │    │
│  │  - stopScraping()      ◄─┼─ From Popup              │    │
│  │  - messageAllUsers()   ◄─┤                           │    │
│  │  - performClicks()     ◄─┘                           │    │
│  │                                                       │    │
│  └─────────────┬──────────────────────────────────────────┘    │
│                │                                                │
│                │ Document Object                               │
│                │                                                │
│  ┌─────────────▼──────────────────────────────────────────┐    │
│  │          Slack Website (https://*.slack.com/*)         │    │
│  │                                                         │    │
│  │  Messages       Channels        Users           UI     │    │
│  │  └─────┐        └─────┐        └─────┐        └──────┐│    │
│  │  [data-qa="message"]  [data-qa] [data-qa]             ││    │
│  │  ├─ text           channel    member              Button││    │
│  │  ├─ sender         sidebar    sidebar             Text  ││    │
│  │  ├─ timestamp      items      grid                Form  ││    │
│  │  └─ channel                                       Div   ││    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │         Chrome Storage API (chrome.storage.local)       │   │
│  │                                                         │   │
│  │  ├─ Key: "isActive"      (boolean)                     │   │
│  │  └─ Key: "slackData"     (SlackData object)            │   │
│  │      ├─ messages[]       (SlackMessage[])             │   │
│  │      ├─ channels[]       (SlackChannel[])             │   │
│  │      └─ users[]          (SlackUser[])                │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Diagram - Scraping Operation

```
User Clicks "Start Scraping" Button
    │
    ▼
Popup Component: toggleScraping()
    │
    ├─▶ setIsActive(true)                    [React State Update]
    │
    ├─▶ chrome.storage.local.set({ isActive: true })
    │
    └─▶ chrome.tabs.sendMessage({
        tabId: activeTab.id,
        data: { action: 'startScraping' }
        })
    │
    ▼
Content Script Message Listener
    │
    ├─▶ Receives { action: 'startScraping' }
    │
    └─▶ slackScraper.startScraping()
        │
        ├─▶ this.isActive = true
        │
        └─▶ this.scrapingInterval = setInterval(() => {
            this.scrapeMessages()        // Every 5 seconds
            this.scrapeChannels()
            this.scrapeUsers()
            this.saveData()
            }, 5000)
        │
        ▼
    Periodic Scraping Loop (every 5 seconds)
        │
        ├─▶ scrapeMessages()
        │   └─▶ document.querySelectorAll('[data-qa="message"]')
        │       └─▶ Extract: text, user, timestamp, channel
        │           └─▶ Deduplicate
        │               └─▶ Add to this.messages[]
        │
        ├─▶ scrapeChannels()
        │   └─▶ document.querySelectorAll('[data-qa="channel_sidebar_name"]')
        │       └─▶ Extract: name, id
        │           └─▶ Add to this.channels[]
        │
        ├─▶ scrapeUsers()
        │   └─▶ document.querySelectorAll('[data-qa="member"]')
        │       └─▶ Extract: name, id, realName
        │           └─▶ Add to this.users[]
        │
        └─▶ saveData()
            └─▶ chrome.storage.local.set({
                slackData: {
                    messages: this.messages,
                    channels: this.channels,
                    users: this.users
                }
                })
                │
                ▼
            chrome.runtime.sendMessage({
                action: 'dataUpdated',
                data: slackData
                })
                │
                ▼
            Popup Message Listener
                │
                └─▶ Updates React state
                    └─▶ Re-renders with new stats
                        └─▶ Display updated counts
```

---

## Data Flow Diagram - User Messaging Operation

```
User Types Message & Clicks "Message All Users"
    │
    ▼
Popup Component: handleMessageAllUsers()
    │
    ├─▶ Reads messageContent from textarea
    │
    └─▶ chrome.tabs.sendMessage({
        tabId: activeTab.id,
        data: {
            action: 'messageAllUsers',
            content: messageContent
        }
        })
    │
    ▼
Content Script Message Listener
    │
    └─▶ slackScraper.messageAllUsersInPage(messageContent)
        │
        ├─▶ Get user cells: document.getElementsByClassName("p-explorer_grid__cell")
        │
        └─▶ For each user (with step i += 10):
            │
            ├─▶ 1. Click user cell [i]
            │       └─▶ Opens profile sidebar
            │           └─▶ waitForElement(".p-member_profile_buttons__button--message")
            │
            ├─▶ 2. Click message button
            │       └─▶ Opens DM conversation
            │           └─▶ waitForElement(".ql-editor")
            │
            ├─▶ 3. Validate member name
            │       ├─▶ Check against blocklist
            │       └─▶ Validate against regex pattern
            │
            ├─▶ 4. Insert message into text editor
            │       └─▶ document.execCommand('insertText', false, content)
            │
            ├─▶ 5. Find & click send button
            │       └─▶ document.querySelector(".c-wysiwyg_container__button--send")
            │           └─▶ Click to send
            │
            ├─▶ 6. Return to user list
            │       └─▶ history.back()
            │
            ├─▶ 7. Update status
            │       └─▶ chrome.runtime.sendMessage({
            │           action: 'updateClickStatus',
            │           status: `Messaging user ${current} of ${total}`
            │           })
            │
            └─▶ Next user (i += 10)
    │
    ├─▶ Check for pagination
    │   └─▶ document.querySelector('[data-qa="c-pagination_forward_btn"]')
    │       ├─▶ If enabled (aria-disabled !== 'true')
    │       │   └─▶ Click next page button
    │       │       └─▶ Wait for page load
    │       │           └─▶ Recursively call messageAllUsersInPage()
    │       │
    │       └─▶ If disabled
    │           └─▶ All pages processed, done
    │
    ▼
Popup Message Listener
    │
    └─▶ Updates currentClickStatus state
        └─▶ Re-renders status display
```

---

## State Management Architecture

### React Component State (Popup)

```typescript
// src/popup/App.tsx
const [isActive, setIsActive] = useState<boolean>(false)
const [data, setData] = useState<SlackData>({
  messages: [],
  channels: [],
  users: []
})
const [currentClickStatus, setCurrentClickStatus] = useState<string>('')
const [messageContent, setMessageContent] = useState<string>('')

// Initial load from storage
useEffect(() => {
  chrome.storage.local.get(['isActive', 'slackData'], (result) => {
    if (result.isActive) setIsActive(true)
    if (result.slackData) setData(result.slackData)
  })
}, [])

// Listen for content script updates
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

### Content Script State (Class Instance)

```typescript
// src/content/index.ts
class SlackScraper {
  private isActive: boolean = false
  private messages: SlackMessage[] = []
  private channels: SlackChannel[] = []
  private users: SlackUser[] = []
  private scrapingInterval: NodeJS.Timeout | null = null

  // State changes on:
  // - startScraping() → isActive = true, scrapingInterval started
  // - stopScraping() → isActive = false, scrapingInterval cleared
  // - scrapeMessages() → messages[] updated
  // - scrapeChannels() → channels[] updated
  // - scrapeUsers() → users[] updated
  // - saveData() → persists to chrome.storage.local
}
```

### Storage State Schema

```typescript
// chrome.storage.local
{
  isActive: boolean,           // Scraping state
  slackData: {
    messages: Array<{
      text: string
      user: string
      timestamp: string
      channel: string
    }>,
    channels: Array<{
      name: string
      id: string
    }>,
    users: Array<{
      name: string
      id: string
      realName: string
    }>
  }
}
```

---

## Message Communication Protocol

### 1. Popup → Content Script (chrome.tabs.sendMessage)

**Payload Structure:**
```typescript
interface PopupToContentMessage {
  action: 'startScraping' | 'stopScraping' | 'performCustomClicks' | 'performInitialClicks' | 'messageAllUsers'
  content?: string  // Only present when action === 'messageAllUsers'
}
```

**Example Messages:**
```javascript
// Start scraping
{ action: 'startScraping' }

// Stop scraping
{ action: 'stopScraping' }

// Message users
{ action: 'messageAllUsers', content: 'Hello everyone!' }

// Perform initial setup clicks
{ action: 'performInitialClicks' }

// Perform custom clicks
{ action: 'performCustomClicks' }
```

**Delivery Mechanism:**
```typescript
chrome.tabs.sendMessage(tabId, message, (response) => {
  // Optional response handling
})
```

### 2. Content Script → Popup (chrome.runtime.sendMessage)

**Payload Structure:**
```typescript
interface ContentToPopupMessage {
  action: 'updateClickStatus' | 'dataUpdated'
  status?: string              // When action === 'updateClickStatus'
  data?: SlackData             // When action === 'dataUpdated'
}
```

**Example Messages:**
```javascript
// Status update
{ action: 'updateClickStatus', status: 'Messaging user 5 of 50...' }

// Data update
{
  action: 'dataUpdated',
  data: {
    messages: [...],
    channels: [...],
    users: [...]
  }
}
```

**Delivery Mechanism:**
```typescript
chrome.runtime.sendMessage(message, (response) => {
  // Optional response handling
})
```

### 3. Background Service Worker Role

**Message Relay:**
```typescript
// background/index.ts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Relay content script messages to popup
  // Handle if popup not open (sendResponse catches error)
})
```

---

## Component Lifecycle

### Extension Installation Lifecycle

```
1. User loads extension via chrome://extensions/ (Load unpacked)
   │
   ├─▶ manifest.json parsed
   │   └─▶ Registers background service worker
   │       Registers content scripts for https://*.slack.com/*
   │       Declares action/popup
   │
   ├─▶ background.js loaded
   │   │
   │   └─▶ chrome.runtime.onInstalled listener
   │       └─▶ chrome.storage.local.set({
   │           isActive: false,
   │           slackData: { messages: [], channels: [], users: [] }
   │           })
   │
   └─▶ Extension ready for use
```

### Per-Tab Lifecycle (When User Opens Slack)

```
1. User navigates to https://app.slack.com/...
   │
   ├─▶ URL matches manifest content_scripts[].matches
   │
   ├─▶ content.js injected into page context
   │   │
   │   └─▶ SlackScraper instance created
   │       │
   │       ├─▶ Check chrome.storage.local for isActive
   │       │   │
   │       │   └─▶ If isActive === true
   │       │       └─▶ Resume scraping with startScraping()
   │       │
   │       └─▶ Setup message listener for popup commands
   │
   └─▶ Content script ready, awaiting commands
```

### User Interaction Lifecycle

```
1. User clicks extension icon
   │
   ├─▶ popup.html loaded
   │
   ├─▶ popup.js (React) executed
   │   │
   │   ├─▶ App component mounts
   │   │
   │   ├─▶ useEffect runs
   │   │   └─▶ Load isActive and slackData from storage
   │   │
   │   ├─▶ useEffect runs
   │   │   └─▶ Setup chrome.runtime.onMessage listener
   │   │
   │   └─▶ Render UI with current state
   │
   ├─▶ User interacts (clicks button, types, etc.)
   │
   ├─▶ Event handler triggered
   │   │
   │   ├─▶ Update React state (setIsActive, setData, etc.)
   │   │
   │   └─▶ Send chrome message to content script
   │       └─▶ Content script processes action
   │           └─▶ Sends response back to popup
   │               └─▶ Popup state updates
   │                   └─▶ Re-render
   │
   └─▶ User closes popup
       └─▶ Popup component unmounts
           └─▶ Message listener removed
```

---

## DOM Interaction Patterns

### Pattern 1: Querying Elements

```typescript
// Simple query
const messages = document.querySelectorAll('[data-qa="message"]')

// Unsafe query (may not exist)
const messageText = message.querySelector('[data-qa="message-text"]')?.textContent

// Safe query with fallback
const messageText = (() => {
  const el = message.querySelector('[data-qa="message-text"]')
  return el?.textContent || ''
})()
```

### Pattern 2: Element Polling (Async Waiting)

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
      // Additional wait for rendering
      await new Promise(resolve => setTimeout(resolve, 3000))
      return element as HTMLElement
    }

    // Poll every 250ms
    await new Promise(resolve => setTimeout(resolve, interval))
  }

  return null  // Timeout, element not found
}
```

### Pattern 3: Automated Clicking

```typescript
// Simple click
const button = document.querySelector('.send-button')
button?.click()

// Click with verification
const button = document.querySelector('.send-button')
if (button instanceof HTMLElement) {
  button.click()
  // Wait for action to complete
  await new Promise(resolve => setTimeout(resolve, 1000))
}

// Click with element waiting
const element = await this.waitForElement('.profile-button')
if (element) {
  element.click()
}
```

### Pattern 4: Form Input

```typescript
// Insert text via execCommand (works with rich editors)
document.execCommand('insertText', false, 'Hello world')

// Or direct textarea/input update
const input = document.querySelector('.message-input') as HTMLTextAreaElement
if (input) {
  input.value = 'Hello world'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}
```

### Pattern 5: Loop with Pagination

```typescript
async messageAllUsersInPage(content: string): Promise<void> {
  const userCells = document.getElementsByClassName('p-explorer_grid__cell')

  // Process every 10th user
  for (let i = 0; i < userCells.length; i += 10) {
    const userCell = userCells[i] as HTMLElement

    // ... process user ...

    // Update progress
    chrome.runtime.sendMessage({
      action: 'updateClickStatus',
      status: `Messaging user ${i + 1} of ${userCells.length}`
    })
  }

  // Check for next page
  const nextPageBtn = document.querySelector('[data-qa="c-pagination_forward_btn"]')
  if (nextPageBtn && nextPageBtn.getAttribute('aria-disabled') !== 'true') {
    nextPageBtn.click()

    // Wait for page load
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Recursively process next page
    await this.messageAllUsersInPage(content)
  }
}
```

---

## Error Handling Strategy

### Pattern: Try-Catch with Logging

```typescript
try {
  const element = await this.waitForElement('.some-selector', 5000)
  if (!element) {
    console.warn('Element not found: .some-selector')
    return
  }

  // Process element
  element.click()
} catch (error) {
  console.error('Error in operation:', error)
  // Continue execution
}
```

### Pattern: Silent Failures

Most errors in content script result in console warnings rather than throwing exceptions. The scraper continues execution to maximize data collection.

### Pattern: Message Listener Error Handling

```typescript
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    // Process message
    sendResponse({ success: true })
  } catch (error) {
    console.error('Message handler error:', error)
    sendResponse({ success: false, error: error.message })
  }
})
```

---

## Performance Considerations

### Memory Usage
- Messages stored in-memory until saved to storage
- No limits on array size (potential memory leak on very large workspaces)
- Storage persists across browser sessions

### CPU Usage
- Periodic scraping every 5 seconds (moderate CPU usage)
- DOM queries are synchronous (blocking)
- User automation clicks/waits are sequential (slow but reliable)

### Timing Constraints
- Service worker: 5-minute timeout before termination
- Content script: Persists as long as tab/page is open
- Popup: Only exists while user has it open

### Optimization Opportunities (Not Implemented)
- Batch DOM queries instead of sequential
- Implement pagination/chunking for large datasets
- Use requestAnimationFrame for smoother timing
- Debounce storage updates
- Use Promise.all for parallel operations

---

## Browser API Dependencies

### chrome.storage.local

```typescript
// Get data
const result = await chrome.storage.local.get(['key1', 'key2'])
const value = result.key1

// Set data
await chrome.storage.local.set({ key: value })

// Clear data
await chrome.storage.local.clear()

// Event listener (when data changes from other context)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    console.log('Storage updated:', changes)
  }
})
```

### chrome.tabs.sendMessage

```typescript
// Send message to content script
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  chrome.tabs.sendMessage(tabs[0].id, { action: 'startScraping' })
})
```

### chrome.runtime.sendMessage

```typescript
// Send message to popup/background
chrome.runtime.sendMessage(
  { action: 'dataUpdated', data: slackData },
  (response) => {
    // Optional response handling
  }
)

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle request
  sendResponse({ success: true })
})
```

### chrome.runtime.onInstalled

```typescript
// Handle installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Extension installed')
  }
})
```

---

## Security Model

### Content Security Policy (CSP)
- Content scripts run in isolated context
- Can access DOM but limited privileges
- Cannot access main page JavaScript (different execution context)

### Data Isolation
- Each extension has isolated storage
- Storage is not accessible from web pages
- Popup and content script can only communicate via message passing

### Permission Model
- Manifest declares all required permissions
- Background service worker cannot inject scripts
- Content script injection specified in manifest

---

## Debugging Hooks

### Console Logging Locations

**Content Script Console** (Open page DevTools)
```javascript
console.log('Scraping messages...')  // Shows in page DevTools → Console
```

**Popup DevTools** (Right-click extension icon → Inspect)
```javascript
console.log('Button clicked')  // Shows in popup DevTools → Console
```

**Background Service Worker** (chrome://extensions → Service Worker)
```javascript
console.log('Storage updated')  // Shows in service worker DevTools → Console
```

### Common Debugging Steps
1. Open DevTools for relevant context (page/popup/service worker)
2. Check Console tab for messages
3. Check Storage tab for chrome.storage.local data
4. Check Network tab for API calls (none for this extension)
5. Check Sources tab for breakpoint debugging

---

## Manifest v3 Considerations

### Service Worker vs Background Page
- v3 uses service workers instead of persistent background pages
- Service worker can be terminated after 5 minutes of inactivity
- Service worker cannot access content script directly (must use messaging)
- Service worker has limited DOM access

### Declared Permissions Required
- `storage` - For chrome.storage.local
- `activeTab` - For accessing current tab
- `scripting` - For injecting content scripts
- Host permissions for `https://*.slack.com/*`

### Content Script Behavior
- Injected based on manifest.json match patterns
- Runs in isolated context (separate execution scope from page)
- Can access DOM of injected page
- Cannot access page's JavaScript variables

