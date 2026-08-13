import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { avatarGradient, fetchJson, initials, shortId } from '@token-chat/ui';

type RoomSummary = {
  id: string;
  createdAt: string;
  messageCount: number;
  participantCount: number;
  lastMessageAt: string | null;
};

type Stats = {
  rooms: number;
  messages: number;
  identities: number;
  activeRooms24h: number;
  activeUsers24h: number;
};

function timeAgo(value: string | null): string {
  if (!value) return 'no activity';
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function RoomsPage() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [roomsBody, statsBody] = await Promise.all([
          fetchJson<{ rooms: RoomSummary[] }>('/api/rooms?limit=25'),
          fetchJson<Stats>('/api/rooms/stats'),
        ]);
        if (cancelled) return;
        setRooms(roomsBody.rooms || []);
        setStats(statsBody);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Unable to load rooms.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(
    () => rooms.filter((room) => room.id.toLowerCase().includes(filter.trim().toLowerCase())),
    [rooms, filter]
  );

  const tiles = stats
    ? [
        { label: 'Total rooms', value: stats.rooms },
        { label: 'Active 24h', value: stats.activeRooms24h },
        { label: 'Users 24h', value: stats.activeUsers24h },
        { label: 'Messages', value: stats.messages },
      ]
    : [];

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section className="card card-glow" style={{ display: 'grid', gap: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <p className="eyebrow">Directory</p>
            <h1 style={{ margin: '12px 0 0', fontSize: '2.1rem', letterSpacing: '-0.03em' }}>
              Active <span className="grad-text">token rooms</span>
            </h1>
          </div>
          <input
            className="input mono"
            style={{ maxWidth: 320 }}
            placeholder="Filter by contract…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>

        {stats ? (
          <div className="stat-grid">
            {tiles.map((tile) => (
              <div key={tile.label} className="stat">
                <p className="stat-value">{tile.value.toLocaleString()}</p>
                <p className="stat-label">{tile.label}</p>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {loading ? (
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>Loading rooms…</p>
        </section>
      ) : null}

      {error ? (
        <section className="card" style={{ borderColor: 'rgba(251,113,133,0.4)' }}>
          <p style={{ margin: 0, color: 'var(--danger)' }}>{error}</p>
        </section>
      ) : null}

      {!loading && !error && filtered.length === 0 ? (
        <div className="adm-empty">
          <span style={{ fontSize: '1.5rem' }}>🪐</span>
          <strong style={{ color: 'var(--text)' }}>{rooms.length === 0 ? 'No rooms yet' : 'No match'}</strong>
          <span>{rooms.length === 0 ? 'Open one with a contract address to create it.' : 'Try a different contract address.'}</span>
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 10 }}>
        {filtered.map((room) => (
          <Link key={room.id} to={`/room/${encodeURIComponent(room.id)}`} className="adm-row" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 13, minWidth: 0 }}>
              <span className="avatar" style={{ background: avatarGradient(room.id) }}>{initials(room.id)}</span>
              <div style={{ minWidth: 0 }}>
                <p className="mono" style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem' }}>{shortId(room.id, 14, 8)}</p>
                <p className="adm-sub" style={{ margin: '4px 0 0' }}>
                  {room.participantCount} member{room.participantCount === 1 ? '' : 's'} · {room.messageCount} message
                  {room.messageCount === 1 ? '' : 's'}
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
              <span className={`pill${room.lastMessageAt ? ' pill-live' : ''}`}>{timeAgo(room.lastMessageAt)}</span>
              <span className="muted" aria-hidden>›</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
