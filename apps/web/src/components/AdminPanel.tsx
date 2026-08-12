import { FormEvent, useEffect, useState } from 'react';
import { apiUrl } from '@token-chat/ui';

type Ban = {
  id: number;
  identity_id: string | null;
  room_id: string | null;
  reason: string;
  expires_at: string | null;
  active: boolean;
  created_at: string;
};

type BlocklistPattern = {
  id: number;
  pattern: string;
  active: boolean;
  created_at: string;
};

function short(value: string | null, fallback = 'any') {
  if (!value) return fallback;
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

export function AdminPanel() {
  const [bans, setBans] = useState<Ban[]>([]);
  const [patterns, setPatterns] = useState<BlocklistPattern[]>([]);
  const [newPattern, setNewPattern] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [banIdentityId, setBanIdentityId] = useState('');
  const [banRoomId, setBanRoomId] = useState('');
  const [banReason, setBanReason] = useState('');
  const [banExpiresAt, setBanExpiresAt] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [bansRes, patternsRes] = await Promise.all([fetch(apiUrl('/api/bans')), fetch(apiUrl('/api/admin/blocklist'))]);
        const [bansData, patternsData] = await Promise.all([bansRes.json(), patternsRes.json()]);
        setBans(bansData.bans || []);
        setPatterns(patternsData.patterns || []);
      } catch (err) {
        setError('Could not reach the moderation API.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function togglePattern(patternId: number, active: boolean) {
    await fetch(apiUrl(`/api/admin/blocklist/${patternId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !active }),
    });
    setPatterns((current) => current.map((p) => (p.id === patternId ? { ...p, active: !active } : p)));
  }

  async function createPattern(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newPattern.trim()) return;
    const response = await fetch(apiUrl('/api/admin/blocklist'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: newPattern.trim() }),
    });
    const data = await response.json();
    if (response.ok && data.pattern) {
      setPatterns((current) => [data.pattern, ...current]);
      setNewPattern('');
    }
  }

  async function createBan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!banReason.trim()) return;
    const response = await fetch(apiUrl('/api/bans'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identityId: banIdentityId || null,
        roomId: banRoomId || null,
        reason: banReason.trim(),
        expiresAt: banExpiresAt || null,
      }),
    });
    const data = await response.json();
    if (response.ok && data.ban) {
      setBans((current) => [data.ban, ...current]);
      setBanIdentityId('');
      setBanRoomId('');
      setBanReason('');
      setBanExpiresAt('');
    }
  }

  async function toggleBanActive(banId: number, active: boolean) {
    const response = await fetch(apiUrl(`/api/bans/${banId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !active }),
    });
    const data = await response.json();
    if (response.ok && data.ban) {
      setBans((current) => current.map((ban) => (ban.id === banId ? data.ban : ban)));
    }
  }

  async function deleteBan(banId: number) {
    const response = await fetch(apiUrl(`/api/bans/${banId}`), { method: 'DELETE' });
    if (response.ok) {
      setBans((current) => current.filter((ban) => ban.id !== banId));
    }
  }

  const activeBans = bans.filter((ban) => ban.active).length;
  const activePatterns = patterns.filter((pattern) => pattern.active).length;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section className="card card-glow" style={{ display: 'grid', gap: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <p className="eyebrow">Moderation console</p>
            <h1 style={{ margin: '12px 0 0', fontSize: '2.1rem', letterSpacing: '-0.03em' }}>
              Keep token rooms <span className="grad-text">hostile-free</span>
            </h1>
            <p className="muted" style={{ margin: '10px 0 0', maxWidth: '62ch', lineHeight: 1.7 }}>
              Token chats are a high-value phishing target. Manage enforcement across every contract room from here.
            </p>
          </div>
          <span className="pill pill-live">
            <span className="dot dot-live" />
            Global scope
          </span>
        </div>

        <div className="stat-grid">
          <div className="stat">
            <p className="stat-value">{activeBans}</p>
            <p className="stat-label">Active bans</p>
          </div>
          <div className="stat">
            <p className="stat-value">{bans.length - activeBans}</p>
            <p className="stat-label">Disabled bans</p>
          </div>
          <div className="stat">
            <p className="stat-value">{activePatterns}</p>
            <p className="stat-label">Live patterns</p>
          </div>
          <div className="stat">
            <p className="stat-value">{patterns.length}</p>
            <p className="stat-label">Total patterns</p>
          </div>
        </div>
      </section>

      {error ? (
        <section className="card" style={{ borderColor: 'rgba(251,113,133,0.4)' }}>
          <p style={{ margin: 0, color: 'var(--danger)' }}>{error}</p>
        </section>
      ) : null}

      {loading ? (
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>Loading moderation data…</p>
        </section>
      ) : (
        <>
          <div className="adm-split">
            <section className="card">
              <div className="adm-head">
                <div>
                  <h2 className="adm-title">Create ban</h2>
                  <p className="adm-sub">Leave identity or room blank to apply globally.</p>
                </div>
                <span className="pill pill-danger">Enforcement</span>
              </div>

              <form onSubmit={createBan} style={{ display: 'grid', gap: 14 }}>
                <label className="field">
                  <span>Identity</span>
                  <input
                    className="input mono"
                    value={banIdentityId}
                    onChange={(event) => setBanIdentityId(event.target.value)}
                    placeholder="wallet address or nickname"
                  />
                </label>
                <label className="field">
                  <span>Room</span>
                  <input
                    className="input mono"
                    value={banRoomId}
                    onChange={(event) => setBanRoomId(event.target.value)}
                    placeholder="token contract address"
                  />
                </label>
                <label className="field">
                  <span>Reason</span>
                  <input
                    className="input"
                    value={banReason}
                    onChange={(event) => setBanReason(event.target.value)}
                    placeholder="spam, phishing, impersonation"
                    required
                  />
                </label>
                <label className="field">
                  <span>Expires at</span>
                  <input
                    className="input"
                    type="datetime-local"
                    value={banExpiresAt}
                    onChange={(event) => setBanExpiresAt(event.target.value)}
                  />
                </label>
                <button type="submit" className="btn btn-primary" style={{ justifySelf: 'start' }}>
                  Create ban
                </button>
              </form>
            </section>

            <section className="card">
              <div className="adm-head">
                <div>
                  <h2 className="adm-title">Bans</h2>
                  <p className="adm-sub">{bans.length} rule{bans.length === 1 ? '' : 's'} configured.</p>
                </div>
                <span className="pill">{activeBans} active</span>
              </div>

              {bans.length === 0 ? (
                <div className="adm-empty">
                  <span style={{ fontSize: '1.5rem' }}>🛡</span>
                  <strong style={{ color: 'var(--text)' }}>No bans yet</strong>
                  <span>Rooms are running unrestricted.</span>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {bans.map((ban) => (
                    <div key={ban.id} className="adm-row">
                      <div className="adm-row-body">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <strong className="mono" style={{ fontSize: '0.86rem' }} title={ban.identity_id || 'any identity'}>
                            {short(ban.identity_id)}
                          </strong>
                          <span className={`pill ${ban.active ? 'pill-danger' : ''}`}>{ban.active ? 'Enforced' : 'Disabled'}</span>
                        </div>
                        <div className="adm-kv">
                          <span>
                            <strong>Room:</strong> <span className="mono">{short(ban.room_id, 'all rooms')}</span>
                          </span>
                          <span>
                            <strong>Reason:</strong> {ban.reason}
                          </span>
                          <span>
                            <strong>Expires:</strong> {ban.expires_at ? new Date(ban.expires_at).toLocaleString() : 'never'}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
                        <button
                          type="button"
                          className={`switch${ban.active ? ' on' : ''}`}
                          onClick={() => toggleBanActive(ban.id, ban.active)}
                          title={ban.active ? 'Disable ban' : 'Enable ban'}
                          aria-pressed={ban.active}
                        />
                        <button type="button" className="btn btn-sm btn-danger" onClick={() => deleteBan(ban.id)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="card">
            <div className="adm-head">
              <div>
                <h2 className="adm-title">Blocklist patterns</h2>
                <p className="adm-sub">Messages matching an active pattern are rejected at the API.</p>
              </div>
              <span className="pill pill-warn">{activePatterns} live</span>
            </div>

            <form onSubmit={createPattern} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
              <input
                className="input"
                style={{ flex: '1 1 260px' }}
                value={newPattern}
                onChange={(event) => setNewPattern(event.target.value)}
                placeholder="e.g. fake-wallet.link"
              />
              <button type="submit" className="btn btn-primary">
                Add pattern
              </button>
            </form>

            {patterns.length === 0 ? (
              <div className="adm-empty">
                <span style={{ fontSize: '1.5rem' }}>🚫</span>
                <strong style={{ color: 'var(--text)' }}>No patterns configured</strong>
                <span>Add known drainer domains and impersonation phrases.</span>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {patterns.map((pattern) => (
                  <div key={pattern.id} className="adm-row">
                    <div className="adm-row-body">
                      <strong className="mono" style={{ fontSize: '0.88rem' }}>{pattern.pattern}</strong>
                      <span className="adm-kv">
                        <span>Added {new Date(pattern.created_at).toLocaleDateString()}</span>
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
                      <span className={`pill ${pattern.active ? 'pill-live' : ''}`}>
                        {pattern.active ? 'Blocking' : 'Off'}
                      </span>
                      <button
                        type="button"
                        className={`switch${pattern.active ? ' on' : ''}`}
                        onClick={() => togglePattern(pattern.id, pattern.active)}
                        title={pattern.active ? 'Disable pattern' : 'Enable pattern'}
                        aria-pressed={pattern.active}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
