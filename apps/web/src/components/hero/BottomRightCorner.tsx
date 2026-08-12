import { motion } from 'motion/react';
import { ArrowUpRight, ChevronRight } from 'lucide-react';

/**
 * Faux-cutout corner: the panel is the page colour, and the two SVG masks fill
 * the inverse-radius notches where it meets the hero's rounded container.
 */
export function BottomRightCorner({ onOpenRoom }: { onOpenRoom: () => void }) {
  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.8, delay: 0.4 }}
      className="absolute bottom-0 right-0 p-3 pt-5 pl-8 sm:p-4 sm:pt-6 sm:pl-10 md:p-6 md:pt-8 md:pl-14 bg-[#f0f0f0] rounded-tl-[1.5rem] sm:rounded-tl-[2rem] md:rounded-tl-[3.5rem] flex items-center gap-3 sm:gap-4 md:gap-6"
    >
      <div className="absolute -top-[1.5rem] sm:-top-[2rem] md:-top-[3.5rem] right-0 w-[1.5rem] sm:w-[2rem] md:w-[3.5rem] h-[1.5rem] sm:h-[2rem] md:h-[3.5rem] pointer-events-none">
        <svg width="100%" height="100%" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M56 56V0C56 30.9279 30.9279 56 0 56H56Z" fill="#f0f0f0" />
        </svg>
      </div>

      <div className="absolute bottom-0 -left-[1.5rem] sm:-left-[2rem] md:-left-[3.5rem] w-[1.5rem] sm:w-[2rem] md:w-[3.5rem] h-[1.5rem] sm:h-[2rem] md:h-[3.5rem] pointer-events-none">
        <svg width="100%" height="100%" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M56 56H0C30.9279 56 56 30.9279 56 0V56Z" fill="#f0f0f0" />
        </svg>
      </div>

      <button
        type="button"
        onClick={onOpenRoom}
        aria-label="Open a token room"
        className="bg-[rgba(30,50,90,0.05)] w-10 h-10 md:w-14 md:h-14 rounded-full flex items-center justify-center border border-[rgba(30,50,90,0.1)] hover:bg-[rgba(30,50,90,0.1)] transition-colors"
      >
        <ArrowUpRight className="w-5 h-5 md:w-6 md:h-6 text-[rgba(30,50,90,0.8)]" />
      </button>

      <div className="flex flex-col">
        <span className="text-[16px] md:text-[20px] font-normal text-[rgba(30,50,90,0.95)]">Open a room</span>
        <div
          onClick={onOpenRoom}
          className="flex items-center gap-1 text-[rgba(30,50,90,0.6)] cursor-pointer hover:text-[rgba(30,50,90,0.8)] transition-colors"
        >
          <span className="text-[12px] md:text-[15px] font-normal">Paste a contract address</span>
          <ChevronRight className="w-4 h-4" />
        </div>
      </div>
    </motion.div>
  );
}
