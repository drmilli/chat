import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ethers } from 'ethers';
import { ChatComposer } from './ChatComposer';
import { ChatHistory, ChatMessage } from './ChatHistory';
import { avatarGradient, initials, shortId } from './identity';
import { MAX_NAME_LENGTH, useProfile } from './useProfile';
import { apiUrl, fetchJson } from './api';
import { readHostContext, postToHost, onHostMessage } from './embedBridge';
import { adoptSession } from './session';
import { VoiceLounge } from './VoiceLounge';
import { useVoiceLounge, type VoiceEvent } from './useVoiceLounge';
import { addressChain, chainName } from './tokens';

const erc20Abi = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
];

type TokenDetails = {
  name: string;
  symbol: string;
  balance?: string;
};

type RoomSummary = {
  id: string;
  messageCount: number;
  participantCount: number;
  lastMessageAt: string | null;
};

type ChatPageProps = {
  contractAddress: string;
  embedMode?: boolean;
  walletAccount?: string;
  walletChainId?: string;
  walletConnected: boolean;
  connectWallet: () => Promise<void>;
};

const COLLAPSED_HEIGHT = 56;
const EXPANDED_HEIGHT = 560;

function byOldestFirst(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

/**
 * Insert a message, replacing any existing entry with the same id.
 *
 * Both the POST response and the SSE echo carry the same row, and either can
 * arrive first — the server publishes to the hub as soon as it inserts, so on a
 * slow round-trip the echo beats the response. Appending blindly rendered the
 * sender's own message twice.
 */
function upsertMessage(current: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const index = current.findIndex((message) => message.id === incoming.id);
  if (index === -1) return byOldestFirst([...current, incoming]);
  const next = [...current];
  next[index] = { ...next[index], ...incoming };
  return next;
}

export function ChatPage({
  contractAddress,
  embedMode,
  walletAccount,
  walletChainId,
  walletConnected,
  connectWallet,
}: ChatPageProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [hiddenMessageIds, setHiddenMessageIds] = useState<Set<number>>(new Set());
  const [reportedMessageIds, setReportedMessageIds] = useState<Set<number>>(new Set());
  const [replyTo, setReplyTo] = useState<
    { id: number; identity: string; preview?: string | null; kind?: 'text' | 'voice' | null } | null
  >(null);
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  const [tokenDetails, setTokenDetails] = useState<TokenDetails | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [roomFilter, setRoomFilter] = useState('');
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  // The peer id is issued by the server on each SSE `ready`. It is the address
  // WebRTC signalling is routed to, and it CHANGES on every reconnect — the
  // voice hook watches it so a dropped stream does not leave a half-dead call.
  const [peerId, setPeerId] = useState<string | null>(null);
  // Voice frames are fanned out from the one EventSource rather than opening a
  // second stream: a second connection would double the server's client count
  // and still be no more live than this one.
  const voiceListeners = useRef(new Set<(event: VoiceEvent) => void>());
  // Bumped when the extension hands us a session, so the profile hook re-runs
  // and picks up the now-signed-in identity.
  const [sessionEpoch, setSessionEpoch] = useState(0);

  const profile = useProfile(walletAccount, sessionEpoch);
  const identity = profile.identityId;
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const participants = useMemo(
    () => new Set(messages.map((message) => message.identity_id)).size,
    [messages]
  );

  const loadMessages = useCallback(
    async ({ initial }: { initial: boolean }) => {
      if (initial) setLoading(true);
      try {
        const data = await fetchJson<{ messages: ChatMessage[] }>(`/api/rooms/${contractAddress}/messages?limit=50`);
        setMessages(byOldestFirst(data.messages || []));
        setLoadError(null);
      } catch (err: any) {
        // Failing silently here renders an empty room, which is
        // indistinguishable from a working room nobody has posted in yet.
        if (initial) setMessages([]);
        setLoadError(err?.message || 'Could not reach the chat API.');
      } finally {
        if (initial) {
          setHiddenMessageIds(new Set());
          setReportedMessageIds(new Set());
          setLoading(false);
        }
      }
    },
    [contractAddress]
  );

  useEffect(() => {
    loadMessages({ initial: true });
  }, [loadMessages]);

  // Live updates over SSE.
  //
  // EventSource's built-in retry is not enough: when the API is briefly down, a
  // retry through a proxy answers with a non-`text/event-stream` error page,
  // which makes the browser give up PERMANENTLY — the page then sits there
  // looking connected while receiving nothing. So reconnection is driven here,
  // and a watchdog treats a stream that has gone quiet (no message, no server
  // ping) as dead even when no error ever fires.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let opens = 0;
    let lastEventAt = Date.now();
    let closed = false;

    const scheduleReconnect = () => {
      if (closed || retryTimer) return;
      setLive(false);
      // 2s, 4s, 8s… capped, so a long outage does not hammer the server.
      const delay = Math.min(2000 * 2 ** attempts, 30000);
      attempts += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    };

    function connect() {
      if (closed) return;
      source?.close();
      lastEventAt = Date.now();

      const next = new EventSource(apiUrl(`/api/rooms/${encodeURIComponent(contractAddress)}/stream`));
      source = next;

      next.addEventListener('ready', (event) => {
        lastEventAt = Date.now();
        attempts = 0;
        opens += 1;
        setLive(true);
        try {
          setPeerId(JSON.parse((event as MessageEvent).data)?.peerId ?? null);
        } catch {
          setPeerId(null);
        }
        // A dropped connection may have missed messages, so resync on every
        // reconnect (the first open is covered by the initial load).
        if (opens > 1) loadMessages({ initial: false });
      });

      next.addEventListener('ping', () => {
        lastEventAt = Date.now();
      });

      next.addEventListener('message.created', (event) => {
        lastEventAt = Date.now();
        try {
          const payload = JSON.parse((event as MessageEvent).data);
          const incoming = payload?.message as ChatMessage | undefined;
          if (incoming) setMessages((current) => upsertMessage(current, incoming));
        } catch (err) {
          /* ignore a malformed frame rather than tearing down the stream */
        }
      });

      for (const type of ['voice-peer-joined', 'voice-peer-left', 'voice-peer-updated', 'voice-signal'] as const) {
        next.addEventListener(type, (event) => {
          lastEventAt = Date.now();
          try {
            const data = JSON.parse((event as MessageEvent).data);
            for (const listener of voiceListeners.current) listener({ type, data } as VoiceEvent);
          } catch {
            /* ignore a malformed frame rather than tearing down the stream */
          }
        });
      }

      next.onerror = () => {
        next.close();
        scheduleReconnect();
      };
    }

    // The server pings every 25s, so ~2 missed pings means the stream is dead
    // even when no error was ever raised (a proxy can hold a socket open after
    // the upstream has gone).
    const watchdog = setInterval(() => {
      if (Date.now() - lastEventAt > 60000) {
        source?.close();
        attempts = 0;
        scheduleReconnect();
      }
    }, 15000);

    connect();

    return () => {
      closed = true;
      clearInterval(watchdog);
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
      setLive(false);
      setPeerId(null);
    };
  }, [contractAddress, loadMessages]);

  const subscribeToVoice = useCallback((handler: (event: VoiceEvent) => void) => {
    voiceListeners.current.add(handler);
    return () => {
      voiceListeners.current.delete(handler);
    };
  }, []);

  const voice = useVoiceLounge({
    roomId: contractAddress,
    peerId,
    // Verified wallets only — a mute or ban has to attach to something more
    // durable than a browser tab, and live audio cannot be scanned by the
    // blocklist that guards text.
    canJoin: Boolean(walletConnected && walletAccount),
    subscribe: subscribeToVoice,
  });

  // Sidebar room list — skipped in the embedded widget, which has no sidebar.
  useEffect(() => {
    if (embedMode) return;
    let cancelled = false;
    fetchJson<{ rooms: RoomSummary[] }>('/api/rooms?limit=25')
      .then((data) => {
        if (!cancelled) {
          setRooms(data.rooms || []);
          setRoomsError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setRoomsError(err?.message || 'rooms list unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [embedMode, contractAddress]);

  // The host origin is declared by the extension when it injects the iframe.
  const hostContext = useMemo(() => readHostContext(), []);

  // Ask the host page to resize the widget iframe when the embed expands.
  // Posted to that one origin only — never '*'.
  useEffect(() => {
    if (!embedMode) return;
    postToHost(hostContext, 'resize', { height: expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT });
  }, [embedMode, expanded, hostContext]);

  /**
   * Asks the extension for a session created when the user signed in on the
   * web app.
   *
   * Chrome partitions third-party storage, so the token written by the app as a
   * top-level tab is invisible to this same-origin widget embedded in a token
   * page. Without this hand-off, connecting a wallet through the extension
   * appeared to do nothing at all — the widget simply never saw it.
   */
  useEffect(() => {
    if (!embedMode || !hostContext.origin) return;

    const stop = onHostMessage(hostContext, (type, data) => {
      if (type !== 'session' || typeof data?.token !== 'string') return;
      // adoptSession refuses to overwrite a session we already have, so a
      // stale token cannot clobber a fresher sign-in made here.
      if (adoptSession(data.token)) setSessionEpoch((n) => n + 1);
    });

    postToHost(hostContext, 'session-request');
    return stop;
  }, [embedMode, hostContext]);

  const tokenChain = useMemo(() => addressChain(contractAddress), [contractAddress]);

  useEffect(() => {
    async function detectToken() {
      setTokenDetails(null);

      if (!contractAddress) {
        setTokenError(null);
        return;
      }

      // A Solana mint is not an ERC-20 and never will be. Attempting the call
      // throws on the address itself, which the old code reported as "unable to
      // detect token metadata" — blaming the token for being on the wrong chain
      // for our reader. Every real room so far is Solana, so this was the
      // normal case, not the edge case.
      if (tokenChain === 'solana') {
        setTokenError('Token details for Solana mints are not available yet.');
        return;
      }
      if (tokenChain !== 'evm') {
        setTokenError('This address is not in a recognised format.');
        return;
      }
      if (typeof window === 'undefined' || !window.ethereum) {
        setTokenError('Connect an EVM wallet to read this token\'s details.');
        return;
      }

      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const contract = new ethers.Contract(contractAddress, erc20Abi, provider);
        const [name, symbol, decimals] = await Promise.all([
          contract.name(),
          contract.symbol(),
          contract.decimals(),
        ]);

        let balance: string | undefined;
        if (walletConnected && walletAccount) {
          const rawBalance = await contract.balanceOf(walletAccount);
          balance = ethers.formatUnits(rawBalance, decimals);
        }

        setTokenDetails({ name, symbol, balance });
        setTokenError(null);
      } catch (err) {
        // The likeliest cause by far is the wallet sitting on a different chain
        // than the token, so say that instead of implying the token is broken.
        const on = chainName(walletChainId);
        setTokenError(
          on
            ? `No ERC-20 found at this address on ${on}. Switch your wallet to the token's network.`
            : 'Unable to read token details for this contract.'
        );
      }
    }
    detectToken();
  }, [walletConnected, walletAccount, contractAddress, tokenChain, walletChainId]);

  async function handleReport(messageId: number, identityId: string) {
    const response = await fetch(apiUrl('/api/reports'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityId, roomId: contractAddress, messageId, reason: 'user reported message' }),
    });
    if (response.ok) {
      setReportedMessageIds((current) => new Set(current).add(messageId));
    }
  }

  function handleMute(messageId: number) {
    setHiddenMessageIds((current) => new Set(current).add(messageId));
  }

  function handleSent(message: ChatMessage) {
    setMessages((current) => upsertMessage(current, message));
    setReplyTo(null);
    setSendError(null);
  }

  useEffect(() => {
    if (!renaming) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setRenaming(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [renaming]);

  // Clicking a quote scrolls its original into view and flashes it, so a reply
  // to something far up the history is still findable.
  function jumpToMessage(messageId?: number) {
    if (!messageId) return;
    const node = document.getElementById(`msg-${messageId}`);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedId(messageId);
    window.setTimeout(() => setHighlightedId((current) => (current === messageId ? null : current)), 1600);
  }

  const nameDialog = renaming ? (
    <div className="modal-backdrop" onClick={() => setRenaming(false)}>
      <form
        className="modal"
        style={{ maxWidth: 420 }}
        onClick={(event) => event.stopPropagation()}
        onSubmit={async (event) => {
          event.preventDefault();
          if (await profile.saveName(nameDraft)) setRenaming(false);
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <p className="eyebrow">Your identity</p>
            <h2 style={{ margin: '10px 0 0', fontSize: '1.5rem', letterSpacing: '-0.02em' }}>Choose a display name</h2>
          </div>
          <button type="button" className="icon-btn" onClick={() => setRenaming(false)} aria-label="Close">
            ×
          </button>
        </div>

        <label className="field">
          <span>Display name</span>
          <input
            className="input"
            autoFocus
            maxLength={MAX_NAME_LENGTH}
            value={nameDraft}
            onChange={(event) => {
              setNameDraft(event.target.value);
              profile.clearError();
            }}
            placeholder="e.g. degenlarry"
          />
        </label>

        {profile.error ? (
          <p style={{ margin: 0, color: 'var(--danger)', fontSize: '0.85rem' }}>{profile.error}</p>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
            Shown next to your messages. Your identity stays{' '}
            <span className="mono">{shortId(identity)}</span>, so this is a label, not a login.
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="submit" className="btn btn-primary" disabled={profile.saving || !profile.ready}>
            {profile.saving ? 'Saving…' : profile.ready ? 'Save name' : 'Connecting…'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setRenaming(false)}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  ) : null;

  const roomTitle = tokenDetails ? `${tokenDetails.name} (${tokenDetails.symbol})` : shortId(contractAddress, 8, 6);

  const errorBanner = loadError ? (
    <p
      style={{
        margin: 0,
        padding: '10px 14px',
        borderBottom: '1px solid rgba(251,113,133,0.3)',
        background: 'rgba(251,113,133,0.1)',
        color: 'var(--danger)',
        fontSize: '0.8rem',
      }}
    >
      Chat API unreachable ({loadError}). Messages cannot load or send — check that the backend is running.
    </p>
  ) : null;

  const history = (
    <ChatHistory
      messages={messages}
      loading={loading}
      currentIdentity={identity}
      hiddenMessageIds={hiddenMessageIds}
      reportedMessageIds={reportedMessageIds}
      onReport={handleReport}
      onMute={handleMute}
      onReply={(messageId, identityId) => {
        const target = messages.find((message) => message.id === messageId);
        setReplyTo({
          id: messageId,
          identity: identityId,
          preview: target?.kind === 'voice' ? null : target?.content ?? null,
          kind: target?.kind ?? 'text',
        });
      }}
      onJumpTo={jumpToMessage}
      highlightedId={highlightedId}
    />
  );

  const voiceLounge = (
    <VoiceLounge
      status={voice.status}
      participants={voice.participants}
      speaking={voice.speaking}
      muted={voice.muted}
      forcedMute={voice.forcedMute}
      error={voice.error}
      canModerate={voice.canModerate}
      audioBlocked={voice.audioBlocked}
      peerStates={voice.peerStates}
      diagnostics={voice.diagnostics}
      isFull={voice.isFull}
      canJoin={voice.canJoin}
      supported={voice.supported}
      turnConfigured={voice.turnConfigured}
      selfPeerId={voice.selfPeerId}
      onJoin={voice.join}
      onLeave={voice.leave}
      onToggleMute={voice.toggleMute}
      onConnectWallet={connectWallet}
      onModerate={voice.moderate}
      onEnableAudio={voice.enableAudio}
    />
  );

  const composer = (
    <ChatComposer
      contractAddress={contractAddress}
      defaultIdentity={identity}
      displayName={profile.displayName}
      onRename={() => {
        setNameDraft(profile.displayName || '');
        profile.clearError();
        setRenaming(true);
      }}
      replyTo={replyTo ?? undefined}
      onCancelReply={() => setReplyTo(null)}
      onSent={handleSent}
      onError={setSendError}
    />
  );

  // ---------- embedded widget ----------

  if (embedMode) {
    return (
      <div className={`tg-embed${expanded ? '' : ' collapsed'}`}>
        <div className="tg-embed-bar" onClick={() => setExpanded((value) => !value)} role="button" tabIndex={0}>
          <div className="avatar avatar-sm" style={{ background: avatarGradient(contractAddress) }}>
            {initials(contractAddress)}
          </div>
          <div className="tg-header-body">
            <p className="tg-header-title">{roomTitle}</p>
            <p className="tg-header-sub">
              <span className={`dot${live ? ' dot-live' : ''}`} />
              {messages.length} messages · {participants} online
            </p>
          </div>
          <span className="muted" style={{ fontSize: '0.9rem' }}>{expanded ? '▾' : '▴'}</span>
        </div>
        {nameDialog}
        {expanded ? (
          <>
            {errorBanner}
            {voiceLounge}
            {history}
            {sendError ? <p className="tg-identity" style={{ color: 'var(--danger)', padding: '0 12px' }}>{sendError}</p> : null}
            {composer}
          </>
        ) : null}
      </div>
    );
  }

  // ---------- full room ----------

  const filteredRooms = rooms.filter((room) => room.id.toLowerCase().includes(roomFilter.trim().toLowerCase()));

  return (
    <div className="tg">
      {nameDialog}
      <aside className="tg-panel tg-sidebar">
        <div className="tg-sidebar-head">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <p className="eyebrow">Token rooms</p>
            <span className="pill">{rooms.length}</span>
          </div>
          <input
            className="input mono"
            placeholder="Search contract…"
            value={roomFilter}
            onChange={(event) => setRoomFilter(event.target.value)}
          />
        </div>
        <div className="tg-rooms scroll-y">
          {roomsError ? (
            <p style={{ padding: 12, fontSize: '0.8rem', margin: 0, color: 'var(--danger)' }}>
              Could not load the room list — {roomsError}
            </p>
          ) : filteredRooms.length === 0 ? (
            <p className="muted" style={{ padding: 12, fontSize: '0.82rem', margin: 0 }}>
              {rooms.length === 0 ? 'No rooms yet.' : 'No rooms match that search.'}
            </p>
          ) : (
            filteredRooms.map((room) => (
              <a
                key={room.id}
                href={`/room/${encodeURIComponent(room.id)}`}
                className={`tg-room${room.id === contractAddress ? ' active' : ''}`}
              >
                <div className="avatar" style={{ background: avatarGradient(room.id) }}>
                  {initials(room.id)}
                </div>
                <div className="tg-room-body">
                  <p className="tg-room-title mono">{shortId(room.id, 10, 6)}</p>
                  <p className="tg-room-sub">
                    {room.participantCount} member{room.participantCount === 1 ? '' : 's'} · {room.messageCount} msg
                  </p>
                </div>
                {room.messageCount > 0 ? <span className="tg-room-count">{room.messageCount}</span> : null}
              </a>
            ))
          )}
        </div>
      </aside>

      <section className="tg-panel tg-main">
        <header className="tg-header">
          <div className="avatar" style={{ background: avatarGradient(contractAddress) }}>
            {initials(contractAddress)}
          </div>
          <div className="tg-header-body">
            <p className="tg-header-title">{roomTitle}</p>
            <p className="tg-header-sub">
              <span className={`dot${live ? ' dot-live' : ''}`} title={live ? 'Live' : 'Reconnecting…'} />
              {participants} member{participants === 1 ? '' : 's'} · {messages.length} messages
              {live ? '' : ' · reconnecting…'}
            </p>
          </div>
          <button type="button" className="btn btn-sm" onClick={connectWallet}>
            {walletConnected ? `⬤ ${shortId(identity)}` : 'Connect wallet'}
          </button>
          <button
            type="button"
            className={`icon-btn${showInfo ? ' active' : ''}`}
            title="Room info"
            onClick={() => setShowInfo((value) => !value)}
          >
            ⓘ
          </button>
        </header>

        {showInfo ? (
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--stroke)', display: 'grid', gap: 12 }}>
            <div>
              <p className="eyebrow">Contract</p>
              <p className="mono" style={{ margin: '6px 0 0', fontSize: '0.84rem', wordBreak: 'break-all' }}>
                {contractAddress}
              </p>
            </div>
            <div className="stat-grid">
              <div className="stat">
                <p className="stat-value">{tokenDetails?.symbol || '—'}</p>
                <p className="stat-label">Symbol</p>
              </div>
              <div className="stat">
                <p className="stat-value" style={{ fontSize: '1.1rem' }}>
                  {tokenDetails?.balance ? Number(tokenDetails.balance).toLocaleString() : '—'}
                </p>
                <p className="stat-label">Your balance</p>
              </div>
              <div className="stat">
                {/* The token's chain, read from the address format — this used
                    to print the WALLET's chain id as raw hex ("0x1"), which
                    named neither the right chain nor a chain anyone recognises. */}
                <p className="stat-value" style={{ fontSize: '1.1rem' }}>
                  {tokenChain === 'solana'
                    ? 'Solana'
                    : tokenChain === 'evm'
                      ? chainName(walletChainId) || 'EVM'
                      : '—'}
                </p>
                <p className="stat-label">Chain</p>
              </div>
            </div>
            {tokenError ? <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>{tokenError}</p> : null}
          </div>
        ) : null}

        {errorBanner}

        {voiceLounge}

        {history}

        {sendError ? (
          <p style={{ margin: 0, padding: '6px 16px', color: 'var(--danger)', fontSize: '0.8rem' }}>{sendError}</p>
        ) : null}

        {composer}
      </section>
    </div>
  );
}
