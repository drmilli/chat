import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * A curated emoji picker.
 *
 * NO DEPENDENCY, AND NO FULL UNICODE SET. A complete emoji library is a
 * multi-megabyte download plus its own data file, for a chat where people use
 * roughly forty of them. This list is chosen for the room it lives in — a
 * trading chat reaches for 🚀 and 📉 far more than for 🧑‍🏫 — and costs a few
 * hundred bytes.
 *
 * Skin-tone variants are deliberately omitted: offering them means a modifier
 * UI and a preference to store, and getting it half-right (defaulting everyone
 * to one tone) is worse than not offering it.
 */

const RECENT_KEY = 'token-chat:recent-emoji';
const MAX_RECENT = 24;

type Category = { id: string; label: string; icon: string; emoji: string[] };

const CATEGORIES: Category[] = [
  {
    id: 'market',
    label: 'Market',
    icon: '🚀',
    emoji: [
      '🚀', '📈', '📉', '💎', '🙌', '🔥', '💰', '💵', '🤑', '📊',
      '🐂', '🐻', '🌕', '🌙', '⚡', '💸', '🏦', '🪙', '⛽', '🧧',
      '🎯', '🏆', '⚠️', '🚨', '🔮', '🧨', '💣', '🩸', '🧊', '🫧',
    ],
  },
  {
    id: 'smileys',
    label: 'Smileys',
    icon: '😀',
    emoji: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
      '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😋', '😛',
      '🤪', '😝', '🤗', '🤭', '🤫', '🤔', '🤐', '😐', '😑', '😶',
      '😏', '😒', '🙄', '😬', '😮‍💨', '🤥', '😌', '😔', '😪', '🤤',
      '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '😵', '🤯',
      '🤠', '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮', '😯',
      '😲', '😳', '🥺', '😦', '😨', '😰', '😥', '😢', '😭', '😱',
      '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '🤬',
      '😈', '💀', '☠️', '💩', '🤡', '👻', '👽', '🤖', '🎃', '😺',
    ],
  },
  {
    id: 'gestures',
    label: 'Gestures',
    icon: '👍',
    emoji: [
      '👍', '👎', '👌', '🤌', '✌️', '🤞', '🫰', '🤟', '🤘', '👈',
      '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤙',
      '💪', '🙏', '🤝', '👏', '🙌', '👐', '🫶', '✍️', '💅', '🫡',
      '🧠', '👀', '👁️', '👄', '🦾', '🕺', '💃', '🤷', '🤦', '🙇',
    ],
  },
  {
    id: 'hearts',
    label: 'Hearts',
    icon: '❤️',
    emoji: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️',
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
    icon: '🎉',
    emoji: [
      '🎉', '🎊', '✨', '⭐', '🌟', '💫', '🔔', '📌', '📍', '🔗',
      '📎', '🗑️', '🔒', '🔓', '🔑', '🛡️', '⚙️', '🔧', '🔨', '🧰',
      '💡', '🔍', '📢', '📣', '⏰', '⌛', '🕐', '📅', '📁', '📄',
      '☕', '🍺', '🍿', '🍕', '🎁', '🎲', '🎮', '🏁', '🚩', '🧿',
    ],
  },
  {
    id: 'symbols',
    label: 'Symbols',
    icon: '✅',
    emoji: [
      '✅', '❌', '❓', '❗', '‼️', '⁉️', '💯', '🆗', '🆕', '🔝',
      '➕', '➖', '➗', '✖️', '♾️', '🔁', '🔃', '▶️', '⏸️', '⏹️',
      '⬆️', '⬇️', '⬅️', '➡️', '↩️', '🔴', '🟠', '🟡', '🟢', '🔵',
    ],
  },
];

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((e) => typeof e === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(emoji: string) {
  try {
    const next = [emoji, ...readRecent().filter((e) => e !== emoji)].slice(0, MAX_RECENT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode — recents simply do not persist */
  }
}

type EmojiPickerProps = {
  onPick: (emoji: string) => void;
  onClose: () => void;
};

export function EmojiPicker({ onPick, onClose }: EmojiPickerProps) {
  const [active, setActive] = useState<string>('market');
  const [query, setQuery] = useState('');
  const [recent] = useState<string[]>(readRecent);
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes, and a click anywhere outside does too — a picker that traps
  // the user is worse than no picker.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    }
    function onPointerDown(event: MouseEvent) {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    }
    document.addEventListener('keydown', onKey);
    // Deferred a tick so the click that opened the picker does not close it.
    const timer = setTimeout(() => document.addEventListener('mousedown', onPointerDown), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointerDown);
      clearTimeout(timer);
    };
  }, [onClose]);

  const shown = useMemo(() => {
    if (query.trim()) {
      // Searching by label is what people expect, but a label index for every
      // emoji is most of an emoji library. Searching the category name covers
      // "heart", "market", "gesture" — the terms people actually type here.
      const needle = query.trim().toLowerCase();
      const matched = CATEGORIES.filter((category) => category.label.toLowerCase().includes(needle));
      return matched.flatMap((category) => category.emoji);
    }
    if (active === 'recent') return recent;
    return CATEGORIES.find((category) => category.id === active)?.emoji ?? [];
  }, [active, query, recent]);

  return (
    <div className="emoji-panel" ref={panelRef} role="dialog" aria-label="Choose an emoji">
      <input
        className="emoji-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search categories…"
        aria-label="Search emoji categories"
      />

      <div className="emoji-grid" role="listbox">
        {shown.length === 0 ? (
          <p className="emoji-empty muted">
            {active === 'recent' ? 'No recent emoji yet.' : 'Nothing matched.'}
          </p>
        ) : (
          shown.map((emoji, index) => (
            <button
              // Categories can repeat an emoji, so the value alone is not a key.
              key={`${emoji}-${index}`}
              type="button"
              className="emoji-cell"
              onClick={() => onPick(emoji)}
              aria-label={emoji}
            >
              {emoji}
            </button>
          ))
        )}
      </div>

      <div className="emoji-tabs" role="tablist">
        {recent.length > 0 && (
          <button
            type="button"
            role="tab"
            aria-selected={active === 'recent'}
            className={`emoji-tab${active === 'recent' ? ' is-active' : ''}`}
            onClick={() => { setActive('recent'); setQuery(''); }}
            title="Recently used"
          >
            🕘
          </button>
        )}
        {CATEGORIES.map((category) => (
          <button
            key={category.id}
            type="button"
            role="tab"
            aria-selected={active === category.id}
            className={`emoji-tab${active === category.id ? ' is-active' : ''}`}
            onClick={() => { setActive(category.id); setQuery(''); }}
            title={category.label}
          >
            {category.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
