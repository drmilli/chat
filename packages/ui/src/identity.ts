// Deterministic per-identity colors and label helpers, so a wallet or nickname
// always renders with the same avatar and sender colour across the app.

const AVATARS = [
  'linear-gradient(135deg, #7c5cff, #22d3ee)',
  'linear-gradient(135deg, #f472b6, #f59e0b)',
  'linear-gradient(135deg, #2dd4a7, #38bdf8)',
  'linear-gradient(135deg, #fb7185, #a855f7)',
  'linear-gradient(135deg, #38bdf8, #6366f1)',
  'linear-gradient(135deg, #facc15, #fb923c)',
  'linear-gradient(135deg, #34d399, #0ea5e9)',
  'linear-gradient(135deg, #c084fc, #6366f1)',
];

// Readable on the light glass bubbles — each stays above 4.5:1 on white.
const SENDER_COLORS = ['#1d5fa8', '#a3346e', '#0b7a53', '#a63a3a', '#5b46b5', '#8a5a12', '#0f6f74', '#2f5aa8'];

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h << 5) - h + value.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function avatarGradient(id: string): string {
  return AVATARS[hash(id || 'anon') % AVATARS.length];
}

export function senderColor(id: string): string {
  return SENDER_COLORS[hash(id || 'anon') % SENDER_COLORS.length];
}

export function initials(id: string): string {
  const value = (id || 'anon').replace(/^0x/i, '');
  return value.slice(0, 2);
}

export function shortId(id: string, lead = 6, tail = 4): string {
  if (!id) return 'anonymous';
  if (id.length <= lead + tail + 2) return id;
  return `${id.slice(0, lead)}…${id.slice(-tail)}`;
}

export function formatTime(value: string | number | Date): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function dayLabel(value: string | number | Date): string {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export function dayKey(value: string | number | Date): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
