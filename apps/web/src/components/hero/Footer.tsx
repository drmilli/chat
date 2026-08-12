import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Boxes, MessagesSquare, Radio } from 'lucide-react';

export type FooterStats = {
  rooms: number;
  messages: number;
  activeRooms24h: number;
} | null;

const SUPPORTED = ['GMGN', 'Axiom', 'Padre'];

function StatLine({ Icon, label, value }: { Icon: typeof Boxes; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="w-4 h-4 text-[rgba(30,50,90,0.5)]" />
      <span className="text-[13px] text-[rgba(30,50,90,0.6)]">
        <strong className="font-normal text-[rgba(30,50,90,0.95)]">{value}</strong> {label}
      </span>
    </div>
  );
}

export function Footer({ stats, onOpenRoom }: { stats: FooterStats; onOpenRoom: () => void }) {
  const year = new Date().getFullYear();

  return (
    <motion.footer
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.7, ease: 'easeOut' }}
      className="rounded-[1.5rem] md:rounded-[3rem] bg-white/60 backdrop-blur-xl border border-white/60 p-7 md:p-12"
    >
      <div className="grid gap-10 lg:gap-8 lg:grid-cols-[1.5fr_1fr_1fr_1.2fr]">
        <div className="flex flex-col gap-4 max-w-sm">
          <Link to="/" className="flex items-center gap-3 no-underline w-fit">
            <img src="/logo.svg" alt="" width={40} height={40} className="rounded-[22%]" />
            <span className="flex flex-col leading-none">
              <span className="text-[17px] text-[rgba(30,50,90,0.95)] tracking-tight">Token Chat</span>
              <span className="text-[10px] uppercase tracking-[0.22em] text-[rgba(30,50,90,0.5)] mt-1.5">
                Contract rooms
              </span>
            </span>
          </Link>

          <p className="m-0 text-[14px] leading-relaxed text-[rgba(30,50,90,0.6)]">
            One chat room per token, keyed by contract address. Open it from the web app or straight off the chart with
            the browser extension.
          </p>

          <div className="flex flex-col gap-2 pt-1">
            <StatLine Icon={Boxes} label="token rooms" value={stats ? stats.rooms.toLocaleString() : '—'} />
            <StatLine Icon={MessagesSquare} label="messages sent" value={stats ? stats.messages.toLocaleString() : '—'} />
            <StatLine Icon={Radio} label="rooms active in 24h" value={stats ? stats.activeRooms24h.toLocaleString() : '—'} />
          </div>
        </div>

        <nav className="flex flex-col gap-3">
          <span className="text-[11px] uppercase tracking-[0.24em] text-[rgba(30,50,90,0.45)]">Product</span>
          <Link to="/rooms" className="text-[14px] text-[rgba(30,50,90,0.7)] no-underline hover:text-[rgba(30,50,90,1)] transition-colors w-fit">
            Browse rooms
          </Link>
          <button
            type="button"
            onClick={onOpenRoom}
            className="text-[14px] text-[rgba(30,50,90,0.7)] hover:text-[rgba(30,50,90,1)] transition-colors bg-transparent border-0 p-0 cursor-pointer text-left w-fit"
          >
            Open by contract address
          </button>
          <a href="#activity" className="text-[14px] text-[rgba(30,50,90,0.7)] no-underline hover:text-[rgba(30,50,90,1)] transition-colors w-fit">
            Live activity
          </a>
        </nav>

        <nav className="flex flex-col gap-3">
          <span className="text-[11px] uppercase tracking-[0.24em] text-[rgba(30,50,90,0.45)]">Extension</span>
          <a href="#extension" className="text-[14px] text-[rgba(30,50,90,0.7)] no-underline hover:text-[rgba(30,50,90,1)] transition-colors w-fit">
            How detection works
          </a>
          <span className="text-[14px] text-[rgba(30,50,90,0.7)]">Floating chat widget</span>
          <span className="text-[14px] text-[rgba(30,50,90,0.7)]">Voice messages</span>
        </nav>

        <div className="flex flex-col gap-4">
          <span className="text-[11px] uppercase tracking-[0.24em] text-[rgba(30,50,90,0.45)]">Supported sites</span>
          <div className="flex flex-wrap gap-2">
            {SUPPORTED.map((site) => (
              <span
                key={site}
                className="px-3.5 py-1.5 rounded-full bg-white/70 border border-white/60 text-[13px] text-[rgba(30,50,90,0.7)]"
              >
                {site}
              </span>
            ))}
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onOpenRoom}
            className="flex items-center bg-[rgba(30,50,90,0.8)] text-white rounded-full pl-2 pr-6 py-2 gap-3 hover:bg-[rgba(30,50,90,1)] transition-colors border-0 cursor-pointer w-fit"
          >
            <div className="bg-white/20 p-1.5 rounded-full flex items-center justify-center">
              <ArrowUpRight className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-normal">Open a room</span>
          </motion.button>
        </div>
      </div>

      <div className="mt-10 pt-6 border-t border-[rgba(30,50,90,0.1)] flex items-center justify-between gap-4 flex-wrap">
        <span className="text-[13px] text-[rgba(30,50,90,0.5)]">© {year} Token Chat</span>
        <span className="text-[13px] text-[rgba(30,50,90,0.5)]">
          EVM addresses are lowercased · Solana addresses keep their case
        </span>
      </div>
    </motion.footer>
  );
}
