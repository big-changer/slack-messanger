// Background script for Chrome extension
chrome.runtime.onInstalled.addListener(() => {
  console.log('Slack Scrapping Extension installed');
  
  // Initialize storage
  chrome.storage.local.set({
    isActive: false,
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
  }
  
  sendResponse({ success: true });
});

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  // This will open the popup automatically due to manifest configuration
  console.log('Extension icon clicked');
});
