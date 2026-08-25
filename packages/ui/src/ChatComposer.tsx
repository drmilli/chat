import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from './ChatHistory';
import { shortId } from './identity';
import { formatDuration, isRecordingSupported, useVoiceRecorder } from './useVoiceRecorder';
import { apiUrl, fetchJson, ApiError } from './api';
import { ensureSession } from './session';

const MAX_VOICE_MS = 2 * 60 * 1000;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the recording.'));
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

export function ChatComposer({
  contractAddress,
  defaultIdentity,
  displayName,
  onRename,
  onSent,
  onError,
  replyTo,
  onCancelReply,
}: {
  contractAddress: string;
  defaultIdentity?: string;
  displayName?: string | null;
  onRename?: () => void;
  onSent: (msg: ChatMessage) => void;
  onError?: (message: string) => void;
  replyTo?: { id: number; identity: string; preview?: string | null; kind?: 'text' | 'voice' | null };
  onCancelReply?: () => void;
}) {
  const [content, setContent] = useState('');
  const [identityId, setIdentityId] = useState(defaultIdentity ?? 'anonymous');
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recorder = useVoiceRecorder();
  const recordingSupported = isRecordingSupported();
  const isRecording = recorder.status === 'recording' || recorder.status === 'requesting';

  useEffect(() => {
    setIdentityId(defaultIdentity ?? 'anonymous');
  }, [defaultIdentity]);

  // Auto-grow the input up to the CSS max-height, like a messenger composer.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [content]);

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  // Auto-stop at the server's ceiling instead of recording something that will
  // be rejected on upload.
  useEffect(() => {
    if (recorder.status === 'recording' && recorder.elapsedMs >= MAX_VOICE_MS) {
      finishRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.status, recorder.elapsedMs]);

  async function post(body: Record<string, unknown>) {
    setSubmitting(true);
    try {
      // Sending before the session bootstrap finished would 401. Waiting here
      // makes the composer correct regardless of how fast the user types.
      await ensureSession();
      const data = await fetchJson<{ message: ChatMessage }>(`/api/rooms/${contractAddress}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identityId,
          replyToId: replyTo?.id,
          replyToIdentity: replyTo?.identity,
          ...body,
        }),
      });
      if (data.message) {
        onSent(data.message);
        onCancelReply?.();
        return true;
      }
      onError?.('Message could not be sent.');
      return false;
    } catch (err) {
      onError?.(err instanceof ApiError ? err.message : 'Network error — message not sent.');
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function submit() {
    if (!content.trim() || submitting) return;
    if (await post({ content })) setContent('');
  }

  async function finishRecording() {
    const recording = await recorder.stop();
    if (!recording) return;

    // A tap that never became a real recording should not post an empty clip.
    if (recording.durationMs < 500) {
      onError?.('Recording too short — hold the mic button a moment longer.');
      return;
    }

    try {
      const audioBase64 = await blobToBase64(recording.blob);
      await post({
        kind: 'voice',
        audioBase64,
        audioMime: recording.mimeType,
        durationMs: recording.durationMs,
        content: '[voice message]',
      });
    } catch (err: any) {
      onError?.(err?.message || 'Could not process the recording.');
    }
  }

  return (
    <form
      className="tg-composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {replyTo ? (
        <div className="tg-replybar">
          <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
            <span>
              Replying to <strong className="mono">{shortId(replyTo.identity)}</strong>
            </span>
            <span className="tg-quote-text">
              {replyTo.kind === 'voice' ? '🎤 Voice message' : replyTo.preview || ''}
            </span>
          </span>
          <button type="button" className="icon-btn" style={{ width: 26, height: 26, fontSize: '0.9rem' }} onClick={onCancelReply} title="Cancel reply">
            ×
          </button>
        </div>
      ) : null}

      {recorder.error ? (
        <div className="tg-replybar" style={{ borderLeftColor: 'var(--danger)', background: 'rgba(251,113,133,0.1)' }}>
          <span style={{ flex: 1, minWidth: 0, color: 'var(--danger)' }}>{recorder.error}</span>
          <button
            type="button"
            className="icon-btn"
            style={{ width: 26, height: 26, fontSize: '0.9rem' }}
            onClick={recorder.clearError}
            title="Dismiss"
          >
            ×
          </button>
        </div>
      ) : null}

      {isRecording ? (
        <div className="tg-inputrow">
          <button
            type="button"
            className="voice-cancel"
            onClick={recorder.cancel}
            title="Discard recording"
            aria-label="Discard recording"
          >
            🗑
          </button>

          <div className="voice-recording">
            <span className="voice-rec-dot" />
            <span className="voice-elapsed mono">{formatDuration(recorder.elapsedMs)}</span>
            <div className="voice-meter" aria-hidden>
              {Array.from({ length: 18 }).map((_, index) => (
                <span
                  key={index}
                  className="voice-meter-bar"
                  style={{
                    // Centre bars react most, so the meter reads like a level display.
                    height: `${Math.max(
                      12,
                      Math.min(100, recorder.level * 100 * (1 - Math.abs(index - 8.5) / 14))
                    )}%`,
                  }}
                />
              ))}
            </div>
            <span className="muted" style={{ fontSize: '0.72rem' }}>
              {recorder.status === 'requesting' ? 'Allow mic…' : 'Recording'}
            </span>
          </div>

          <button
            type="button"
            className="tg-send"
            onClick={finishRecording}
            disabled={submitting || recorder.status === 'requesting'}
            title="Send voice message"
            aria-label="Send voice message"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M2.4 21.6 23 12 2.4 2.4l-.9 7.5L16 12 1.5 14.1z" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="tg-inputrow">
          <textarea
            ref={textareaRef}
            className="tg-textarea"
            rows={1}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Write a message…"
          />

          {/* Telegram behaviour: the mic replaces send until there is text to send. */}
          {content.trim() || !recordingSupported ? (
            <button type="submit" className="tg-send" disabled={submitting || !content.trim()} title="Send">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M2.4 21.6 23 12 2.4 2.4l-.9 7.5L16 12 1.5 14.1z" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className="tg-send voice-mic"
              onClick={recorder.start}
              disabled={submitting}
              title="Record a voice message"
              aria-label="Record a voice message"
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3z" />
                <path d="M18 11a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.9V20h-2a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-3.1A6 6 0 0 0 18 11z" />
              </svg>
            </button>
          )}
        </div>
      )}

      <div className="tg-identity">
        <span className="dot dot-live" />
        <span>
          Sending as{' '}
          <button type="button" className="tg-name-btn" onClick={onRename} title="Change your display name">
            <strong className={displayName ? '' : 'mono'}>{displayName || shortId(identityId)}</strong>
            <span aria-hidden>✎</span>
          </button>
        </span>
        <span className="tg-hint">Enter to send · Shift+Enter for a new line</span>
      </div>
    </form>
  );
}
