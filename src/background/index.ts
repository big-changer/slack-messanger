// Background script for Chrome extension
let keepaliveInterval: NodeJS.Timeout | null = null;
const KEEPALIVE_ALARM_NAME = 'slack-messaging-keepalive';

// Timestamp helper
function getTimestamp(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `[${hours}:${minutes}:${seconds}.${ms}]`;
}

chrome.runtime.onInstalled.addListener(() => {
  console.log(`BG:DEBUG ${getTimestamp()} Slack Scrapping Extension installed`);

  // Initialize storage
  chrome.storage.local.set({
    isActive: false,
    sendToExistingDm: false,
    keepTabFocused: false,
    slackData: {
      messages: [],
      channels: [],
      users: []
    }
  });
});

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'dataUpdated') {
    // Forward data update to popup if it's open
    chrome.runtime.sendMessage(message).catch(() => {
      // Popup might not be open, ignore error
    });
  } else if (message.action === 'keepalive') {
    // Content script is sending keepalive - use this to drive messaging if active
    handleBackgroundMessaging(sender.tab?.id).catch((error) => {
      console.error(`BG:DEBUG ${getTimestamp()} Error in background messaging:`, error);
    });
  } else if (message.action === 'getTabId') {
    // Return the sender's tab ID
    sendResponse({ tabId: sender.tab?.id });
    return;
  } else if (message.action === 'ensureTabAwake') {
    ensureTabAwake(sender.tab?.id).then((result) => {
      sendResponse(result);
    }).catch((error) => {
      console.error(`BG:DEBUG ${getTimestamp()} Error waking tab:`, error);
      sendResponse({ success: false, error: String(error) });
    });
    return true;
  }

  sendResponse({ success: true });
});

chrome.runtime.onStartup.addListener(() => {
  startKeepalive();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM_NAME) {
    pingSlackTabs().catch((error) => {
      console.error(`BG:DEBUG ${getTimestamp()} Error during keepalive alarm:`, error);
    });
  }
});

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  // This will open the popup automatically due to manifest configuration
  console.log(`BG:DEBUG ${getTimestamp()} Extension icon clicked`);
});

// Background messaging handler - drives messaging from background script
async function handleBackgroundMessaging(tabId?: number) {
  if (!tabId) return;

  try {
    // Store the fact that this tab is active in background processing
    const result = await chrome.storage.local.get(['activeMessagingTab']);
    if (result.activeMessagingTab === tabId) {
      // This tab is currently doing background messaging, send a nudge
      chrome.tabs.sendMessage(tabId, { action: 'nudgeMessaging' }).catch(() => {
        // Tab might not be ready
      });
    }
  } catch (error) {
    console.error(`BG:DEBUG ${getTimestamp()} Error in handleBackgroundMessaging:`, error);
  }
}

async function ensureTabAwake(tabId?: number) {
  if (!tabId) {
    return { success: false, error: 'No tab id available' };
  }

  const tab = await chrome.tabs.get(tabId);
  if (tab.windowId !== undefined) {
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
  }

  await chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
  return { success: true };
}

async function pingSlackTabs() {
  const tabs = await chrome.tabs.query({ url: '*://*.slack.com/*' });
  tabs.forEach((tab) => {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'keepalive' }).catch(() => {
        // Tab might be closed or content script not ready, ignore
      });
    }
  });
}

// Start aggressive keepalive mechanism
function startKeepalive() {
  // Send keepalive pings every 2 seconds to all Slack tabs (more aggressive)
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval);
  }

  chrome.alarms.create(KEEPALIVE_ALARM_NAME, { periodInMinutes: 0.5 });

  keepaliveInterval = setInterval(() => {
    pingSlackTabs().catch((error) => {
      console.error(`BG:DEBUG ${getTimestamp()} Error sending keepalive:`, error);
    });
  }, 2000); // More aggressive - every 2 seconds instead of 5
}

// Start keepalive on load
startKeepalive();
