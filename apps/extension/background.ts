// Background service worker: keeps track of which token each tab is showing,
// maintains a short history of detected contract addresses, and badges the
// toolbar icon so the popup has something to show when it opens.

import type { DetectedToken } from './config';

const TAB_KEY = 'detectedByTab';
const HISTORY_KEY = 'detectedHistory';
const HISTORY_LIMIT = 15;

type TabMap = Record<string, DetectedToken>;

async function readTabMap(): Promise<TabMap> {
  const stored = await chrome.storage.local.get(TAB_KEY);
  return (stored[TAB_KEY] as TabMap) || {};
}

async function writeTabMap(map: TabMap): Promise<void> {
  await chrome.storage.local.set({ [TAB_KEY]: map });
}

async function recordDetection(tabId: number, detected: DetectedToken): Promise<void> {
  const map = await readTabMap();
  map[String(tabId)] = detected;
  await writeTabMap(map);

  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const history: DetectedToken[] = (stored[HISTORY_KEY] as DetectedToken[]) || [];
  const deduped = [detected, ...history.filter((entry) => entry.ca !== detected.ca)].slice(0, HISTORY_LIMIT);
  await chrome.storage.local.set({ [HISTORY_KEY]: deduped });

  await setBadge(tabId, true);
}

async function clearDetection(tabId: number): Promise<void> {
  const map = await readTabMap();
  if (map[String(tabId)]) {
    delete map[String(tabId)];
    await writeTabMap(map);
  }
  await setBadge(tabId, false);
}

async function setBadge(tabId: number, detected: boolean): Promise<void> {
  try {
    await chrome.action.setBadgeText({ tabId, text: detected ? '●' : '' });
    if (detected) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#22c55e' });
      await chrome.action.setTitle({ tabId, title: 'Token Chat — token detected on this page' });
    } else {
      await chrome.action.setTitle({ tabId, title: 'Token Chat' });
    }
  } catch (err) {
    // Tab may have gone away between detection and badge update.
  }
}

chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: (response?: any) => void) => {
  const tabId = sender?.tab?.id;

  if (message?.type === 'token-chat:detected' && typeof tabId === 'number') {
    recordDetection(tabId, {
      ca: message.ca,
      url: message.url || sender.tab.url || '',
      title: message.title || sender.tab.title || '',
      site: message.site || '',
      detectedAt: Date.now(),
    })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === 'token-chat:none' && typeof tabId === 'number') {
    clearDetection(tabId)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === 'token-chat:get-detection') {
    const targetTabId = message.tabId;
    readTabMap()
      .then((map) => sendResponse({ detected: map[String(targetTabId)] || null }))
      .catch(() => sendResponse({ detected: null }));
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId: number) => {
  clearDetection(tabId).catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: any) => {
  // A navigation invalidates the previous detection; the content script reports
  // again on the new page if it finds a token.
  //
  // Without the broad `tabs` permission, changeInfo.url is only present for
  // hosts we hold permission for, so `status === 'loading'` alone is the
  // trigger. Clearing once too often is harmless; missing a clear would leave a
  // stale room showing for the wrong page.
  if (changeInfo.status === 'loading') {
    clearDetection(tabId).catch(() => undefined);
  }
});

