import { useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { ChatComposer } from './ChatComposer';
import { ChatHistory, ChatMessage } from './ChatHistory';
import { avatarGradient, initials, shortId } from './identity';
import { MAX_NAME_LENGTH, useProfile } from './useProfile';

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

  const profile = useProfile(walletAccount);
  const identity = profile.identityId;
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const participants = useMemo(
    () => new Set(messages.map((message) => message.identity_id)).size,
    [messages]
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/rooms/${contractAddress}/messages?limit=50`);
        if (!res.ok) throw new Error(`API responded ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setMessages(byOldestFirst(data.messages || []));
        setLoadError(null);
      } catch (err: any) {
        // Failing silently here renders an empty room, which is
        // indistinguishable from a working room nobody has posted in yet.
        if (!cancelled) {
          setMessages([]);
          setLoadError(err?.message || 'Could not reach the chat API.');
        }
      } finally {
        if (!cancelled) {
          setHiddenMessageIds(new Set());
          setReportedMessageIds(new Set());
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [contractAddress]);

  // Sidebar room list — skipped in the embedded widget, which has no sidebar.
  useEffect(() => {
    if (embedMode) return;
    let cancelled = false;
    fetch('/api/rooms?limit=25')
      .then((res) => {
        if (!res.ok) throw new Error(`rooms list unavailable (HTTP ${res.status})`);
        return res.json();
      })
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

  // Ask the host page to resize the widget iframe when the embed expands.
  useEffect(() => {
    if (!embedMode || typeof window === 'undefined' || window.parent === window) return;
    window.parent.postMessage(
      { type: 'token-chat:resize', height: expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT },
      '*'
    );
  }, [embedMode, expanded]);

  useEffect(() => {
    async function detectToken() {
      if (!contractAddress) {
        setTokenDetails(null);
        setTokenError(null);
        return;
      }
      if (typeof window === 'undefined' || !window.ethereum) {
        setTokenDetails(null);
        setTokenError('No Ethereum provider found for token detection.');
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
        setTokenDetails(null);
        setTokenError('Unable to detect token metadata for this contract.');
      }
    }
    detectToken();
  }, [walletConnected, walletAccount, contractAddress]);

  async function handleReport(messageId: number, identityId: string) {
    const response = await fetch('/api/reports', {
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
    setMessages((current) => byOldestFirst([...current, message]));
    setReplyTo(null);
    setSendError(null);
  }

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
          <button type="submit" className="btn btn-primary" disabled={profile.saving}>
            {profile.saving ? 'Saving…' : 'Save name'}
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
              <span className="dot dot-live" />
              {messages.length} messages · {participants} online
            </p>
          </div>
          <span className="muted" style={{ fontSize: '0.9rem' }}>{expanded ? '▾' : '▴'}</span>
        </div>
        {nameDialog}
        {expanded ? (
          <>
            {errorBanner}
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
              Could not load the room list — {roomsError}.
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
              <span className="dot dot-live" />
              {participants} member{participants === 1 ? '' : 's'} · {messages.length} messages
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
                <p className="stat-value" style={{ fontSize: '1.1rem' }}>{walletChainId || 'n/a'}</p>
                <p className="stat-label">Chain</p>
              </div>
            </div>
            {tokenError ? <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>{tokenError}</p> : null}
          </div>
        ) : null}

        {errorBanner}

        {history}

        {sendError ? (
          <p style={{ margin: 0, padding: '6px 16px', color: 'var(--danger)', fontSize: '0.8rem' }}>{sendError}</p>
        ) : null}

        {composer}
      </section>
    </div>
  );
}
