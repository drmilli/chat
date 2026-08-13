import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, ChevronRight, Menu, X } from 'lucide-react';
import { Link } from 'react-router-dom';

// Every entry points somewhere real. "/#id" targets a section on the landing
// page — ScrollToHash in App.tsx performs the scroll, which react-router does
// not do on its own (which is why these items used to look dead).
const MENU = [
  { label: 'Rooms', to: '/rooms', arrow: false },
  { label: 'Features', to: '/#features', arrow: true },
  { label: 'Activity', to: '/#activity', arrow: false },
  { label: 'Extension', to: '/#extension', arrow: true },
];

export function Navbar({ onConnect, walletLabel }: { onConnect: () => void; walletLabel: string }) {
  // Below md the menu used to be hidden outright, leaving phones with no
  // navigation at all — no way to reach Rooms, Activity or Extension.
  const [open, setOpen] = useState(false);

  return (
    <nav className="flex items-center justify-between py-6 px-6 md:px-10 w-full relative z-10">
      {/* The spec leaves this slot as a bare spacer; the brand sits in it so the
          centred menu keeps its position. */}
      <div className="flex-1 hidden md:flex items-center gap-3">
        <Link to="/" className="flex items-center gap-3 no-underline">
          <img src="/logo.svg" alt="" width={34} height={34} className="rounded-[22%]" />
          <span className="font-regular tracking-tighter text-xl text-[rgba(30,50,90,0.9)]">TOKEN CHAT</span>
        </Link>
      </div>

      <ul className="hidden md:flex items-center gap-8 text-[rgb(45,45,45)] font-normal text-sm list-none m-0 p-0">
        {MENU.map((item) => (
          <li key={item.label}>
            {/* The whole item is the link — previously only the text was
                clickable, so hitting the chevron or the padding did nothing. */}
            <Link
              to={item.to}
              className="cursor-pointer hover:opacity-70 transition-opacity flex items-center gap-1 group no-underline text-[rgb(45,45,45)] py-2.5"
            >
              {item.label}
              {item.arrow ? <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" /> : null}
            </Link>
          </li>
        ))}
      </ul>

      <div className="md:hidden flex items-center gap-2">
        <Link to="/" className="no-underline py-2 pr-1">
          <span className="font-regular tracking-tighter text-xl text-[rgba(30,50,90,0.9)]">TOKEN CHAT</span>
        </Link>
      </div>

      <div className="flex-1 flex justify-end items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          className="md:hidden w-11 h-11 grid place-items-center rounded-full bg-white/70 border border-[rgba(30,50,90,0.1)] text-[rgba(30,50,90,0.8)] cursor-pointer"
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onConnect}
          className="flex items-center bg-[rgba(30,50,90,0.8)] text-white rounded-full pl-2 pr-4 md:pr-6 py-2.5 md:py-2 gap-2 md:gap-3 hover:bg-[rgba(30,50,90,1)] transition-colors group border-0 cursor-pointer"
        >
          <div className="bg-white/20 p-1 md:p-1.5 rounded-full flex items-center justify-center">
            <ArrowUpRight className="w-4 h-4 md:w-5 md:h-5 text-white" />
          </div>
          <span className="text-xs md:text-sm font-normal">{walletLabel}</span>
        </motion.button>
      </div>

      <AnimatePresence>
        {open ? (
          <motion.ul
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="md:hidden absolute top-full left-4 right-4 z-20 list-none m-0 p-2 rounded-[1.25rem] bg-white/90 backdrop-blur-xl border border-white/70 shadow-[0_20px_50px_rgba(30,50,90,0.18)]"
          >
            {MENU.map((item) => (
              <li key={item.label}>
                <Link
                  to={item.to}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between px-4 py-3 rounded-2xl no-underline text-[rgba(30,50,90,0.85)] text-[15px] hover:bg-[rgba(30,50,90,0.06)]"
                >
                  {item.label}
                  <ChevronRight className="w-4 h-4 opacity-50" />
                </Link>
              </li>
            ))}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </nav>
  );
}
