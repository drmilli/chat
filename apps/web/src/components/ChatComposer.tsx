import React, { useState } from 'react';

export function ChatComposer({ contractAddress, onSent }: { contractAddress: string; onSent: (msg: { id: number; identity_id: string; content: string; created_at: string }) => void; }) {
  const [content, setContent] = useState('');
  const [identityId, setIdentityId] = useState('anonymous');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim()) return;

    setSubmitting(true);
    try {
      const response = await fetch(`/api/rooms/${contractAddress}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identityId, content }),
      });
      const data = await response.json();
      if (response.ok) {
        onSent(data.message);
        setContent('');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12, background: '#fff', border: '1px solid #ddd', borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <label style={{ fontSize: '0.9rem', color: '#444' }}>
          Identity
          <input value={identityId} onChange={(event) => setIdentityId(event.target.value)} style={{ width: '100%', padding: '10px 12px', fontSize: '1rem', borderRadius: 8, border: '1px solid #ccc' }} />
        </label>
      </div>
      <label style={{ fontSize: '0.9rem', color: '#444' }}>
        Message
        <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={4} style={{ width: '100%', padding: '10px 12px', fontSize: '1rem', borderRadius: 8, border: '1px solid #ccc' }} />
      </label>
      <button type="submit" disabled={submitting || !content.trim()} style={{ border: 'none', borderRadius: 10, background: '#2563eb', color: '#fff', fontSize: '1rem', padding: '12px 16px', cursor: 'pointer' }}>
        {submitting ? 'Sending…' : 'Send'}
      </button>
    </form>
  );
}
