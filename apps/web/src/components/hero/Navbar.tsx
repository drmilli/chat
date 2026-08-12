import { motion } from 'motion/react';
import { ArrowUpRight, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

const MENU = [
  { label: 'Rooms', to: '/rooms', hasDropdown: false },
  { label: 'Activity', to: '/#activity', hasDropdown: true },
  { label: 'Extension', to: '/#extension', hasDropdown: false },
  { label: 'Widget', to: '/#extension', hasDropdown: true },
];

export function Navbar({
  onConnect,
  walletLabel,
}: {
  onConnect: () => void;
  walletLabel: string;
}) {
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

      <ul className="hidden md:flex items-center gap-8 text-[rgb(45,45,45)] font-normal text-sm">
        {MENU.map((item) => (
          <li key={item.label} className="cursor-pointer hover:opacity-70 transition-opacity flex items-center gap-1 group">
            <Link to={item.to}>{item.label}</Link>
            {item.hasDropdown ? <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" /> : null}
          </li>
        ))}
      </ul>

      <div className="md:hidden">
        <span className="font-regular tracking-tighter text-xl text-[rgba(30,50,90,0.9)]">TOKEN CHAT</span>
      </div>

      <div className="flex-1 flex justify-end">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onConnect}
          className="flex items-center bg-[rgba(30,50,90,0.8)] text-white rounded-full pl-2 pr-4 md:pr-6 py-1.5 md:py-2 gap-2 md:gap-3 hover:bg-[rgba(30,50,90,1)] transition-colors group"
        >
          <div className="bg-white/20 p-1 md:p-1.5 rounded-full flex items-center justify-center">
            <ArrowUpRight className="w-4 h-4 md:w-5 md:h-5 text-white" />
          </div>
          <span className="text-xs md:text-sm font-normal">{walletLabel}</span>
        </motion.button>
      </div>
    </nav>
  );
}
