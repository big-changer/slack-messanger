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
  private lastMessagedUser: string = ''; // Track the last messaged user for resume logic

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

  // Utility function to wait for an element to be enabled (aria-disabled !== 'true')
  private async waitForElementEnabled(selector: string, timeout = 100000, interval = 250): Promise<HTMLElement | null> {
    const startTime = Date.now();
    return new Promise((resolve) => {
      const check = setInterval(() => {
        const element = document.querySelector(selector) as HTMLElement;
        if (element) {
          const isDisabled = element.getAttribute('aria-disabled') === 'true';
          if (!isDisabled) {
            clearInterval(check);
            setTimeout(() => {
              resolve(element);
            }, 500);
          }
        }
        if (Date.now() - startTime > timeout) {
          clearInterval(check);
          logger.warn(`Element enabled not found or still disabled after ${timeout}ms: ${selector}`);
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

  private async messageAllUsersInPage(messageContent: string, skipUntilLastUser: boolean = false) {
    try {
      this.sendClickStatus('Starting to message all users...');

      // Ensure sort is set to "A to Z" before starting
      await this.ensureSortIsAtoZ();

      const userCells = document.getElementsByClassName("p-explorer_grid__cell");
      if (userCells.length === 0) {
        this.sendClickStatus('No users found on this page.');
        logger.warn('No users found on this page.');
        return;
      }
      logger.log(`Start scrapping for ${userCells.length} users`);
      let shouldSkip = skipUntilLastUser;
      if (shouldSkip) {
        logger.log(`Skipping users until we find last messaged user: "${this.lastMessagedUser}"`);
        this.sendClickStatus(`Resuming from: ${this.lastMessagedUser}`);
      }

      for (let i = 0; i < userCells.length; i += 1) {
        // Periodically check if sort has reset (every 5 users)
        if (i % 5 === 0) {
          await this.ensureSortIsAtoZ();
        }
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

          // Wait for DM page to load and message input to appear
          const messageInputDiv = await this.waitForElement('[data-qa="message_input"]');
          if (!messageInputDiv) {
            logger.warn('Message input container not found on DM page.');
            this.sendClickStatus(`Error: message_input not found for user ${i + 1}.`);
            history.back();
            await this.waitForElement(".p-explorer_grid__cell");
            continue;
          }

          logger.log('Found message_input container, looking for ql-editor...');
          const qlEditor = messageInputDiv.querySelector(".ql-editor") as HTMLElement;

          if (!qlEditor) {
            logger.warn('ql-editor not found inside message_input container.');
            this.sendClickStatus(`Error: ql-editor not found for user ${i + 1}.`);
            history.back();
            await this.waitForElement(".p-explorer_grid__cell");
            continue;
          }

          try {
            // check name - safely get member name with null checking
            const memberNameElement = document.querySelector('[data-qa="member_name"]') as HTMLElement | null;
            if (!memberNameElement) {
              logger.warn('Member name element not found on DM page');
              this.sendClickStatus(`Error: member_name element not found for user ${i + 1}.`);
              history.back();
              await this.waitForElement(".p-explorer_grid__cell");
              continue;
            }

            const memberName = memberNameElement.textContent?.trim();
            if (!memberName) {
              logger.warn('Member name is empty or null');
              this.sendClickStatus(`Error: member name is empty for user ${i + 1}.`);
              history.back();
              await this.waitForElement(".p-explorer_grid__cell");
              continue;
            }

            logger.log(`===== USER NAME: "${memberName}" =====`);

            // Check if we've reached the last messaged user when resuming
            if (shouldSkip && memberName.toLowerCase() === this.lastMessagedUser.toLowerCase()) {
              logger.log(`Found last messaged user: "${memberName}", resuming messaging...`);
              this.sendClickStatus(`Found last messaged user: ${memberName}, resuming...`);
              shouldSkip = false; // Resume messaging from next user
              history.back();
              await this.waitForElement(".p-explorer_grid__cell");
              continue; // Skip this user, start messaging from next one
            }

            // Skip messaging if we haven't found the last messaged user yet
            if (shouldSkip) {
              logger.log(`Skipping user "${memberName}" - still looking for last messaged user "${this.lastMessagedUser}"`);
              history.back();
              await this.waitForElement(".p-explorer_grid__cell");
              continue;
            }

            logger.log(`BLACKLIST USERS:`, this.blacklist);
            const isBlacklisted = this.blacklist.includes(memberName.toLowerCase());
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
                sendButton.click();
                await new Promise(resolve => setTimeout(resolve, 1000)); // Still need a short wait on DM page
                logger.log('Navigating back...');

                // Track the last messaged user
                this.notifyUserMessaged(memberName);

                history.back();
                await this.waitForElement(".p-explorer_grid__cell"); // Wait for user list to reappear
              } else {
                logger.warn('send button not found on DM page.');
                history.back();
                await this.waitForElement(".p-explorer_grid__cell");
              }
            } else {
              logger.log('User is blacklisted or name regex test failed, skipping...');
              history.back();
              await this.waitForElement(".p-explorer_grid__cell"); // Wait for user list to reappear
            }
          } catch (error) {
            logger.error('Error processing user message:', error);
            this.sendClickStatus(`Error processing user ${i + 1}: ${(error as Error).message}`);
            history.back();
            await this.waitForElement(".p-explorer_grid__cell");
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

      // Check for next page button and paginate - wait until it's enabled
      logger.log('Waiting for next page button to be enabled...');
      let nextPageButton = await this.waitForElementEnabled('[data-qa="c-pagination_forward_btn"]', 10000); // Wait up to 10 seconds for button to be enabled

      // If button not found, check if sort changed and fix it, then retry
      if (!nextPageButton) {
        logger.log('Next page button not found. Checking if sort changed...');
        this.sendClickStatus('Next button not found, checking sort order...');

        // Check and ensure sort is "A to Z"
        const sortButton = document.getElementById('sort-explorer-select') as HTMLElement;
        if (sortButton) {
          const sortStatusSpan = sortButton.querySelector('span') as HTMLElement;
          const currentSort = sortStatusSpan?.textContent?.trim() || '';
          logger.log(`Current sort: "${currentSort}"`);

          if (currentSort !== 'A to Z') {
            logger.log('Sort is not "A to Z", fixing it...');
            this.sendClickStatus('Fixing sort order...');
            await this.ensureSortIsAtoZ();

            // Retry finding the next page button after fixing sort
            logger.log('Retrying to find next page button after sort fix...');
            nextPageButton = await this.waitForElementEnabled('[data-qa="c-pagination_forward_btn"]', 10000);
          }
        }
      }

      if (nextPageButton) {
        this.sendClickStatus('Navigating to next page...');
        logger.log('Clicking next page button:', nextPageButton);
        nextPageButton.click();
        await this.waitForElement(".p-explorer_grid__cell"); // Wait for new page's user list to load
        await this.ensureSortIsAtoZ(); // Ensure sort is maintained after pagination
        // Resume from last messaged user when continuing to next page
        this.messageAllUsersInPage(messageContent, true);
      } else {
        this.sendClickStatus('No more pages or next button not enabled. Messaging completed!');
        logger.log('No more pages or next button not enabled. Messaging completed!');
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
    // Track the last messaged user for resume logic
    this.lastMessagedUser = userName;

    const serverNameElement = document.querySelector('.p-ia4_home_header_menu__team_name span');
    const serverName = serverNameElement?.textContent?.trim() || 'Unknown Server';
    const message = {
      action: 'userMessaged',
      userName,
      serverName,
      workspaceUrl: window.location.origin
    };
    logger.log('Sending userMessaged notification:', message);
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          logger.error('Error sending userMessaged message:', chrome.runtime.lastError);
        } else {
          logger.log('userMessaged message sent successfully, response:', response);
        }
      });
    } catch (error) {
      logger.error('Exception sending userMessaged message:', error);
    }
  }

  private async ensureSortIsAtoZ() {
    try {
      const sortButton = document.getElementById('sort-explorer-select') as HTMLElement;
      if (!sortButton) {
        logger.warn('Sort button not found');
        return;
      }

      // Get the first span child which contains the sort status
      const sortStatusSpan = sortButton.querySelector('span') as HTMLElement;
      const currentSort = sortStatusSpan?.textContent?.trim() || '';

      logger.log(`Current sort status: "${currentSort}"`);

      // Check if it's already "A to Z"
      if (currentSort === 'A to Z') {
        logger.log('Sort is already set to "A to Z", no need to change');
        return;
      }

      logger.log('Sort is not "A to Z", updating to "A to Z"...');

      // Click the sort button to open the dropdown
      sortButton.click();
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait for dropdown to appear

      // Click the "A to Z" option (option_1)
      const sortOption = document.getElementById('sort-explorer-select_option_1') as HTMLElement;
      if (sortOption) {
        logger.log('Clicking "A to Z" sort option');
        sortOption.click();
        logger.log('Waiting for user list to re-sort...');
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for list to re-sort and render
        logger.log('Sort updated to "A to Z", user list is ready');
      } else {
        logger.warn('"A to Z" sort option not found');
      }
    } catch (error) {
      logger.error('Error ensuring sort is A to Z:', error);
    }
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
