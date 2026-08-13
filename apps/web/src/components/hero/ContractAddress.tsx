import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * The project's own token contract address.
 *
 * Swap this one constant when the token launches — the component already
 * renders a real address in monospace and shortens it on narrow screens.
 */
export const PROJECT_CONTRACT_ADDRESS = 'coming soon';

const EVM = /^0x[0-9a-fA-F]{40}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isRealAddress(value: string): boolean {
  return EVM.test(value.trim()) || BASE58.test(value.trim());
}

/** Clipboard API needs a secure context; fall back for http:// and old browsers. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    /* fall through to the legacy path */
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch (err) {
    return false;
  }
}

export function ContractAddress({
  value = PROJECT_CONTRACT_ADDRESS,
  className = '',
}: {
  value?: string;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const real = isRealAddress(value);
  const shown = real ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;

  async function handleCopy() {
    const ok = await copyText(value);
    setState(ok ? 'copied' : 'failed');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1600);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={real ? value : `Copy "${value}"`}
      aria-label={`Contract address ${value}. Click to copy.`}
      className={`group inline-flex items-center gap-2 rounded-full bg-white/60 backdrop-blur-md border border-white/40 pl-4 pr-3 py-2 cursor-pointer transition-colors hover:bg-white/80 ${className}`}
    >
      <span className="text-[12px] uppercase tracking-[0.16em] text-[rgba(30,50,90,0.5)]">CA</span>
      <span
        className={`text-[13px] text-[rgba(30,50,90,0.9)] ${real ? 'font-mono' : ''}`}
        // Announce the change without moving the layout.
        aria-live="polite"
      >
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Press ⌘C' : shown}
      </span>
      {state === 'copied' ? (
        <Check className="w-4 h-4 text-[#0f9d6b]" />
      ) : (
        <Copy className="w-4 h-4 text-[rgba(30,50,90,0.45)] group-hover:text-[rgba(30,50,90,0.8)] transition-colors" />
      )}
    </button>
  );
}
