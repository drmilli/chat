import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { avatarGradient, apiUrl, initials, shortId } from '@token-chat/ui';

type ActivityEvent = {
  kind: 'message' | 'room_created';
  roomId: string;
  identityId: string | null;
  preview: string | null;
  createdAt: string;
};

const POLL_MS = 15000;

function timeAgo(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ActivityFeed({ limit = 12 }: { limit?: number }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(apiUrl(`/api/activity?limit=${limit}`));
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? 'Activity API not found — the backend is running an older build.'
              : `Activity unavailable (HTTP ${res.status}).`
          );
        }
        const data = await res.json();
        if (cancelled) return;
        setEvents(data.events || []);
        setError(null);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Activity unavailable.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [limit]);

  return (
    <section className="card" style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <p className="eyebrow">Live activity</p>
          <h2 style={{ margin: '10px 0 0', fontSize: '1.5rem', letterSpacing: '-0.02em' }}>
            Chats and rooms, <span className="grad-text">as they happen</span>
          </h2>
        </div>
        <span className="pill pill-live">
          <span className="dot dot-live" />
          Refreshes every 15s
        </span>
      </div>

      {loading ? <p className="muted" style={{ margin: 0 }}>Loading activity…</p> : null}
      {error ? <p style={{ margin: 0, color: 'var(--danger)', fontSize: '0.88rem' }}>{error}</p> : null}

      {!loading && !error && events.length === 0 ? (
        <div className="adm-empty">
          <span style={{ fontSize: '1.5rem' }}>📡</span>
          <strong style={{ color: 'var(--text)' }}>Nothing yet</strong>
          <span>Open a room and send a message — it shows up here.</span>
        </div>
      ) : null}

      <div className="activity-list">
        {events.map((event, index) => {
          const isRoom = event.kind === 'room_created';
          const actor = isRoom ? event.roomId : event.identityId || 'anonymous';

          return (
            <Link
              key={`${event.kind}-${event.roomId}-${event.createdAt}-${index}`}
              to={`/room/${encodeURIComponent(event.roomId)}`}
              className="activity-item"
            >
              <span className="avatar avatar-sm" style={{ background: avatarGradient(actor) }}>
                {isRoom ? '✦' : initials(actor)}
              </span>

              <span className="activity-body">
                <span className="activity-line">
                  {isRoom ? (
                    <>
                      <strong>New room</strong> created for{' '}
                      <span className="mono activity-room">{shortId(event.roomId, 10, 6)}</span>
                    </>
                  ) : (
                    <>
                      <span className="mono activity-room">{shortId(actor)}</span> posted in{' '}
                      <span className="mono activity-room">{shortId(event.roomId, 10, 6)}</span>
                    </>
                  )}
                </span>
                {event.preview ? <span className="activity-preview">“{event.preview}”</span> : null}
              </span>

              <span className={`pill${isRoom ? '' : ' pill-live'} activity-time`}>{timeAgo(event.createdAt)}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
