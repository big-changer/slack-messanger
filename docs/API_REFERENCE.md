# Slack Scrapping Extension - API Reference

## Data Structures

### SlackData

Complete data structure containing all scraped information from Slack workspace.

```typescript
interface SlackData {
  messages: SlackMessage[]
  channels: SlackChannel[]
  users: SlackUser[]
}
```

**JSON Representation:**
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
      "id": "C0123456789"
    }
  ],
  "users": [
    {
      "name": "john_doe",
      "id": "U0123456789",
      "realName": "John Doe"
    }
  ]
}
```

**Properties:**
| Property | Type | Description |
|----------|------|-------------|
| `messages` | SlackMessage[] | Array of messages scraped from Slack |
| `channels` | SlackChannel[] | Array of channels discovered |
| `users` | SlackUser[] | Array of users found in workspace |

---

### SlackMessage

Represents a single message scraped from Slack.

```typescript
interface SlackMessage {
  text: string           // Message content/body
  user: string           // Username of message sender
  timestamp: string      // ISO 8601 timestamp of message
  channel: string        // Channel name where message was posted
}
```

**Example:**
```json
{
  "text": "Great work on the project!",
  "user": "alice_smith",
  "timestamp": "2024-01-15T14:23:45.123Z",
  "channel": "project-updates"
}
```

**Properties:**
| Property | Type | Format | Example |
|----------|------|--------|---------|
| `text` | string | Plain text | "Great work on the project!" |
| `user` | string | Username | "alice_smith" |
| `timestamp` | string | ISO 8601 | "2024-01-15T14:23:45.123Z" |
| `channel` | string | Channel name | "project-updates" |

**Validation Rules:**
- `text`: Non-empty string
- `user`: Non-empty alphanumeric string with underscores
- `timestamp`: Valid ISO 8601 datetime
- `channel`: Non-empty string, typically lowercase with hyphens

**Deduplication:** Messages are deduplicated by exact match of `text`, `user`, and `timestamp`

---

### SlackChannel

Represents a Slack channel.

```typescript
interface SlackChannel {
  name: string          // Channel display name
  id: string            // Slack's internal channel ID
}
```

**Example:**
```json
{
  "name": "general",
  "id": "C0123456789ABCDEF01234"
}
```

**Properties:**
| Property | Type | Format | Example |
|----------|------|--------|---------|
| `name` | string | Display name | "general" or "project-updates" |
| `id` | string | Slack channel ID | "C0123456789ABCDEF01234" |

**Characteristics:**
- `name`: Typically lowercase, may contain hyphens and numbers
- `id`: 21-character string starting with 'C'

---

### SlackUser

Represents a Slack user.

```typescript
interface SlackUser {
  name: string          // Username/handle
  id: string            // Slack's internal user ID
  realName: string      // User's display name (full name)
}
```

**Example:**
```json
{
  "name": "john_doe",
  "id": "U0123456789ABCDEF01234",
  "realName": "John Doe"
}
```

**Properties:**
| Property | Type | Format | Example |
|----------|------|--------|---------|
| `name` | string | Username | "john_doe" or "alice.smith" |
| `id` | string | Slack user ID | "U0123456789ABCDEF01234" |
| `realName` | string | Display name | "John Doe" or "Alice Smith" |

**Characteristics:**
- `name`: Unique identifier, lowercase alphanumeric with underscores/dots
- `id`: 21-character string starting with 'U'
- `realName`: Human-readable display name, may contain spaces and special characters

---

## Chrome Storage API

### Storage Schema

All data persists in `chrome.storage.local` with the following schema:

```typescript
{
  isActive: boolean
  slackData: SlackData
}
```

### Storage Keys

#### Key: "isActive"

Type: `boolean`

Indicates whether scraping is currently active.

```typescript
// Get
const { isActive } = await chrome.storage.local.get('isActive')
if (isActive) { /* scraping is running */ }

// Set
await chrome.storage.local.set({ isActive: true })
await chrome.storage.local.set({ isActive: false })
```

**Values:**
- `true` - Scraping is active, periodic message collection is running
- `false` - Scraping is inactive

**Default:** `false` (set on extension installation)

---

#### Key: "slackData"

Type: `SlackData`

Contains all scraped data from Slack.

```typescript
// Get
const { slackData } = await chrome.storage.local.get('slackData')

// Set
const newData = {
  messages: [...],
  channels: [...],
  users: [...]
}
await chrome.storage.local.set({ slackData: newData })

// Access nested
const messageCount = slackData.messages.length
const firstUser = slackData.users[0]
```

**Default:**
```json
{
  "messages": [],
  "channels": [],
  "users": []
}
```

---

### Storage Operations

#### Read Data

```typescript
// Read single key
const { isActive } = await chrome.storage.local.get('isActive')

// Read multiple keys
const { isActive, slackData } = await chrome.storage.local.get(['isActive', 'slackData'])

// Read all data
const allData = await chrome.storage.local.get(null)

// Read with default fallback
const result = await chrome.storage.local.get({ isActive: false, slackData: { messages: [], channels: [], users: [] } })
```

#### Write Data

```typescript
// Update single key
await chrome.storage.local.set({ isActive: true })

// Update multiple keys
await chrome.storage.local.set({
  isActive: true,
  slackData: newData
})

// Partial updates (merge with existing)
await chrome.storage.local.set({
  slackData: {
    messages: [...],  // Replaces entire object
    channels: [...],
    users: [...]
  }
})
```

#### Clear Data

```typescript
// Clear single key
await chrome.storage.local.remove('isActive')

// Clear multiple keys
await chrome.storage.local.remove(['isActive', 'slackData'])

// Clear all data
await chrome.storage.local.clear()
```

#### Listen for Changes

```typescript
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    if (changes.isActive) {
      const newValue = changes.isActive.newValue
      const oldValue = changes.isActive.oldValue
      console.log(`isActive changed from ${oldValue} to ${newValue}`)
    }

    if (changes.slackData) {
      const newData = changes.slackData.newValue
      console.log(`Scraped ${newData.messages.length} messages`)
    }
  }
})
```

---

## Message Passing API

### Popup ↔ Content Script Communication

#### Message: startScraping

Start periodic message collection from Slack.

**Sender:** Popup (React component)
**Receiver:** Content Script

**Request Payload:**
```typescript
{
  action: 'startScraping'
}
```

**Sending:**
```typescript
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  chrome.tabs.sendMessage(tabs[0].id, {
    action: 'startScraping'
  })
})
```

**Receiving (Content Script):**
```typescript
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startScraping') {
    slackScraper.startScraping()
    sendResponse({ success: true })
  }
})
```

**Response:** (Optional)
```typescript
{ success: true }
```

**Side Effects:**
- Content script: Sets `isActive = true`
- Content script: Starts `scrapingInterval` (5-second loop)
- Storage: Updates `isActive` to `true`
- Periodic: Calls `scrapeMessages()`, `scrapeChannels()`, `scrapeUsers()`, `saveData()`

---

#### Message: stopScraping

Stop periodic message collection.

**Sender:** Popup (React component)
**Receiver:** Content Script

**Request Payload:**
```typescript
{
  action: 'stopScraping'
}
```

**Sending:**
```typescript
chrome.tabs.sendMessage(tabs[0].id, {
  action: 'stopScraping'
})
```

**Receiving (Content Script):**
```typescript
if (request.action === 'stopScraping') {
  slackScraper.stopScraping()
  sendResponse({ success: true })
}
```

**Response:** (Optional)
```typescript
{ success: true }
```

**Side Effects:**
- Content script: Sets `isActive = false`
- Content script: Clears `scrapingInterval`
- Storage: Updates `isActive` to `false`
- Scraping loop stops

---

#### Message: messageAllUsers

Send a message to all users in Slack workspace.

**Sender:** Popup (React component)
**Receiver:** Content Script

**Request Payload:**
```typescript
{
  action: 'messageAllUsers',
  content: string  // Message text to send to each user
}
```

**Sending:**
```typescript
const messageText = 'Hello! Check out this link: https://example.com'

chrome.tabs.sendMessage(tabs[0].id, {
  action: 'messageAllUsers',
  content: messageText
})
```

**Receiving (Content Script):**
```typescript
if (request.action === 'messageAllUsers') {
  slackScraper.messageAllUsersInPage(request.content)
  // Note: No immediate response; status updates sent via chrome.runtime.sendMessage
}
```

**Response:** None (asynchronous operation)

**Status Updates:** Content script sends periodic updates:
```typescript
chrome.runtime.sendMessage({
  action: 'updateClickStatus',
  status: 'Messaging user 15 of 50...'
})
```

**Side Effects:**
- Opens each user's DM
- Inserts message text
- Clicks send button
- Validates against blocklist
- Updates Slack workspace via UI automation
- Sends status updates to popup

---

#### Message: performInitialClicks

Navigate Slack UI to reach user directory. Typically clicking through channels and menus.

**Sender:** Popup (React component)
**Receiver:** Content Script

**Request Payload:**
```typescript
{
  action: 'performInitialClicks'
}
```

**Sending:**
```typescript
chrome.tabs.sendMessage(tabs[0].id, {
  action: 'performInitialClicks'
})
```

**Receiving (Content Script):**
```typescript
if (request.action === 'performInitialClicks') {
  slackScraper.performInitialClicks()
}
```

**Side Effects:**
- Clicks channel sidebar items in sequence
- Navigates to member directory
- Configures directory view for messaging

---

#### Message: performCustomClicks

Execute arbitrary DOM clicks specified by the user.

**Sender:** Popup (React component)
**Receiver:** Content Script

**Request Payload:**
```typescript
{
  action: 'performCustomClicks'
}
```

**Sending:**
```typescript
chrome.tabs.sendMessage(tabs[0].id, {
  action: 'performCustomClicks'
})
```

**Receiving (Content Script):**
```typescript
if (request.action === 'performCustomClicks') {
  slackScraper.performCustomClicks()
}
```

**Side Effects:**
- Performs hardcoded click sequence
- Useful for setting up specific UI states

---

### Content Script → Popup Communication

#### Message: updateClickStatus

Report progress of user messaging operation.

**Sender:** Content Script
**Receiver:** Popup (React component)

**Request Payload:**
```typescript
{
  action: 'updateClickStatus',
  status: string  // Status message to display
}
```

**Sending (Content Script):**
```typescript
chrome.runtime.sendMessage({
  action: 'updateClickStatus',
  status: 'Messaging user 15 of 50...'
})
```

**Receiving (Popup):**
```typescript
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'updateClickStatus') {
    setCurrentClickStatus(message.status)
  }
})
```

**Display:**
- Shows in popup UI text area
- Updates in real-time as messaging progresses

---

#### Message: dataUpdated

Report newly scraped data.

**Sender:** Content Script
**Receiver:** Popup (React component)

**Request Payload:**
```typescript
{
  action: 'dataUpdated',
  data: SlackData  // Updated scraped data
}
```

**Sending (Content Script):**
```typescript
chrome.runtime.sendMessage({
  action: 'dataUpdated',
  data: {
    messages: [...],
    channels: [...],
    users: [...]
  }
})
```

**Receiving (Popup):**
```typescript
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'dataUpdated') {
    setData(message.data)
  }
})
```

**Display:**
- Updates statistics (message count, channel count, user count)
- Refreshes all data displays in popup UI

---

## DOM Query API

### Message Selectors

**All messages on current page:**
```javascript
document.querySelectorAll('[data-qa="message"]')
```

**Message text:**
```javascript
messageElement.querySelector('[data-qa="message-text"]')?.textContent
```

**Message sender:**
```javascript
messageElement.querySelector('[data-qa="message-sender_name"]')?.textContent
```

**Message timestamp:**
```javascript
messageElement.querySelector('[data-qa="message-timestamp"]')?.textContent
```

---

### Channel Selectors

**All channels in sidebar:**
```javascript
document.querySelectorAll('[data-qa="channel_sidebar_name"]')
```

**Channel name:**
```javascript
channelElement.textContent
```

**Current channel name:**
```javascript
document.querySelector('[data-qa="channel_name"]')?.textContent
```

---

### User Selectors

**All user cells in directory:**
```javascript
document.getElementsByClassName("p-explorer_grid__cell")
```

**All user elements:**
```javascript
document.querySelectorAll('[data-qa="member"]')
```

**User name:**
```javascript
userElement.querySelector('[data-qa="member-name"]')?.textContent
```

**User real name:**
```javascript
userElement.querySelector('[data-qa="member-real-name"]')?.textContent
```

**User ID (from attribute):**
```javascript
userElement.getAttribute('data-member-id')
```

---

### UI Action Selectors

**Message button in profile sidebar:**
```javascript
document.querySelector('.p-member_profile_buttons__button--message')
```

**Rich text editor (message compose):**
```javascript
document.querySelector('.ql-editor')
```

**Send button:**
```javascript
document.querySelector('.c-wysiwyg_container__button--send')
```

**Pagination forward button:**
```javascript
document.querySelector('[data-qa="c-pagination_forward_btn"]')
```

**Sort selector (in directory):**
```javascript
document.querySelector('#sort-explorer-select')
```

**Directory toggle:**
```javascript
document.querySelector('#unified_directory')
```

---

## Utility Methods (Content Script)

### waitForElement

Asynchronously wait for an element to appear in DOM.

```typescript
private async waitForElement(
  selector: string,
  timeout?: number,
  interval?: number
): Promise<HTMLElement | null>
```

**Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `selector` | string | Required | CSS selector to query |
| `timeout` | number | 100000 | Maximum milliseconds to wait (100 seconds) |
| `interval` | number | 250 | Milliseconds between poll attempts |

**Returns:**
- `HTMLElement` if element found before timeout
- `null` if timeout exceeded

**Example:**
```typescript
const button = await this.waitForElement('.send-button', 5000, 100)
if (button) {
  button.click()
} else {
  console.warn('Send button not found')
}
```

**Behavior:**
1. Polls DOM every `interval` milliseconds
2. Returns immediately when element found
3. Waits additional 3 seconds after element found (for rendering)
4. Returns null after `timeout` milliseconds without finding element

**Use Cases:**
- Waiting for dynamic UI to load
- Waiting for modal dialogs to appear
- Waiting for form inputs to be ready
- Waiting for navigation to complete

---

### scrapeMessages

Query DOM for all messages on current page and add to collection.

```typescript
private scrapeMessages(): void
```

**Returns:** void (modifies internal `messages` array)

**Behavior:**
1. Queries `[data-qa="message"]` elements
2. For each message:
   - Extracts text, user, timestamp, channel
   - Checks for duplicates
   - Adds to `this.messages[]` if new
3. Logs results to console

**Example Output:**
```
Found 42 messages, added 5 new messages
```

---

### scrapeChannels

Query DOM for all channels and add to collection.

```typescript
private scrapeChannels(): void
```

**Returns:** void (modifies internal `channels` array)

**Behavior:**
1. Queries `[data-qa="channel_sidebar_name"]` elements
2. For each channel:
   - Extracts name and ID
   - Adds to `this.channels[]` (allows duplicates)
3. Logs results to console

---

### scrapeUsers

Query DOM for all users and add to collection.

```typescript
private scrapeUsers(): void
```

**Returns:** void (modifies internal `users` array)

**Behavior:**
1. Queries `[data-qa="member"]` elements
2. For each user:
   - Extracts name, ID, real name
   - Adds to `this.users[]` (allows duplicates)
3. Logs results to console

---

### saveData

Persist current data to chrome.storage.local.

```typescript
private saveData(): void
```

**Returns:** void

**Behavior:**
1. Creates SlackData object from internal state
2. Calls `chrome.storage.local.set({ slackData: ... })`
3. Sends update message to popup via `chrome.runtime.sendMessage()`

**Example:**
```typescript
this.saveData()
// Updates:
// - chrome.storage.local['slackData']
// - Popup receives 'dataUpdated' message
```

---

## Export Format

### JSON Export File

When user clicks "Export", a JSON file is downloaded with the following structure:

```json
{
  "messages": [
    {
      "text": "Hello everyone",
      "user": "john_doe",
      "timestamp": "2024-01-15T10:30:00Z",
      "channel": "general"
    },
    {
      "text": "Good morning",
      "user": "alice_smith",
      "timestamp": "2024-01-15T10:31:00Z",
      "channel": "general"
    }
  ],
  "channels": [
    {
      "name": "general",
      "id": "C0123456789ABCDEF01234"
    },
    {
      "name": "random",
      "id": "C9876543210FEDCBA98765"
    }
  ],
  "users": [
    {
      "name": "john_doe",
      "id": "U0123456789ABCDEF01234",
      "realName": "John Doe"
    },
    {
      "name": "alice_smith",
      "id": "U9876543210FEDCBA98765",
      "realName": "Alice Smith"
    }
  ]
}
```

**File Name:** `slack-data.json`

**File Type:** `application/json`

**Encoding:** UTF-8

**Size Limit:** No enforced limit (limited by browser download mechanism)

---

## Constants and Configuration

### Timing Configuration

```typescript
const SCRAPE_INTERVAL = 5000           // Milliseconds between scrape cycles
const ELEMENT_WAIT_TIMEOUT = 100000    // Milliseconds to wait for element
const ELEMENT_POLL_INTERVAL = 250      // Milliseconds between DOM polls
const RENDER_WAIT_TIME = 3000          // Milliseconds after element found
const USER_MESSAGE_STEP = 10           // Every Nth user to message
```

### DOM Selector Configuration

```typescript
const SELECTORS = {
  message: '[data-qa="message"]',
  messageText: '[data-qa="message-text"]',
  messageSender: '[data-qa="message-sender_name"]',
  messageTimestamp: '[data-qa="message-timestamp"]',

  channelSidebar: '[data-qa="channel_sidebar_name"]',
  currentChannel: '[data-qa="channel_name"]',

  userCell: '.p-explorer_grid__cell',
  member: '[data-qa="member"]',
  memberName: '[data-qa="member-name"]',
  memberRealName: '[data-qa="member-real-name"]',
  memberIdAttr: 'data-member-id',

  messageButton: '.p-member_profile_buttons__button--message',
  textEditor: '.ql-editor',
  sendButton: '.c-wysiwyg_container__button--send',
  paginationNext: '[data-qa="c-pagination_forward_btn"]',
  sortSelector: '#sort-explorer-select',
  directoryToggle: '#unified_directory'
}
```

### Validation Configuration

```typescript
const BLOCKLIST = ["01Booster_Akiko Iwamoto"]  // Users to skip

const VALID_NAME_REGEX = /^[a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF!@#\$%\^&\*\(\)_\+\-=\[\]\{\};:'",\.<>\/\?\\|`~ ]*$/
// Allows: alphanumeric, Japanese characters, common punctuation
```

---

## Error Codes

No formal error codes are defined. Errors are logged to console with following patterns:

```javascript
console.error(message)    // Critical errors
console.warn(message)     // Warnings (operation failed but continuing)
console.log(message)      // Information
```

**Common Warnings:**
- "Less than 4 channel sidebar items found in initial clicks."
- "No users found on this page."
- "send button not found on DM page."
- "Member name is in blocklist or invalid."

