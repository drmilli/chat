export function ChatHistory({ messages, loading }: { messages: Array<{ id: number; identity_id: string; content: string; created_at: string }>; loading: boolean; }) {
  if (loading) return <div>Loading messages...</div>;
  if (messages.length === 0) return <div>No messages yet.</div>;

  return (
    <section style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 12, padding: 16 }}>
      {messages.map((message) => (
        <article key={message.id} style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
            <strong>{message.identity_id}</strong>
            <time style={{ color: '#888', fontSize: '0.85rem' }}>{new Date(message.created_at).toLocaleString()}</time>
          </div>
          <p style={{ margin: 0 }}>{message.content}</p>
        </article>
      ))}
    </section>
  );
}
