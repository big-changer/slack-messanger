// Content script for Slack scraping

// Custom logger for easy filtering
const logger = {
  log: (...args: any[]): void => console.log('EXT:DEBUG', ...args),
  warn: (...args: any[]): void => console.warn('EXT:DEBUG', ...args),
  error: (...args: any[]): void => console.error('EXT:DEBUG', ...args),
};

interface SlackMessage {
  text: string;
  user: string;
  timestamp: string;
  channel: string;
}

interface SlackChannel {
  name: string;
  id: string;
}

interface SlackUser {
  name: string;
  id: string;
  realName: string;
}

const regex = /^[a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF!@#\$%\^&\*\(\)_\+\-=\[\]\{\};:'",\.<>\/\?\\|`~ ]*$/;

class SlackScraper {
  private isActive: boolean = false;
  private messages: SlackMessage[] = [];
  private channels: SlackChannel[] = [];
  private users: SlackUser[] = [];
  private blacklist: string[] = [];

  // Utility function to wait for an element to appear in the DOM
  private async waitForElement(selector: string, timeout = 100000, interval = 250): Promise<HTMLElement | null> {
    const startTime = Date.now();
    return new Promise((resolve) => {
      const check = setInterval(() => {
        const element = document.querySelector(selector) as HTMLElement;
        if (element) {
          clearInterval(check);
          setTimeout(() => {
            resolve(element);
          }, 3000);
        } else if (Date.now() - startTime > timeout) {
          clearInterval(check);
          resolve(null);
        }
      }, interval);
    });
  }

  constructor() {
    this.setupMessageListener();
    this.loadState();
    this.loadBlacklist();
    // Listen for blacklist updates from storage
    chrome.storage.onChanged.addListener((changes) => {
      try {
        // New format: blacklistText
        if (changes.blacklistText) {
          const blacklistText = changes.blacklistText.newValue || '';
          this.blacklist = blacklistText
            .split(',')
            .map(name => name.trim().toLowerCase())
            .filter(name => name.length > 0);
          logger.log('Blacklist updated (new format):', this.blacklist);
        }
        // Old format fallback
        else if (changes.workspaceBlacklists) {
          const workspaceBlacklists = changes.workspaceBlacklists.newValue || {};
          const currentUrl = window.location.origin;
          let blacklistData = workspaceBlacklists[currentUrl] || [];

          if (typeof blacklistData === 'object' && !Array.isArray(blacklistData)) {
            blacklistData = Object.values(blacklistData) as string[];
          }

          this.blacklist = Array.isArray(blacklistData) ? blacklistData : [];
          logger.log('Blacklist updated (old format):', this.blacklist);
        }
      } catch (error) {
        logger.error('Error updating blacklist from storage:', error);
      }
    });
  }

  private async loadState() {
    const result = await chrome.storage.local.get(['isActive']);
    this.isActive = result.isActive || false;

    if (this.isActive) {
      this.startScraping();
    }
  }

  private async loadBlacklist() {
    try {
      // Try to load new format (plain text comma-separated)
      const result = await chrome.storage.local.get(['blacklistText']);

      if (result.blacklistText && typeof result.blacklistText === 'string') {
        // New format: comma-separated plain text
        logger.log('Loading blacklist from new format (text)');
        this.blacklist = result.blacklistText
          .split(',')
          .map(name => name.trim().toLowerCase())
          .filter(name => name.length > 0);
      } else {
        // Try old format for backwards compatibility
        const oldResult = await chrome.storage.local.get(['workspaceBlacklists']);
        const workspaceBlacklists = oldResult.workspaceBlacklists || {};

        logger.log('Old format detected, attempting migration...');

        // Try to extract from old format
        let blacklistData: any = [];
        try {
          const currentUrl = window.location.origin;
          blacklistData = workspaceBlacklists[currentUrl] || [];

          // Handle if it's an object instead of array
          if (typeof blacklistData === 'object' && !Array.isArray(blacklistData)) {
            blacklistData = Object.values(blacklistData) as string[];
          }
        } catch (e) {
          logger.warn('Failed to parse old format:', e);
        }

        if (Array.isArray(blacklistData) && blacklistData.length > 0) {
          // Migrate old format to new format
          const blacklistText = blacklistData.map((name: any) => String(name).trim().toLowerCase()).join(',');
          await chrome.storage.local.set({ blacklistText });
          logger.log('Migrated blacklist to new format:', blacklistText);
        }

        this.blacklist = Array.isArray(blacklistData) ? blacklistData : [];
      }

      logger.log('Loaded blacklist (array):', this.blacklist);
    } catch (error) {
      logger.error('Error loading blacklist:', error);
      this.blacklist = [];
    }
  }

  private setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'startScraping') {
        this.startScraping();
        sendResponse({ success: true });
      } else if (message.action === 'stopScraping') {
        this.stopScraping();
        sendResponse({ success: true });
      } else if (message.action === 'performInitialClicks') {
        this.performInitialClicks();
        sendResponse({ success: true });
      } else if (message.action === 'messageAllUsers') {
        const messageContent = message.content || ""; // Get message content from popup
        this.messageAllUsersInPage(messageContent);
        sendResponse({ success: true });
      }
    });
  }

  private async messageAllUsersInPage(messageContent: string) {
    try {
      this.sendClickStatus('Starting to message all users...');
      const userCells = document.getElementsByClassName("p-explorer_grid__cell");
      if (userCells.length === 0) {
        this.sendClickStatus('No users found on this page.');
        logger.warn('No users found on this page.');
        return;
      }

      for (let i = 0; i < userCells.length; i += 1) {
        const userCell = userCells[i] as HTMLElement;
        this.sendClickStatus(`Messaging user ${i + 1} of ${userCells.length}...`);
        logger.log(`Clicking user ${i + 1}:`, userCell);

        // Click the user cell to open the profile sidebar
        userCell.click();
        await this.waitForElement(".p-member_profile_buttons__button--message"); // Wait for sidebar and message button

        // Find and click the "Message" button
        const messageButton = document.getElementsByClassName("p-member_profile_buttons__button--message")[0] as HTMLElement;
        if (messageButton) {
          logger.log('Clicking Message button:', messageButton);
          messageButton.click();

          // Wait for DM page to load and ql-editor to appear
          const qlEditor = await this.waitForElement(".ql-editor");
          if (qlEditor) {
            // check name
            const memberName = (document.querySelector('[data-qa="member_name"]') as HTMLElement).textContent?.trim();
            logger.log(`===== USER NAME: "${memberName}" =====`);
            logger.log(`BLACKLIST USERS:`, this.blacklist);
            const isBlacklisted = this.blacklist.includes(memberName?.toLowerCase());
            logger.log(`Is "${memberName}" blacklisted? ${isBlacklisted}`);
            if (regex.test(memberName) && !isBlacklisted) {
              logger.log('Found ql-editor, pasting message...');
              qlEditor.focus(); // Focus the editor to ensure it's ready for input
              document.execCommand('insertText', false, messageContent); // Paste the message
              // For complex content or if execCommand fails, you might need to simulate keyboard input
              await new Promise(resolve => setTimeout(resolve, 1000));
              const sendButton = await this.waitForElement(".c-wysiwyg_container__button--send");
              if (sendButton) {
                logger.log('Clicking send button:', sendButton);
                // sendButton.click();
                sendButton.click();
                await new Promise(resolve => setTimeout(resolve, 1000)); // Still need a short wait on DM page
                logger.log('Navigating back...');

                // Track the last messaged user
                this.notifyUserMessaged(memberName);

                history.back();
                await this.waitForElement(".p-explorer_grid__cell"); // Wait for user list to reappear
              } else {
                logger.warn('send button not found on DM page.');
              }
            } else {
              history.back();
              await this.waitForElement(".p-explorer_grid__cell"); // Wait for user list to reappear
            }
          } else {
            logger.warn('ql-editor not found on DM page.');
            this.sendClickStatus(`Error: ql-editor not found for user ${i + 1}.`);
          }
        } else {
          logger.warn('"Message" button not found for user.');
          this.sendClickStatus(`Error: "Message" button not found for user ${i + 1}.`);
          // Even if message button not found, go back to continue with next user
          history.back();
          await this.waitForElement(".p-explorer_grid__cell");
        }
      }

      this.sendClickStatus('Finished messaging all users on this page.');
      logger.log('Finished messaging all users on this page.');

      // Check for next page button and paginate
      const nextPageButton = document.querySelector('[data-qa="c-pagination_forward_btn"]') as HTMLElement;
      // Check if button exists and is not disabled (aria-disabled attribute is 'false' or not present)
      const isDisabled = nextPageButton?.getAttribute('aria-disabled') === 'true';
      if (nextPageButton && !isDisabled) {
        this.sendClickStatus('Navigating to next page...');
        logger.log('Clicking next page button:', nextPageButton);
        nextPageButton.click();
        await this.waitForElement(".p-explorer_grid__cell"); // Wait for new page's user list to load
        this.messageAllUsersInPage(messageContent); // Recursively call for the next page
      } else {
        this.sendClickStatus('No more pages or next page button is disabled. Messaging completed!');
        logger.log('No more pages or next page button is disabled. Messaging completed!');
      }

    } catch (error) {
      logger.error('Error messaging all users:', error);
      this.sendClickStatus(`Error during messaging: ${(error as Error).message}`);
    }
  }

  private async performInitialClicks() {
    try {
      logger.log('Performing initial clicks...');
      this.sendClickStatus('Starting initial clicks...');

      // Click 4th item of document.getElementsByClassName("p-channel_sidebar__name")
      const channelSidebarItems = document.getElementsByClassName("p-channel_sidebar__name");
      if (channelSidebarItems.length >= 4) {
        (channelSidebarItems[3] as HTMLElement).click();
        logger.log('Clicked 4th channel sidebar item.');
        this.sendClickStatus('Clicked 4th channel sidebar item.');
        await new Promise(resolve => setTimeout(resolve, 1000)); // Still need a short wait
      } else {
        logger.warn('Less than 4 channel sidebar items found in initial clicks.');
        this.sendClickStatus('Error: Less than 4 channel sidebar items found.');
      }

      // Select 1st sub item of document.getElementById("unified_directory")
      const unifiedDirectoryMenu = await this.waitForElement("#unified_directory");
      if (unifiedDirectoryMenu) {
        (unifiedDirectoryMenu as HTMLElement).click();
        logger.log('Clicked unified_directory.');
        this.sendClickStatus('Clicked unified_directory.');
        await new Promise(resolve => setTimeout(resolve, 1000)); // Still need a short wait
      } else {
        logger.warn('unifiedDirectoryMenu not found in initial clicks.');
        this.sendClickStatus('Error: unifiedDirectoryMenu not found.');
      }

      // Click document.getElementById("sort-explorer-select")
      const sortExplorerSelect = await this.waitForElement("#sort-explorer-select");
      if (sortExplorerSelect) {
        (sortExplorerSelect as HTMLElement).click();
        logger.log('Clicked sort-explorer-select.');
        this.sendClickStatus('Clicked sort-explorer-select.');
        await new Promise(resolve => setTimeout(resolve, 1000)); // Still need a short wait

        // Click document.getElementById("sort-explorer-select_option_1")
        const sortExplorerSelectOption1 = await this.waitForElement("#sort-explorer-select_option_1");
        if (sortExplorerSelectOption1) {
          (sortExplorerSelectOption1 as HTMLElement).click();
          logger.log('Clicked sort-explorer-select_option_1.');
          this.sendClickStatus('Clicked sort-explorer-select_option_1. Clicks completed!');
        } else {
          logger.warn('sort-explorer-select_option_1 not found.');
          this.sendClickStatus('Error: sort-explorer-select_option_1 not found.');
        }
      } else {
        logger.warn('sort-explorer-select not found.');
        this.sendClickStatus('Error: sort-explorer-select not found.');
      }
    } catch (error) {
      logger.error('Error performing initial clicks:', error);
      this.sendClickStatus(`Error during clicks: ${(error as Error).message}`);
    }
  }

  private sendClickStatus(status: string) {
    chrome.runtime.sendMessage({ action: 'updateClickStatus', status });
  }

  private notifyUserMessaged(userName: string) {
    const serverNameElement = document.querySelector('.p-ia4_home_header_menu__team_name span');
    const serverName = serverNameElement?.textContent?.trim() || 'Unknown Server';
    chrome.runtime.sendMessage({
      action: 'userMessaged',
      userName,
      serverName,
      workspaceUrl: window.location.origin
    });
  }


  private startScraping() {
    this.isActive = true;
    logger.log('Starting Slack scraping...');

    // Scrape initial data
    this.scrapeMessages();
    this.scrapeChannels();
    this.scrapeUsers();

    // Set up periodic scraping
    this.scrapingInterval = setInterval(() => {
      this.scrapeMessages();
    }, 5000); // Scrape every 5 seconds
  }

  private stopScraping() {
    this.isActive = false;
    logger.log('Stopping Slack scraping...');

    if (this.scrapingInterval) {
      clearInterval(this.scrapingInterval);
    }
  }

  private scrapeMessages() {
    try {
      // Look for message elements in Slack's DOM
      const messageElements = document.querySelectorAll('[data-qa="message"]');

      messageElements.forEach((element) => {
        const textElement = element.querySelector('[data-qa="message-text"]');
        const userElement = element.querySelector('[data-qa="message-sender_name"]');
        const timestampElement = element.querySelector('[data-qa="message-timestamp"]');

        if (textElement && userElement) {
          const message: SlackMessage = {
            text: textElement.textContent || '',
            user: userElement.textContent || '',
            timestamp: timestampElement?.textContent || new Date().toISOString(),
            channel: this.getCurrentChannel()
          };

          // Avoid duplicates
          const exists = this.messages.some(m =>
            m.text === message.text &&
            m.user === message.user &&
            m.timestamp === message.timestamp
          );

          if (!exists) {
            this.messages.push(message);
          }
        }
      });

      this.saveData();
    } catch (error) {
      logger.error('Error scraping messages:', error);
    }
  }

  private scrapeChannels() {
    try {
      const channelElements = document.querySelectorAll('[data-qa="channel_sidebar_name"]');

      channelElements.forEach((element) => {
        const channelName = element.textContent?.trim();
        if (channelName) {
          const channel: SlackChannel = {
            name: channelName,
            id: element.getAttribute('data-channel-id') || ''
          };

          const exists = this.channels.some(c => c.name === channel.name);
          if (!exists) {
            this.channels.push(channel);
          }
        }
      });

      this.saveData();
    } catch (error) {
      logger.error('Error scraping channels:', error);
    }
  }

  private scrapeUsers() {
    try {
      const userElements = document.querySelectorAll('[data-qa="member"]');

      userElements.forEach((element) => {
        const nameElement = element.querySelector('[data-qa="member-name"]');
        const realNameElement = element.querySelector('[data-qa="member-real-name"]');

        if (nameElement) {
          const user: SlackUser = {
            name: nameElement.textContent?.trim() || '',
            id: element.getAttribute('data-member-id') || '',
            realName: realNameElement?.textContent?.trim() || ''
          };

          const exists = this.users.some(u => u.name === user.name);
          if (!exists) {
            this.users.push(user);
          }
        }
      });

      this.saveData();
    } catch (error) {
      logger.error('Error scraping users:', error);
    }
  }

  private getCurrentChannel(): string {
    const channelElement = document.querySelector('[data-qa="channel_name"]');
    return channelElement?.textContent?.trim() || 'unknown';
  }

  private async saveData() {
    const slackData = {
      messages: this.messages,
      channels: this.channels,
      users: this.users
    };

    await chrome.storage.local.set({ slackData });

    // Notify popup of data update
    chrome.runtime.sendMessage({
      action: 'dataUpdated',
      data: slackData
    });
  }

  private scrapingInterval?: NodeJS.Timeout;
}

// Initialize the scraper
new SlackScraper();
