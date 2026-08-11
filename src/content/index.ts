// Content script for Slack scraping

// Custom logger with timestamps for easy filtering and debugging
const logger = {
  getTimestamp: (): string => {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `[${hours}:${minutes}:${seconds}.${ms}]`;
  },
  log: (...args: any[]): void => console.log(`EXT:DEBUG ${logger.getTimestamp()}`, ...args),
  warn: (...args: any[]): void => console.warn(`EXT:DEBUG ${logger.getTimestamp()}`, ...args),
  error: (...args: any[]): void => console.error(`EXT:DEBUG ${logger.getTimestamp()}`, ...args),
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

type MessagingPhase = 'idle' | 'running' | 'paused' | 'waiting' | 'completed' | 'error';

interface MessagingStatus {
  phase: MessagingPhase;
  status: string;
  pageNumber?: number;
  userIndex?: number;
  totalUsers?: number;
  userName?: string;
  reason?: string;
  updatedAt: number;
}

const regex = /^[a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF!@#\$%\^&\*\(\)_\+\-=\[\]\{\};:'",\.<>\/\?\\|`~ ]*$/;

class SlackScraper {
  private isActive: boolean = false;
  private messages: SlackMessage[] = [];
  private channels: SlackChannel[] = [];
  private users: SlackUser[] = [];
  private blacklist: string[] = [];
  private isPaused: boolean = false;
  private isMessaging: boolean = false;
  private messagingRunId: number = 0;
  private processedUsers: Set<string> = new Set();
  private sendToExistingDm: boolean = false;
  private keepTabFocused: boolean = false;

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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async waitUntilOnline(status = 'Internet connection lost. Waiting to reconnect...', pageNumber?: number, userIndex?: number, totalUsers?: number): Promise<void> {
    if (navigator.onLine) {
      return;
    }

    this.sendClickStatus(status, {
      phase: 'waiting',
      pageNumber,
      userIndex,
      totalUsers,
      reason: 'network',
    });
    logger.warn(status);

    await new Promise<void>((resolve) => {
      const handleOnline = () => {
        window.removeEventListener('online', handleOnline);
        resolve();
      };
      window.addEventListener('online', handleOnline);
    });

    this.sendClickStatus('Internet connection restored. Waiting for Slack to recover...', {
      phase: 'waiting',
      pageNumber,
      userIndex,
      totalUsers,
      reason: 'slack-recovery',
    });
    await this.sleep(3000);
  }

  private async ensureAutomationReady(reason: string): Promise<void> {
    await this.waitUntilOnline();

    // Only pull the Slack tab/window to the foreground when the user opted in.
    if (!this.keepTabFocused) {
      return;
    }

    if (document.hidden || !document.hasFocus()) {
      logger.log(`Requesting tab wake before ${reason}`);
      await chrome.runtime.sendMessage({ action: 'ensureTabAwake', reason }).catch((error) => {
        logger.warn('Unable to wake Slack tab:', error);
      });
      await this.sleep(750);
    }
  }

  private async waitForElementResilient(selector: string, timeout = 30000): Promise<HTMLElement | null> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await this.waitUntilOnline();
      const element = await this.waitForElement(selector, timeout);
      if (element) {
        return element;
      }

      logger.warn(`Element not found on attempt ${attempt}: ${selector}`);
      this.sendClickStatus(`Waiting for Slack to reload required UI... (${attempt}/3)`, {
        phase: 'waiting',
        reason: 'slack-ui',
      });
      await this.waitUntilOnline();
      await this.sleep(2000 * attempt);
    }

    return null;
  }

  private async clickElement(element: HTMLElement, reason: string): Promise<void> {
    await this.ensureAutomationReady(reason);
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    await this.sleep(250);
    element.click();
  }

  private getUserCellLabel(userCell: HTMLElement, fallback: string): string {
    const text = userCell.textContent?.replace(/\s+/g, ' ').trim();
    return text || fallback;
  }

  private getMemberKey(memberName: string): string {
    return memberName.trim().toLowerCase();
  }

  private async returnToUserList(): Promise<boolean> {
    await this.ensureAutomationReady('returning to user list');
    history.back();
    const userList = await this.waitForElementResilient(".p-explorer_grid__cell", 45000);
    return Boolean(userList);
  }

  private getStatusPrefix(pageNumber?: number, userIndex?: number, totalUsers?: number): string {
    const pageText = pageNumber ? `Page ${pageNumber}` : '';
    const userText = userIndex && totalUsers ? `User ${userIndex} of ${totalUsers}` : '';
    return [pageText, userText].filter(Boolean).join(' - ');
  }

  private async insertMessage(qlEditor: HTMLElement, text: string): Promise<boolean> {
    await this.ensureAutomationReady('typing message');
    qlEditor.focus();
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, text);
    await this.sleep(500);

    if (qlEditor.textContent?.includes(text)) {
      return true;
    }

    qlEditor.textContent = text;
    qlEditor.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text,
    }));
    qlEditor.dispatchEvent(new Event('change', { bubbles: true }));
    await this.sleep(500);

    return Boolean(qlEditor.textContent?.includes(text));
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

  // Check if there are existing messages in the current DM conversation
  private async checkForExistingMessages(): Promise<boolean> {
    // Wait a bit for messages to load
    await new Promise(resolve => setTimeout(resolve, 1500));

    const messageCount = document.getElementById("message-list")?.getElementsByClassName("c-virtual_list__scroll_container")?.[0]?.children?.length || 2
    if (messageCount > 2) {
      logger.log(`Existing messages found in conversation (message count: ${messageCount})`);
      return true;
    } else {
      logger.log('No existing messages found in conversation');
      return false;
    }
  }

  constructor() {
    this.setupMessageListener();
    this.loadState();
    this.loadBlacklist();
    this.loadPauseState();
    this.loadSendToExistingDm();
    this.loadKeepTabFocused();
    // Listen for blacklist updates from storage
    chrome.storage.onChanged.addListener((changes) => {
      try {
        if (typeof changes.sendToExistingDm?.newValue === 'boolean') {
          this.sendToExistingDm = changes.sendToExistingDm.newValue;
          logger.log(`Send to existing DMs setting updated: ${this.sendToExistingDm}`);
        }

        if (typeof changes.keepTabFocused?.newValue === 'boolean') {
          this.keepTabFocused = changes.keepTabFocused.newValue;
          logger.log(`Keep tab focused setting updated: ${this.keepTabFocused}`);
        }

        // New format: blacklistText
        if (changes.blacklistText) {
          const blacklistText = changes.blacklistText.newValue || '';
          this.blacklist = blacklistText
            .split(',')
            .map((name: string) => name.trim().toLowerCase())
            .filter((name: string) => name.length > 0);
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
          .map((name: string) => name.trim().toLowerCase())
          .filter((name: string) => name.length > 0);
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

  private async loadPauseState() {
    try {
      const result = await chrome.storage.local.get(['isPaused']);
      if (typeof result.isPaused === 'boolean') {
        this.isPaused = result.isPaused;
        logger.log(`Loaded pause state: ${this.isPaused}`);
      }
    } catch (error) {
      logger.error('Error loading pause state:', error);
      this.isPaused = false;
    }
  }

  private async loadSendToExistingDm() {
    try {
      const result = await chrome.storage.local.get(['sendToExistingDm']);
      if (typeof result.sendToExistingDm === 'boolean') {
        this.sendToExistingDm = result.sendToExistingDm;
      }
      logger.log(`Loaded send to existing DMs setting: ${this.sendToExistingDm}`);
    } catch (error) {
      logger.error('Error loading send to existing DMs setting:', error);
      this.sendToExistingDm = false;
    }
  }

  private async loadKeepTabFocused() {
    try {
      const result = await chrome.storage.local.get(['keepTabFocused']);
      if (typeof result.keepTabFocused === 'boolean') {
        this.keepTabFocused = result.keepTabFocused;
      }
      logger.log(`Loaded keep tab focused setting: ${this.keepTabFocused}`);
    } catch (error) {
      logger.error('Error loading keep tab focused setting:', error);
      this.keepTabFocused = false;
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
      } else if (message.action === 'keepalive') {
        sendResponse({ success: true });
      } else if (message.action === 'nudgeMessaging') {
        // Nudge from background script to continue messaging despite throttling
        logger.log('Received nudge to continue messaging');
        sendResponse({ success: true });
      } else if (message.action === 'togglePause') {
        this.isPaused = message.isPaused;
        logger.log(`Messaging ${this.isPaused ? 'paused' : 'resumed'}`);
        this.sendClickStatus(this.isPaused ? 'Paused by user.' : 'Resumed by user.', {
          phase: this.isPaused ? 'paused' : 'running',
          reason: this.isPaused ? 'manual' : undefined,
        });
        sendResponse({ success: true });
      }
    });

    // Listen for visibility changes to handle tab going inactive/active
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        logger.log('Tab is now hidden/inactive');
        if (this.isMessaging) {
          this.sendClickStatus('Slack tab is hidden. Continuing with background recovery enabled...', {
            phase: 'waiting',
            reason: 'hidden-tab',
          });
        }
      } else {
        logger.log('Tab is now visible/active');
      }
    });
  }

  private async messageAllUsersInPage(messageContent: string, pageNumber = 1) {
    const runId = ++this.messagingRunId;
    this.isMessaging = true;

    try {
      // Mark this tab as actively messaging so background script can keep it awake
      const tabId = await this.getTabId();
      if (tabId) {
        chrome.storage.local.set({ activeMessagingTab: tabId });
        logger.log(`Tab ${tabId} marked as actively messaging`);
      }

      this.sendClickStatus(`Starting to message all users on page ${pageNumber}...`, {
        phase: 'running',
        pageNumber,
      });
      await this.ensureAutomationReady('starting messaging');

      const firstUserCell = await this.waitForElementResilient(".p-explorer_grid__cell", 45000);
      if (!firstUserCell) {
        this.sendClickStatus(`No users found on page ${pageNumber}.`, {
          phase: 'error',
          pageNumber,
        });
        logger.warn('No users found on this page.');
        return;
      }

      const userCells = document.getElementsByClassName("p-explorer_grid__cell");
      if (userCells.length === 0) {
        this.sendClickStatus(`No users found on page ${pageNumber}.`, {
          phase: 'error',
          pageNumber,
        });
        logger.warn('No users found on this page.');
        return;
      }
      logger.log(`Start scrapping for ${userCells.length} users`);

      const usersOnPage = userCells.length;
      for (let i = 0; i < usersOnPage; i += 1) {
        if (runId !== this.messagingRunId) {
          logger.warn('A newer messaging run started; stopping older run.');
          return;
        }

        // Check if paused - wait until resumed
        while (this.isPaused) {
          this.sendClickStatus(`${this.getStatusPrefix(pageNumber, i + 1, usersOnPage)} - Paused by user.`, {
            phase: 'paused',
            pageNumber,
            userIndex: i + 1,
            totalUsers: usersOnPage,
            reason: 'manual',
          });
          await this.sleep(1000); // Check pause state every second
        }

        await this.waitUntilOnline(undefined, pageNumber, i + 1, usersOnPage);
        await this.waitForElementResilient(".p-explorer_grid__cell", 45000);

        const currentUserCells = document.getElementsByClassName("p-explorer_grid__cell");
        const userCell = currentUserCells[i] as HTMLElement | undefined;
        if (!userCell) {
          logger.warn(`User cell ${i + 1} no longer exists after Slack list refresh.`);
          this.sendClickStatus(`${this.getStatusPrefix(pageNumber, i + 1, usersOnPage)} - Skipped, user list changed.`, {
            phase: 'running',
            pageNumber,
            userIndex: i + 1,
            totalUsers: usersOnPage,
          });
          continue;
        }

        const userCellLabel = this.getUserCellLabel(userCell, `user-${i + 1}`);
        if (this.processedUsers.has(this.getMemberKey(userCellLabel))) {
          logger.log(`Skipping already processed visible user cell: ${userCellLabel}`);
          continue;
        }

        this.sendClickStatus(`${this.getStatusPrefix(pageNumber, i + 1, usersOnPage)} - Opening user...`, {
          phase: 'running',
          pageNumber,
          userIndex: i + 1,
          totalUsers: usersOnPage,
          userName: userCellLabel,
        });
        logger.log(`Clicking user ${i + 1}:`, userCell);

        // Click the user cell to open the profile sidebar
        await this.clickElement(userCell, `opening user ${i + 1}`);

        // Find and click the "Message" button
        const messageButton = await this.waitForElement(".p-member_profile_buttons__button--message", 10000);
        if (messageButton) {
          logger.log('Clicking Message button:', messageButton);
          await this.clickElement(messageButton, `opening DM for user ${i + 1}`);

          // Wait for DM page to load and message input to appear
          const messageInputDiv = await this.waitForElementResilient('[data-qa="message_input"]', 45000);
          if (!messageInputDiv) {
            logger.warn('Message input container not found on DM page.');
            this.sendClickStatus(`${this.getStatusPrefix(pageNumber, i + 1, usersOnPage)} - Error: message input not found.`, {
              phase: 'error',
              pageNumber,
              userIndex: i + 1,
              totalUsers: usersOnPage,
            });
            await this.returnToUserList();
            continue;
          }

          logger.log('Found message_input container, looking for ql-editor...');
          const qlEditor = messageInputDiv.querySelector(".ql-editor") as HTMLElement;

          if (!qlEditor) {
            logger.warn('ql-editor not found inside message_input container.');
            this.sendClickStatus(`${this.getStatusPrefix(pageNumber, i + 1, usersOnPage)} - Error: editor not found.`, {
              phase: 'error',
              pageNumber,
              userIndex: i + 1,
              totalUsers: usersOnPage,
            });
            await this.returnToUserList();
            continue;
          }

          try {
            // check name - safely get member name with null checking
            const memberNameElement = document.querySelector('[data-qa="member_name"]') as HTMLElement | null;
            if (!memberNameElement) {
              logger.warn('Member name element not found on DM page');
              this.sendClickStatus(`${this.getStatusPrefix(pageNumber, i + 1, usersOnPage)} - Error: member name not found.`, {
                phase: 'error',
                pageNumber,
                userIndex: i + 1,
                totalUsers: usersOnPage,
              });
              await this.returnToUserList();
              continue;
            }

            const memberName = memberNameElement.textContent?.trim();
            if (!memberName) {
              logger.warn('Member name is empty or null');
              this.sendClickStatus(`${this.getStatusPrefix(pageNumber, i + 1, usersOnPage)} - Error: member name is empty.`, {
                phase: 'error',
                pageNumber,
                userIndex: i + 1,
                totalUsers: usersOnPage,
              });
              await this.returnToUserList();
              continue;
            }

            logger.log(`===== USER NAME: "${memberName}" =====`);

            logger.log(`BLACKLIST USERS:`, this.blacklist);
            const isBlacklisted = this.blacklist.includes(memberName.toLowerCase());
            if (isBlacklisted) {
              logger.log(`User "${memberName}" is blacklisted, skipping...`);
              this.sendClickStatus(`${this.getStatusPrefix(pageNumber, i + 1, usersOnPage)} - Skipped ${memberName}, blacklisted.`, {
                phase: 'running',
                pageNumber,
                userIndex: i + 1,
                totalUsers: usersOnPage,
                userName: memberName,
              });
              this.processedUsers.add(this.getMemberKey(memberName));
              await this.returnToUserList(); // Wait for user list to reappear
              continue;
            }

            if (regex.test(memberName)) {
              console.log('Found ql-editor, pasting message...');
              logger.log('Found ql-editor, pasting message...');
              const hasExistingMessages = this.sendToExistingDm ? false : await this.checkForExistingMessages();

              if (hasExistingMessages) {
                console.log('Skipping user - existing conversation found with:', memberName);
                this.sendClickStatus(`${this.getStatusPrefix(pageNumber, i + 1, usersOnPage)} - Skipped ${memberName}, already has messages.`, {
                  phase: 'running',
                  pageNumber,
                  userIndex: i + 1,
                  totalUsers: usersOnPage,
                  userName: memberName,
                });
                this.processedUsers.add(this.getMemberKey(memberName));
                await this.returnToUserList(); // Wait for user list to reappear
                continue;
              } else {
                console.log(`${this.sendToExistingDm ? 'Existing DM check disabled' : 'No existing messages'}, sending message to:`, memberName);
                logger.log(`${this.sendToExistingDm ? 'Existing DM check disabled' : 'No existing messages'}, sending message to:`, memberName);
                const inserted = await this.insertMessage(qlEditor, `Hello ${memberName}, ${messageContent}`);
                if (!inserted) {
                  logger.warn('Unable to insert message text.');
                  this.sendClickStatus(`${this.getStatusPrefix(pageNumber, i + 1, usersOnPage)} - Error: could not type message for ${memberName}.`, {
                    phase: 'error',
                    pageNumber,
                    userIndex: i + 1,
                    totalUsers: usersOnPage,
                    userName: memberName,
                  });
                  await this.returnToUserList();
                  continue;
                }

                this.sendClickStatus(`${this.getStatusPrefix(pageNumber, i + 1, usersOnPage)} - Sending message to ${memberName}...`, {
                  phase: 'running',
                  pageNumber,
                  userIndex: i + 1,
                  totalUsers: usersOnPage,
                  userName: memberName,
                });
                await this.sleep(1000);
                const sendButton = await this.waitForElementResilient(".c-wysiwyg_container__button--send", 45000);
                if (sendButton) {
                  logger.log('Clicking send button:', sendButton);
                  await this.clickElement(sendButton, `sending message to ${memberName}`);
                  this.processedUsers.add(this.getMemberKey(memberName));
                  chrome.runtime.sendMessage({
                    action: 'userMessaged',
                    userName: memberName,
                    workspaceUrl: window.location.origin,
                  });
                  this.sendClickStatus(`${this.getStatusPrefix(pageNumber, i + 1, usersOnPage)} - Sent message to ${memberName}.`, {
                    phase: 'running',
                    pageNumber,
                    userIndex: i + 1,
                    totalUsers: usersOnPage,
                    userName: memberName,
                  });
                  await this.sleep(1000); // Still need a short wait on DM page
                  logger.log('Navigating back...');
                  await this.returnToUserList(); // Wait for user list to reappear
                  continue;
                } else {
                  logger.warn('send button not found on DM page.');
                  this.sendClickStatus(`${this.getStatusPrefix(pageNumber, i + 1, usersOnPage)} - Error: send button not found.`, {
                    phase: 'error',
                    pageNumber,
                    userIndex: i + 1,
                    totalUsers: usersOnPage,
                    userName: memberName,
                  });
                  await this.returnToUserList();
                  continue;
                }
              }
            } else {
              logger.log(`User name is not valid, skipping...`);
              this.sendClickStatus(`${this.getStatusPrefix(pageNumber, i + 1, usersOnPage)} - Skipped ${memberName}, invalid name.`, {
                phase: 'running',
                pageNumber,
                userIndex: i + 1,
                totalUsers: usersOnPage,
                userName: memberName,
              });
              this.processedUsers.add(this.getMemberKey(memberName));
              await this.returnToUserList(); // Wait for user list to reappear
              continue;
            }
          } catch (error) {
            logger.error('Error processing user message:', error);
            this.sendClickStatus(`${this.getStatusPrefix(pageNumber, i + 1, usersOnPage)} - Error: ${(error as Error).message}`, {
              phase: 'error',
              pageNumber,
              userIndex: i + 1,
              totalUsers: usersOnPage,
            });
            await this.returnToUserList();
            continue;
          }
        } else {
          logger.warn('"Message" button not found for user.');
          this.sendClickStatus(`${this.getStatusPrefix(pageNumber, i + 1, usersOnPage)} - Skipped ${userCellLabel}, message button not found.`, {
            phase: 'running',
            pageNumber,
            userIndex: i + 1,
            totalUsers: usersOnPage,
            userName: userCellLabel,
          });
          this.processedUsers.add(this.getMemberKey(userCellLabel));
          await this.returnToUserList();
          continue;
        }
      }

      this.sendClickStatus(`Finished messaging all users on page ${pageNumber}.`, {
        phase: 'running',
        pageNumber,
      });
      logger.log('Finished messaging all users on this page.');

      // Check for next page button and paginate - wait until it's enabled
      logger.log('Waiting for next page button to be enabled...');
      let nextPageButton = await this.waitForElementEnabled('[data-qa="c-pagination_forward_btn"]', 10000); // Wait up to 10 seconds for button to be enabled

      if (nextPageButton) {
        this.sendClickStatus(`Navigating from page ${pageNumber} to page ${pageNumber + 1}...`, {
          phase: 'running',
          pageNumber,
        });
        logger.log('Clicking next page button:', nextPageButton);
        await this.clickElement(nextPageButton, 'navigating to next user page');
        await this.waitForElementResilient(".p-explorer_grid__cell", 45000); // Wait for new page's user list to load
        // Continue messaging on next page
        await this.messageAllUsersInPage(messageContent, pageNumber + 1);
      } else {
        this.sendClickStatus('No more pages or next button not enabled. Messaging completed!', {
          phase: 'completed',
          pageNumber,
        });
        logger.log('No more pages or next button not enabled. Messaging completed!');
        // Clear active messaging flag when done
        chrome.storage.local.remove(['activeMessagingTab']);
      }

    } catch (error) {
      logger.error('Error messaging all users:', error);
      this.sendClickStatus(`Error during messaging: ${(error as Error).message}`, {
        phase: 'error',
        pageNumber,
      });
      // Clear active messaging flag on error
      chrome.storage.local.remove(['activeMessagingTab']);
    } finally {
      if (runId === this.messagingRunId) {
        this.isMessaging = false;
      }
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

  private sendClickStatus(status: string, details: Partial<Omit<MessagingStatus, 'status' | 'updatedAt'>> = {}) {
    const messagingStatus: MessagingStatus = {
      phase: details.phase || 'running',
      ...details,
      status,
      updatedAt: Date.now(),
    };

    chrome.storage.local.set({ messagingStatus });
    chrome.runtime.sendMessage({ action: 'updateClickStatus', status, messagingStatus });
  }

  // Helper method to get current tab ID
  private async getTabId(): Promise<number | undefined> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getTabId' }, (response) => {
        resolve(response?.tabId);
      });
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
