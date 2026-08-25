import { useEffect, useRef } from 'react';
import { avatarGradient, dayKey, dayLabel, formatTime, initials, senderColor, shortId } from './identity';
import { VoiceMessage } from './VoiceMessage';
import { resolveMediaUrl } from './api';

export type ChatMessage = {
  id: number;
  identity_id: string;
  content: string;
  created_at: string;
  replyToId?: number;
  replyToIdentity?: string;
  replyToPreview?: string | null;
  replyToKind?: 'text' | 'voice' | null;
  displayName?: string | null;
  replyToDisplayName?: string | null;
  /** Wallet ownership proved by signature. */
  verified?: boolean;
  pending?: boolean;
  kind?: 'text' | 'voice';
  audioUrl?: string | null;
  duration_ms?: number | null;
};

const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function ChatHistory({
  messages,
  loading,
  currentIdentity,
  hiddenMessageIds,
  reportedMessageIds,
  onReport,
  onMute,
  onReply,
  onJumpTo,
  highlightedId,
}: {
  messages: ChatMessage[];
  loading: boolean;
  currentIdentity?: string;
  hiddenMessageIds?: Set<number>;
  reportedMessageIds?: Set<number>;
  onReport?: (messageId: number, identityId: string) => void;
  onMute?: (messageId: number) => void;
  onReply?: (messageId: number, identityId: string) => void;
  onJumpTo?: (messageId?: number) => void;
  highlightedId?: number | null;
}) {
  const feedRef = useRef<HTMLDivElement>(null);
  const visible = messages.filter((message) => !hiddenMessageIds?.has(message.id));

  // Keep the newest message in view, the way a messenger does.
  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [visible.length, loading]);

  if (loading) {
    return (
      <div className="tg-feed scroll-y">
        <div className="tg-empty">
          <span style={{ fontSize: '1.6rem' }}>◌</span>
          <span>Loading messages…</span>
        </div>
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <div className="tg-feed scroll-y">
        <div className="tg-empty">
          <span style={{ fontSize: '1.8rem' }}>💬</span>
          <strong style={{ color: 'var(--text)' }}>No messages yet</strong>
          <span>Be the first to say something in this token room.</span>
        </div>
      </div>
    );
  }

  let lastDay = '';

  return (
    <div className="tg-feed scroll-y" ref={feedRef}>
      {visible.map((message, index) => {
        const own = Boolean(currentIdentity && message.identity_id === currentIdentity);
        const previous = visible[index - 1];
        const next = visible[index + 1];

        const day = dayKey(message.created_at);
        const showDay = day !== lastDay;
        if (showDay) lastDay = day;

        const grouped =
          !showDay &&
          previous?.identity_id === message.identity_id &&
          new Date(message.created_at).getTime() - new Date(previous.created_at).getTime() < GROUP_WINDOW_MS;

        // The last message of a run gets the bubble tail and the avatar.
        const endsRun =
          next?.identity_id !== message.identity_id ||
          new Date(next.created_at).getTime() - new Date(message.created_at).getTime() >= GROUP_WINDOW_MS;

        const reported = reportedMessageIds?.has(message.id);

        return (
          <div key={message.id} style={{ display: 'contents' }}>
            {showDay ? <div className="tg-day">{dayLabel(message.created_at)}</div> : null}

            <div
              id={`msg-${message.id}`}
              className={`tg-row${own ? ' own' : ''}${grouped ? ' grouped' : ''}${
                highlightedId === message.id ? ' highlighted' : ''
              }`}
            >
              <div className="tg-avatar-slot">
                {endsRun ? (
                  <div
                    className="avatar avatar-sm"
                    style={{ background: avatarGradient(message.identity_id) }}
                    title={message.identity_id}
                  >
                    {initials(message.displayName || message.identity_id)}
                  </div>
                ) : null}
              </div>

              <div className={`tg-bubble${own ? ' own' : ''}${endsRun ? ' tail' : ''}`}>
                {!own && !grouped ? (
                  <span className="tg-sender" style={{ color: senderColor(message.identity_id) }}>
                    {message.displayName || shortId(message.identity_id)}
                    {message.verified ? (
                      <span className="tg-verified" title="Wallet ownership verified by signature" aria-label="Verified wallet">
                        ✓
                      </span>
                    ) : null}
                  </span>
                ) : null}

                {message.replyToIdentity ? (
                  <button
                    type="button"
                    className="tg-quote"
                    title="Go to the replied message"
                    onClick={() => onJumpTo?.(message.replyToId)}
                  >
                    <span className="tg-quote-author">
                      {message.replyToDisplayName || shortId(message.replyToIdentity)}
                    </span>
                    <span className="tg-quote-text">
                      {message.replyToKind === 'voice' ? '🎤 Voice message' : message.replyToPreview || 'Message unavailable'}
                    </span>
                  </button>
                ) : null}

                {message.kind === 'voice' && message.audioUrl ? (
                  <div className="tg-text">
                    <VoiceMessage
                      messageId={message.id}
                      src={resolveMediaUrl(message.audioUrl)!}
                      durationMs={message.duration_ms}
                      own={own}
                    />
                    <span className="tg-meta">
                      {formatTime(message.created_at)}
                      {own ? <span aria-hidden>{message.pending ? '🕓' : '✓✓'}</span> : null}
                    </span>
                  </div>
                ) : (
                  <p className="tg-text">
                    {message.content}
                    <span className="tg-meta">
                      {formatTime(message.created_at)}
                      {own ? <span aria-hidden>{message.pending ? '🕓' : '✓✓'}</span> : null}
                    </span>
                  </p>
                )}
              </div>

              <div className="tg-actions">
                <button type="button" className="tg-action" title="Reply" onClick={() => onReply?.(message.id, message.identity_id)}>
                  ↩
                </button>
                <button
                  type="button"
                  className={`tg-action${reported ? ' reported' : ''}`}
                  title={reported ? 'Reported' : 'Report'}
                  disabled={reported}
                  onClick={() => onReport?.(message.id, message.identity_id)}
                >
                  ⚑
                </button>
                <button type="button" className="tg-action" title="Hide" onClick={() => onMute?.(message.id)}>
                  ⊘
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
