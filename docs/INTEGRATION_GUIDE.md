# Slack Scrapping Extension - Integration & Extension Guide

## Overview

This guide explains how to extend, modify, and integrate new features into the Slack Scrapping Extension. It's designed for developers (including AI agents) who need to add functionality or adapt the extension.

---

## Architecture Review

Before making changes, understand the three-layer architecture:

```
┌─────────────────┐
│  Popup UI       │ (React Component)
│  (popup/*.tsx)  │ User interaction, display
└────────┬────────┘
         │ chrome.tabs.sendMessage()
         │ chrome.storage.local.get/set()
         │
┌────────▼────────────────────────┐
│  Content Script                 │
│  (content/index.ts)             │
│  DOM querying, automation,      │
│  data collection                │
└────────┬────────────────────────┘
         │
         ├─▶ DOM Access (Slack pages)
         ├─▶ chrome.storage.local
         └─▶ chrome.runtime.sendMessage()
```

**Key Principle:** Keep these three layers loosely coupled via message passing.

---

## Common Extension Patterns

### Pattern 1: Add a New Data Type to Collection

**Goal:** Collect a new data type (e.g., threads, reactions, files)

**Steps:**

1. **Add to SlackData interface** (conceptually, define in your code):
```typescript
interface SlackData {
  messages: SlackMessage[]
  channels: SlackChannel[]
  users: SlackUser[]
  threads?: SlackThread[]        // NEW
  reactions?: SlackReaction[]    // NEW
}
```

2. **Create new interface for the data type:**
```typescript
interface SlackThread {
  id: string
  parentMessageId: string
  replyCount: number
  participants: string[]
}

interface SlackReaction {
  emoji: string
  count: number
  users: string[]
}
```

3. **Add scraping method to SlackScraper:**
```typescript
private scrapeThreads(): void {
  // Find thread elements via DOM selectors
  const threadElements = document.querySelectorAll('[data-qa="thread-item"]')

  threadElements.forEach((element) => {
    const id = element.getAttribute('data-thread-id')
    const parentId = element.getAttribute('data-parent-id')
    const replyCount = parseInt(
      element.querySelector('[data-qa="reply-count"]')?.textContent || '0'
    )

    // ... extract other properties ...

    const thread: SlackThread = { id, parentMessageId: parentId, replyCount, participants: [] }
    this.threads.push(thread)
  })
}
```

4. **Add to periodic scraping:**
```typescript
public startScraping(): void {
  this.isActive = true
  this.scrapingInterval = setInterval(() => {
    this.scrapeMessages()
    this.scrapeChannels()
    this.scrapeUsers()
    this.scrapeThreads()    // NEW
    this.scrapeReactions()  // NEW
    this.saveData()
  }, 5000)
}
```

5. **Update saveData() to include new data:**
```typescript
private saveData(): void {
  const slackData: SlackData = {
    messages: this.messages,
    channels: this.channels,
    users: this.users,
    threads: this.threads,      // NEW
    reactions: this.reactions   // NEW
  }
  chrome.storage.local.set({ slackData })
  chrome.runtime.sendMessage({ action: 'dataUpdated', data: slackData })
}
```

6. **Update Popup to display new data:**
```typescript
<div>Threads: {data.threads?.length || 0}</div>
<div>Reactions: {data.reactions?.length || 0}</div>
```

---

### Pattern 2: Add a New Action Button

**Goal:** Add new button to popup for a custom action

**Steps:**

1. **Add button to Popup UI** (src/popup/App.tsx):
```typescript
<button onClick={handleCustomAction}>
  Custom Action
</button>
```

2. **Create handler function:**
```typescript
const handleCustomAction = () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, {
      action: 'customAction',
      data: { /* any parameters */ }
    })
  })
}
```

3. **Add message handler in Content Script:**
```typescript
private setupMessageListener(): void {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case 'startScraping':
        this.startScraping()
        break
      // ... other cases ...
      case 'customAction':  // NEW
        this.handleCustomAction(request.data)
        break
    }
  })
}

private async handleCustomAction(data: any): Promise<void> {
  try {
    // Implement your logic here
    console.log('Custom action executed', data)
  } catch (error) {
    console.error('Custom action failed:', error)
  }
}
```

4. **Send status update back** (if async):
```typescript
private async handleCustomAction(data: any): Promise<void> {
  chrome.runtime.sendMessage({
    action: 'updateClickStatus',
    status: 'Custom action in progress...'
  })

  // ... do work ...

  chrome.runtime.sendMessage({
    action: 'updateClickStatus',
    status: 'Custom action completed!'
  })
}
```

5. **Listen for updates in Popup:**
```typescript
useEffect(() => {
  const listener = (message: any) => {
    if (message.action === 'updateClickStatus') {
      setCurrentClickStatus(message.status)
    }
  }
  chrome.runtime.onMessage.addListener(listener)
  return () => chrome.runtime.onMessage.removeListener(listener)
}, [])
```

---

### Pattern 3: Modify DOM Selectors

**Goal:** Update element selectors when Slack changes their UI

**Steps:**

1. **Identify the broken selector:**
   - Open DevTools on Slack page
   - Inspect the element you need to find
   - Note the `data-qa`, `class`, `id`, or other attributes

2. **Update selector in Content Script:**
```typescript
// Before:
const messages = document.querySelectorAll('[data-qa="message"]')

// After (if Slack changed it):
const messages = document.querySelectorAll('[data-qa="slack-message-item"]')
```

3. **Test the selector:**
```javascript
// In page DevTools console
document.querySelectorAll('[data-qa="slack-message-item"]').length
// Should return >0 if selector is correct
```

4. **Update other references:**
   - Check for hardcoded class names
   - Update attribute selectors
   - Update CSS selectors in queries

5. **Test the extension:**
   - Rebuild: `npm run build`
   - Reload in Chrome
   - Verify data is still being collected

---

### Pattern 4: Add Persistent Configuration

**Goal:** Allow user to configure extension behavior (e.g., scrape interval, blocklist)

**Steps:**

1. **Define configuration structure:**
```typescript
interface ExtensionConfig {
  scrapeInterval: number          // milliseconds
  blocklist: string[]             // users to skip
  maxMessagesToCollect: number    // limit
  enableAutoMessage: boolean      // feature toggle
}
```

2. **Initialize in Background Script:**
```typescript
chrome.runtime.onInstalled.addListener(() => {
  const defaultConfig: ExtensionConfig = {
    scrapeInterval: 5000,
    blocklist: ["01Booster_Akiko Iwamoto"],
    maxMessagesToCollect: 10000,
    enableAutoMessage: true
  }

  chrome.storage.local.set({
    isActive: false,
    slackData: { messages: [], channels: [], users: [] },
    config: defaultConfig
  })
})
```

3. **Load config in Content Script:**
```typescript
private async loadConfig(): Promise<void> {
  const { config } = await chrome.storage.local.get('config')
  this.scrapeInterval = config?.scrapeInterval || 5000
  this.blocklist = config?.blocklist || []
}
```

4. **Add UI to Popup for configuration:**
```typescript
const [scrapeInterval, setScrapeInterval] = useState(5000)

<input
  type="number"
  value={scrapeInterval}
  onChange={(e) => setScrapeInterval(Number(e.target.value))}
  placeholder="Scrape interval (ms)"
/>

<button onClick={() => {
  chrome.storage.local.set({ config: { scrapeInterval } })
}}>
  Save Config
</button>
```

5. **Use config values:**
```typescript
this.scrapingInterval = setInterval(() => {
  // scraping logic
}, this.scrapeInterval)  // Use config value
```

---

### Pattern 5: Add Error Handling & Retry Logic

**Goal:** Make operations more robust

**Steps:**

1. **Wrap operations in try-catch:**
```typescript
private async scrapeMessagesWithRetry(maxRetries = 3): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      this.scrapeMessages()
      return  // Success
    } catch (error) {
      console.warn(`Scrape attempt ${attempt + 1} failed:`, error)
      if (attempt < maxRetries - 1) {
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
  }
  console.error(`Failed to scrape after ${maxRetries} attempts`)
}
```

2. **Add validation before operations:**
```typescript
private async messageAllUsersInPage(content: string): Promise<void> {
  // Validate input
  if (!content || content.trim().length === 0) {
    console.error('Message content cannot be empty')
    chrome.runtime.sendMessage({
      action: 'updateClickStatus',
      status: 'Error: Message content is empty'
    })
    return
  }

  // ... rest of implementation ...
}
```

3. **Handle async timeouts:**
```typescript
private async waitForElementWithTimeout(
  selector: string,
  timeout = 5000
): Promise<HTMLElement | null> {
  try {
    const element = await Promise.race([
      this.waitForElement(selector),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout))
    ])
    return element
  } catch (error) {
    console.error(`Timeout waiting for ${selector}:`, error)
    return null
  }
}
```

4. **Graceful degradation:**
```typescript
private scrapeMessages(): void {
  try {
    const elements = document.querySelectorAll('[data-qa="message"]')

    elements.forEach((element) => {
      try {
        const text = element.querySelector('[data-qa="message-text"]')?.textContent || ''
        const user = element.querySelector('[data-qa="message-sender_name"]')?.textContent || ''

        // Only add if we have minimum required data
        if (text && user) {
          // add to collection
        }
      } catch (elementError) {
        console.warn('Error processing message element:', elementError)
        // Continue with next element
      }
    })
  } catch (error) {
    console.error('Error in scrapeMessages:', error)
    // Return gracefully, try again next interval
  }
}
```

---

### Pattern 6: Add Local Filtering/Processing

**Goal:** Filter or transform collected data

**Steps:**

1. **Add filter methods to Content Script:**
```typescript
private filterMessagesByChannel(channelName: string): SlackMessage[] {
  return this.messages.filter(m => m.channel === channelName)
}

private filterMessagesByUser(username: string): SlackMessage[] {
  return this.messages.filter(m => m.user === username)
}

private filterMessagesByTime(hours: number): SlackMessage[] {
  const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000)
  return this.messages.filter(m => new Date(m.timestamp) > cutoffTime)
}
```

2. **Add transformation methods:**
```typescript
private getMessageStatistics() {
  return {
    totalMessages: this.messages.length,
    uniqueUsers: new Set(this.messages.map(m => m.user)).size,
    uniqueChannels: new Set(this.messages.map(m => m.channel)).size,
    messagesPerUser: this.messages.reduce((acc, m) => {
      acc[m.user] = (acc[m.user] || 0) + 1
      return acc
    }, {} as Record<string, number>)
  }
}
```

3. **Expose via message API:**
```typescript
case 'getStatistics':
  const stats = this.getMessageStatistics()
  sendResponse({ statistics: stats })
  break
```

4. **Use in Popup:**
```typescript
const [statistics, setStatistics] = useState(null)

const handleGetStatistics = () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: 'getStatistics' }, (response) => {
      setStatistics(response.statistics)
    })
  })
}
```

---

## Extending Functionality

### Add Feature: Scheduled Scraping

```typescript
// Add to Content Script
private schedules: NodeJS.Timeout[] = []

public startScheduledScraping(intervalMs: number): void {
  const mainInterval = setInterval(() => {
    this.scrapeMessages()
    this.scrapeChannels()
    this.scrapeUsers()
    this.saveData()
  }, intervalMs)

  this.schedules.push(mainInterval)
  console.log(`Started scheduled scraping every ${intervalMs}ms`)
}

public stopAllSchedules(): void {
  this.schedules.forEach(schedule => clearInterval(schedule))
  this.schedules = []
}
```

### Add Feature: Batch Export

```typescript
private async batchExport(batchSize: number = 100): Promise<void> {
  for (let i = 0; i < this.messages.length; i += batchSize) {
    const batch = this.messages.slice(i, i + batchSize)
    const filename = `slack-data-batch-${i/batchSize}.json`

    const blob = new Blob([JSON.stringify(batch)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()

    // Delay between batches to avoid browser throttling
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}
```

### Add Feature: Data Deduplication Improvement

```typescript
private deduplicateMessages(): void {
  const seen = new Set<string>()
  this.messages = this.messages.filter(message => {
    const key = `${message.text}|${message.user}|${message.timestamp}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Call periodically or on demand
case 'deduplicateData':
  this.deduplicateMessages()
  this.saveData()
  sendResponse({ success: true })
  break
```

---

## Testing Changes

### Manual Testing Checklist

- [ ] Open Slack in Chrome
- [ ] Load/reload extension from chrome://extensions/
- [ ] Open DevTools for page (Ctrl+Shift+I)
- [ ] Click extension icon to open popup
- [ ] Execute action (e.g., click "Start Scraping")
- [ ] Check console for errors (both page DevTools and popup)
- [ ] Verify Chrome storage updated (DevTools → Application → Storage)
- [ ] Verify UI displays updated (popup should show counts)
- [ ] Test export/download functionality
- [ ] Test clear data functionality
- [ ] Reload page - verify scraping resumes if was active

### Debug Logging

Add detailed logging for debugging:

```typescript
private log(message: string, data?: any): void {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] ${message}`, data || '')
}

// Usage
this.log('Starting to message users', { totalUsers: userCells.length })
this.log('Message sent successfully', { user: memberName })
this.log('Operation failed', { error: error.message })
```

---

## Common Modifications

### Modify: Change Scrape Interval

```typescript
// In src/content/index.ts, change:
}, 5000)  // 5 seconds

// To:
}, 10000)  // 10 seconds
```

### Modify: Change Popup Size

```html
<!-- In src/popup/index.html -->
<style>
  body {
    width: 500px;    <!-- was 350px -->
    height: 700px;   <!-- was 500px -->
  }
</style>
```

### Modify: Add Blocklist Entry

```typescript
// In src/content/index.ts
const blockList = [
  "01Booster_Akiko Iwamoto",
  "new_person_to_skip"  // NEW ENTRY
]
```

### Modify: Change DOM Selectors

If Slack updates their UI:
1. Open DevTools on Slack page
2. Inspect the element
3. Find the data-qa, class, or id attribute
4. Update in src/content/index.ts

Example:
```typescript
// Before
const messages = document.querySelectorAll('[data-qa="message"]')

// After (if Slack changed it)
const messages = document.querySelectorAll('[data-qa="slack-message"]')
```

---

## Message Protocol Extension

### Adding New Message Types

Follow this pattern when adding new message types:

```typescript
// 1. Define the action
type ContentAction = 'startScraping' | 'stopScraping' | 'messageAllUsers' | 'newAction'

// 2. Define request/response types
interface NewActionRequest {
  action: 'newAction'
  param1: string
  param2: number
}

interface NewActionResponse {
  success: boolean
  result?: any
  error?: string
}

// 3. Send from Popup
chrome.tabs.sendMessage(tabs[0].id, {
  action: 'newAction',
  param1: 'value1',
  param2: 42
} as NewActionRequest)

// 4. Handle in Content Script
case 'newAction':
  const request = request as NewActionRequest
  this.handleNewAction(request.param1, request.param2)
  break
```

---

## Dependencies & Imports

### Current Dependencies
```json
{
  "react": "^18.2.0",
  "react-dom": "^18.2.0"
}
```

### Adding New Dependencies

```bash
# Runtime dependency
npm install package-name

# Development dependency
npm install --save-dev package-name

# Update imports
import { something } from 'package-name'
```

### Type Definitions

```bash
# Install types for package
npm install --save-dev @types/package-name
```

---

## Storage API Best Practices

### Safe Storage Operations

```typescript
// Always use try-catch
async function safeSaveToStorage(key: string, value: any): Promise<boolean> {
  try {
    await chrome.storage.local.set({ [key]: value })
    return true
  } catch (error) {
    console.error(`Failed to save ${key}:`, error)
    return false
  }
}

async function safeLoadFromStorage(key: string): Promise<any> {
  try {
    const result = await chrome.storage.local.get(key)
    return result[key] || null
  } catch (error) {
    console.error(`Failed to load ${key}:`, error)
    return null
  }
}
```

### Monitor Storage Changes

```typescript
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    Object.keys(changes).forEach(key => {
      const change = changes[key]
      console.log(`${key} changed:`, {
        oldValue: change.oldValue,
        newValue: change.newValue
      })
    })
  }
})
```

---

## Type Safety

### Enforce Types

```typescript
// Always define interfaces for complex objects
interface SlackMessage {
  text: string
  user: string
  timestamp: string
  channel: string
}

// Use strict typing in functions
function processMessage(message: SlackMessage): void {
  // TypeScript ensures we access valid properties
  const sender = message.user  // OK
  const recipient = message.recipient  // ERROR: property doesn't exist
}
```

### Use Enums for Status

```typescript
enum ScraperState {
  IDLE = 'idle',
  SCRAPING = 'scraping',
  MESSAGING = 'messaging',
  ERROR = 'error'
}

private state: ScraperState = ScraperState.IDLE

public startScraping(): void {
  if (this.state === ScraperState.SCRAPING) return
  this.state = ScraperState.SCRAPING
}
```

---

## Performance Considerations

### Avoid Memory Leaks

```typescript
// Bad: Creates multiple intervals
startScraping() {
  setInterval(() => { /* ... */ }, 5000)
  setInterval(() => { /* ... */ }, 5000)
}

// Good: Store and clear reference
private scrapingInterval: NodeJS.Timeout | null = null

startScraping() {
  if (this.scrapingInterval) return
  this.scrapingInterval = setInterval(() => { /* ... */ }, 5000)
}

stopScraping() {
  if (this.scrapingInterval) {
    clearInterval(this.scrapingInterval)
    this.scrapingInterval = null
  }
}
```

### Debounce Frequent Operations

```typescript
private saveDataDebounced = this.debounce(() => this.saveData(), 1000)

private debounce(func: Function, wait: number) {
  let timeout: NodeJS.Timeout
  return function executedFunction(...args: any[]) {
    clearTimeout(timeout)
    timeout = setTimeout(() => func.apply(this, args), wait)
  }
}

// Usage: Call frequently, but only executes once per 1000ms
this.saveDataDebounced()
```

---

## Troubleshooting Integration Issues

### Issue: Message Not Reaching Content Script

```typescript
// Debug: Add logging
console.log('Sending message:', { action: 'startScraping' })

chrome.tabs.sendMessage(tabs[0].id, { action: 'startScraping' }, (response) => {
  console.log('Response received:', response)
  if (chrome.runtime.lastError) {
    console.error('Error sending message:', chrome.runtime.lastError.message)
  }
})
```

### Issue: Storage Data Not Persisting

```typescript
// Verify storage write succeeded
chrome.storage.local.set({ key: value }, () => {
  if (chrome.runtime.lastError) {
    console.error('Storage error:', chrome.runtime.lastError)
  } else {
    console.log('Data saved successfully')
  }

  // Immediately read back
  chrome.storage.local.get('key', (result) => {
    console.log('Stored value:', result.key)
  })
})
```

### Issue: DOM Selector Returns No Elements

```typescript
// Debug selector
const elements = document.querySelectorAll('[data-qa="message"]')
console.log('Found elements:', elements.length)

// If 0, try alternative selector
const alt = document.querySelectorAll('[role="article"]')
console.log('Alternative selector found:', alt.length)

// Inspect element in DevTools to find correct selector
// Right-click → Inspect → Note the HTML structure
```

---

## Checklist for Adding New Features

- [ ] Define data structures (interfaces/types)
- [ ] Add method(s) to SlackScraper class
- [ ] Add message handler in setupMessageListener()
- [ ] Add UI button/input in Popup (if user-facing)
- [ ] Add handler function in Popup component
- [ ] Send message from Popup to Content Script
- [ ] Update storage if persisting data
- [ ] Add error handling and logging
- [ ] Test manually in Chrome
- [ ] Update documentation
- [ ] Run `npm run type-check` for TypeScript errors
- [ ] Run `npm run build` for final build
- [ ] Test after reload in Chrome

