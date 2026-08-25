// Toolbar popup: shows what the extension detected on the current tab, live room
// stats from the backend, a manual CA entry, and the recently detected addresses.

import {
  API_URL,
  WEB_APP_URL,
  DetectedToken,
  connectWalletUrl,
  isValidCA,
  normalizeCA,
  roomUrl,
  shortenCA,
  siteLabel,
  timeAgo,
} from './config';

const HISTORY_KEY = 'detectedHistory';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const backendDot = el<HTMLSpanElement>('backend-dot');
const backendStatus = el<HTMLSpanElement>('backend-status');
const detectedCA = el<HTMLParagraphElement>('detected-ca');
const detectedSite = el<HTMLSpanElement>('detected-site');
const detectedMeta = el<HTMLParagraphElement>('detected-meta');
const detectedActions = el<HTMLDivElement>('detected-actions');
const openDetectedBtn = el<HTMLButtonElement>('open-detected');
const showWidgetBtn = el<HTMLButtonElement>('show-widget');
const copyDetectedBtn = el<HTMLButtonElement>('copy-detected');
const caInput = el<HTMLInputElement>('ca-input');
const caHint = el<HTMLParagraphElement>('ca-hint');
const openCaBtn = el<HTMLButtonElement>('open-ca');
const connectWalletBtn = el<HTMLButtonElement>('connect-wallet');
const historyList = el<HTMLDivElement>('history-list');
const clearHistoryBtn = el<HTMLButtonElement>('clear-history');
const openWebBtn = el<HTMLButtonElement>('open-web');
const openRoomsBtn = el<HTMLButtonElement>('open-rooms');

let currentTabId: number | null = null;
let currentDetection: DetectedToken | null = null;

function openTab(url: string): void {
  chrome.tabs.create({ url });
  window.close();
}

function setHint(message: string, isError = false): void {
  caHint.textContent = message;
  caHint.className = isError ? 'hint error' : 'hint';
}

async function api<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    return null;
  }
}

// ---------- current tab detection ----------

async function loadDetection(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id ?? null;

  // Without the `tabs` permission, tab.url is only exposed for hosts this
  // extension has permission for — which is exactly the set we can detect on.
  const hostname = tab?.url ? safeHostname(tab.url) : '';
  detectedSite.textContent = hostname ? siteLabel(hostname) : '';

  if (currentTabId == null) {
    renderNoDetection('No active tab.');
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: 'token-chat:get-detection',
    tabId: currentTabId,
  });
  currentDetection = response?.detected || null;

  if (!currentDetection) {
    renderNoDetection(
      hostname
        ? `No token detected on ${siteLabel(hostname)}. Paste a contract address below to open its room.`
        : 'Open a token page on GMGN, Axiom, or Padre — or paste a contract address below.'
    );
    return;
  }

  detectedCA.textContent = currentDetection.ca;
  detectedMeta.textContent = `Detected ${timeAgo(currentDetection.detectedAt)}${
    currentDetection.title ? ` · ${truncate(currentDetection.title, 46)}` : ''
  }`;
  detectedActions.hidden = false;

  const summary = await api<{ messageCount: number; participantCount: number; lastMessageAt: string | null }>(
    `/api/rooms/${encodeURIComponent(currentDetection.ca)}/summary`
  );
  if (summary) {
    detectedMeta.textContent = `${summary.participantCount} participant${
      summary.participantCount === 1 ? '' : 's'
    } · ${summary.messageCount} message${summary.messageCount === 1 ? '' : 's'} · last activity ${timeAgo(
      summary.lastMessageAt
    )}`;
  }
}

function renderNoDetection(message: string): void {
  detectedCA.textContent = 'No token detected';
  detectedMeta.textContent = message;
  detectedActions.hidden = true;
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch (err) {
    return '';
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// ---------- backend stats ----------

async function loadStats(): Promise<void> {
  const stats = await api<{
    rooms: number;
    messages: number;
    activeRooms24h: number;
    activeUsers24h: number;
    identities: number;
  }>('/api/rooms/stats');

  if (!stats) {
    backendDot.className = 'dot offline';
    backendStatus.textContent = 'offline';
    return;
  }

  backendDot.className = 'dot online';
  backendStatus.textContent = `${stats.rooms} room${stats.rooms === 1 ? '' : 's'}`;
  el('stat-rooms').textContent = format(stats.rooms);
  el('stat-active').textContent = format(stats.activeRooms24h);
  el('stat-users').textContent = format(stats.activeUsers24h || stats.identities);
  el('stat-messages').textContent = format(stats.messages);
}

function format(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

// ---------- detected history ----------

async function loadHistory(): Promise<void> {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const history: DetectedToken[] = stored[HISTORY_KEY] || [];
  historyList.replaceChildren();

  if (history.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Nothing yet. Visit a token page on a supported site and detected addresses land here.';
    historyList.appendChild(empty);
    return;
  }

  for (const entry of history) {
    const button = document.createElement('button');
    button.className = 'item';
    button.title = entry.ca;

    const left = document.createElement('span');
    left.className = 'item-ca';
    left.textContent = shortenCA(entry.ca, 8, 6);

    const right = document.createElement('span');
    right.className = 'item-meta';
    right.textContent = `${entry.site || 'manual'} · ${timeAgo(entry.detectedAt)}`;

    button.append(left, right);
    button.addEventListener('click', () => openTab(roomUrl(entry.ca)));
    historyList.appendChild(button);
  }
}

// ---------- actions ----------

openDetectedBtn.addEventListener('click', () => {
  if (currentDetection) openTab(roomUrl(currentDetection.ca));
});

showWidgetBtn.addEventListener('click', async () => {
  if (currentTabId == null || !currentDetection) return;
  try {
    await chrome.tabs.sendMessage(currentTabId, { type: 'token-chat:open-widget', ca: currentDetection.ca });
    window.close();
  } catch (err) {
    detectedMeta.textContent = 'Could not reach this page — reload it and try again.';
  }
});

copyDetectedBtn.addEventListener('click', async () => {
  if (!currentDetection) return;
  await navigator.clipboard.writeText(currentDetection.ca);
  copyDetectedBtn.textContent = 'Copied';
  setTimeout(() => {
    copyDetectedBtn.textContent = 'Copy';
  }, 1200);
});

function submitCA(): void {
  const value = caInput.value.trim();
  if (!value) {
    setHint('Enter a contract address first.', true);
    return;
  }
  if (!isValidCA(value)) {
    setHint('That does not look like an EVM or Solana address.', true);
    return;
  }
  openTab(roomUrl(normalizeCA(value)));
}

openCaBtn.addEventListener('click', submitCA);
caInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') submitCA();
});
caInput.addEventListener('input', () => setHint('Paste a CA to jump straight into its room.'));

connectWalletBtn.addEventListener('click', () => {
  openTab(connectWalletUrl(currentDetection?.ca));
});

clearHistoryBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove(HISTORY_KEY);
  await loadHistory();
});

openWebBtn.addEventListener('click', () => openTab(WEB_APP_URL));
openRoomsBtn.addEventListener('click', () => openTab(`${WEB_APP_URL}/rooms`));

loadDetection();
loadStats();
loadHistory();
