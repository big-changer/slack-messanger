import React, { useState, useEffect } from 'react';
import './App.css';

const App: React.FC = () => {
  const [messageContent, setMessageContent] = useState<string>("Hello, How are you doing?");
  const [lastMessagedUser, setLastMessagedUser] = useState<string>("");
  const [serverName, setServerName] = useState<string>("");
  const [workspaceUrl, setWorkspaceUrl] = useState<string>("");
  const [blacklist, setBlacklist] = useState<string[]>([]);
  const [blacklistText, setBlacklistText] = useState<string>("");
  const [isPaused, setIsPaused] = useState<boolean>(false);



  useEffect(() => {
    const currentUrl = window.location.origin;

    // Load last messaged users, message content, blacklist, and pause state from Chrome storage
    chrome.storage.local.get(['lastMessagedUsers', 'blacklistText', 'messageContent', 'isPaused'], (result) => {
      if (result.lastMessagedUsers) {
        const lastUser = result.lastMessagedUsers[currentUrl] || '';
        setLastMessagedUser(lastUser);
      }
      // Load message content
      if (result.messageContent && typeof result.messageContent === 'string') {
        setMessageContent(result.messageContent);
      }
      // Load new format (plain text comma-separated)
      if (result.blacklistText && typeof result.blacklistText === 'string') {
        const blacklistArray = result.blacklistText
          .split(',')
          .map(name => name.trim())
          .filter(name => name.length > 0);
        setBlacklist(blacklistArray);
        setBlacklistText(result.blacklistText);
      }
      // Load pause state
      if (typeof result.isPaused === 'boolean') {
        setIsPaused(result.isPaused);
      }
      // sort option removed
    });

    // Listen for user messaged updates from the content script
    const messageListener = (message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
      console.log('Popup received message:', message, 'from sender:', sender);
      if (message.action === 'userMessaged') {
        console.log('Updating last messaged user to:', message.userName);
        // Update the last messaged user when a user is messaged
        setLastMessagedUser(message.userName);
        setServerName(message.serverName || '');
        setWorkspaceUrl(message.workspaceUrl || '');

        chrome.storage.local.get(['lastMessagedUsers'], (result) => {
          if (chrome.runtime.lastError) {
            console.error('Error getting lastMessagedUsers from storage:', chrome.runtime.lastError);
          } else {
            console.log('Got lastMessagedUsers from storage:', result.lastMessagedUsers);
            const lastMessagedUsers = result.lastMessagedUsers || {};
            lastMessagedUsers[currentUrl] = message.userName;
            console.log('Setting lastMessagedUsers:', lastMessagedUsers);
            chrome.storage.local.set({ lastMessagedUsers }, () => {
              if (chrome.runtime.lastError) {
                console.error('Error setting lastMessagedUsers in storage:', chrome.runtime.lastError);
              } else {
                console.log('Successfully saved lastMessagedUsers to storage');
              }
            });
          }
        });
      }
      sendResponse();
    };

    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  // Persist message content to storage whenever it changes
  useEffect(() => {
    chrome.storage.local.set({ messageContent });
  }, [messageContent]);



  const handleMessageAllUsers = async () => {
    // Send message only to the active Slack tab
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!activeTab || !activeTab.url || !activeTab.url.includes("slack.com") || !activeTab.id) {
      alert("Active tab is not a Slack workspace. Please focus a Slack tab and try again.");
      return;
    }

    await new Promise<void>((resolve, reject) => {
      chrome.tabs.sendMessage(
        activeTab.id as number,
        { action: "messageAllUsers", content: messageContent },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error("Error sending message to active Slack tab:", chrome.runtime.lastError.message);
            alert("Could not connect to the active Slack tab. Please make sure the extension is allowed on this page and try again.");
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          console.log("Messaging started on active Slack tab:", {
            tabId: activeTab.id,
            url: activeTab.url,
            response,
          });
          resolve();
        }
      );
    });
  };

  const handlePauseResume = () => {
    const newPausedState = !isPaused;
    setIsPaused(newPausedState);

    // Save pause state to storage
    chrome.storage.local.set({ isPaused: newPausedState }, () => {
      console.log(`Messaging ${newPausedState ? 'paused' : 'resumed'}`);
    });

    // Notify all Slack tabs about pause state
    chrome.tabs.query({ url: '*://app.slack.com/*' }, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            action: 'togglePause',
            isPaused: newPausedState
          }).catch(() => {
            // Tab might not be ready, ignore error
          });
        }
      });
    });
  };

  const updateBlacklistFromText = () => {
    // Parse comma-separated values and trim whitespace
    const parsed = blacklistText
      .split(',')
      .map((user) => user.trim())
      .filter((user) => user.length > 0);

    // Save as plain text comma-separated format
    chrome.storage.local.set({ blacklistText: parsed.join(',') });
    setBlacklist(parsed);
  };

  const clearBlacklist = () => {
    if (confirm('Are you sure you want to clear the blacklist?')) {
      chrome.storage.local.set({ blacklistText: '' });
      setBlacklist([]);
      setBlacklistText('');
    }
  };

  const getAllWorkspaceBlacklists = () => {
    chrome.storage.local.get(['workspaceBlacklists'], (result) => {
      const workspaceBlacklists = result.workspaceBlacklists || {};
      const allUsers: Set<string> = new Set();

      // Collect all users from all workspaces (old format migration)
      Object.values(workspaceBlacklists).forEach((users: any) => {
        if (Array.isArray(users)) {
          users.forEach((user) => {
            allUsers.add(String(user).trim().toLowerCase());
          });
        } else if (typeof users === 'object') {
          Object.values(users).forEach((user: any) => {
            allUsers.add(String(user).trim().toLowerCase());
          });
        }
      });

      // Combine with current blacklistText
      const currentBlacklist = blacklistText
        .split(',')
        .map(name => name.trim().toLowerCase())
        .filter(name => name.length > 0);

      currentBlacklist.forEach(user => allUsers.add(user));

      const mergedList = Array.from(allUsers).join(', ');
      setBlacklistText(mergedList);
      setBlacklist(Array.from(allUsers));
    });
  };


  return (
    <div className="app">
      <header className="app-header">
        <h1>Slack Scrapper</h1>
      </header>

      <main className="app-main">
        <div className="custom-action-section">
          {serverName && (
            <div className="server-info">
              <p>Server: <strong>{serverName}</strong></p>
            </div>
          )}

          {lastMessagedUser && (
            <div className="last-messaged-user">
              <p>Last Messaged User: <strong>{lastMessagedUser}</strong></p>
            </div>
          )}





          <div className="textarea-group">
            <label className="textarea-label">Message Content</label>
            <textarea
              placeholder="Enter message content..."
              className="message-textarea"
              value={messageContent}
              onChange={(e) => setMessageContent(e.target.value)}
              rows={3}
            />
          </div>

          <div className="button-group">
            <button className="action-btn message-all-btn" onClick={handleMessageAllUsers}>
              Send All Messages
            </button>
            <button className={`action-btn pause-resume-btn ${isPaused ? 'resumed' : 'paused'}`} onClick={handlePauseResume}>
              {isPaused ? 'Resume' : 'Pause'}
            </button>
          </div>
        </div>

        <div className="blacklist-section">
          <h3>Blacklist ({blacklist.length})</h3>
          <div className="textarea-group">
            <label className="textarea-label">Blocked Users</label>
            <textarea
              className="blacklist-textarea"
              value={blacklistText}
              onChange={(e) => setBlacklistText(e.target.value)}
              placeholder="user1, user2, user3"
              rows={5}
            />
          </div>

          <div className="blacklist-button-group">
            <button className="action-btn update-btn" onClick={updateBlacklistFromText}>
              Update Blacklist
            </button>
            <button className="action-btn sync-btn" onClick={getAllWorkspaceBlacklists}>
              Get Blacklist (Sync All)
            </button>
            <button className="action-btn clear-btn-small" onClick={clearBlacklist}>
              Clear All
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
