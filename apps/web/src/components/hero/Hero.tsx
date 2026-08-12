import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Navbar } from './Navbar';
import { HeroBadge } from './HeroBadge';
import { BottomLeftCard } from './BottomLeftCard';
import { BottomRightCorner } from './BottomRightCorner';

const VIDEO_SRC =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260428_193507_4286c423-2fd9-4efd-92bd-91a939453fc1.mp4';

// Slow-drifting blurred light over the video. Long, mismatched durations keep
// the loop from ever visibly repeating.
const ORBS = [
  { size: 420, left: '6%', top: '14%', color: 'radial-gradient(circle, #7fb2ff, transparent 70%)', opacity: 0.34, drift: [0, 90, -30, 0], rise: [0, -60, 40, 0], duration: 26 },
  { size: 320, left: '62%', top: '8%', color: 'radial-gradient(circle, #a5f3e0, transparent 70%)', opacity: 0.3, drift: [0, -70, 40, 0], rise: [0, 70, -30, 0], duration: 32 },
  { size: 500, left: '38%', top: '52%', color: 'radial-gradient(circle, #c9b8ff, transparent 70%)', opacity: 0.26, drift: [0, 60, -80, 0], rise: [0, -40, 30, 0], duration: 38 },
  { size: 280, left: '82%', top: '58%', color: 'radial-gradient(circle, #ffd7a8, transparent 70%)', opacity: 0.24, drift: [0, -50, 30, 0], rise: [0, 50, -40, 0], duration: 29 },
];

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export function Hero({
  onConnect,
  walletLabel,
  onOpenRoom,
  rooms,
}: {
  onConnect: () => void;
  walletLabel: string;
  onOpenRoom: () => void;
  rooms: number | null;
}) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <div className="w-full h-screen flex items-center justify-center p-3 md:p-5 bg-[#f0f0f0]">
      {/* The gradient lives on the section itself, so it shows through only
          while the video buffers instead of covering it. */}
      <section
        className="relative w-full max-w-[1536px] h-full rounded-[1.5rem] md:rounded-[3rem] overflow-hidden shadow-none flex flex-col items-center bg-white/10 group"
        style={{ background: 'linear-gradient(135deg, #dfe6f2 0%, #eef1f6 50%, #cfd9ea 100%)' }}
      >
        <motion.video
          autoPlay
          muted
          loop
          playsInline
          initial={{ opacity: 0, scale: 1.08 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ opacity: { duration: 1.2 }, scale: { duration: 24, ease: 'easeOut' } }}
          className="absolute inset-0 w-full h-full object-cover object-[65%] lg:object-center z-0"
          src={VIDEO_SRC}
        />

        {/* Drifting light — sits above the video, below the content. */}
        <div className="absolute inset-0 z-[1] pointer-events-none overflow-hidden">
          {ORBS.map((orb, index) => (
            <motion.div
              key={index}
              className="absolute rounded-full blur-3xl"
              style={{
                width: orb.size,
                height: orb.size,
                left: orb.left,
                top: orb.top,
                background: orb.color,
                opacity: orb.opacity,
              }}
              animate={reducedMotion ? undefined : { x: orb.drift, y: orb.rise, scale: [1, 1.12, 1] }}
              transition={
                reducedMotion
                  ? undefined
                  : { duration: orb.duration, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }
              }
            />
          ))}
        </div>

        <div className="relative z-10 w-full h-full flex flex-col items-center">
          <Navbar onConnect={onConnect} walletLabel={walletLabel} />

          <div className="w-full flex flex-col items-center pt-8 px-6 text-center max-w-4xl">
            <HeroBadge />

            <motion.h1
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="text-4xl sm:text-5xl md:text-6xl lg:text-[80px] font-normal text-[#5E6470] mb-2 tracking-tight leading-[1.05]"
            >
              One Room Per Token
            </motion.h1>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="text-sm sm:text-base md:text-lg text-[#5E6470] opacity-80 leading-relaxed max-w-xl font-normal"
            >
              Paste a contract address to open its chat room, connect your wallet, send voice notes — the same room the
              extension opens on the chart.
            </motion.p>
          </div>

          <BottomLeftCard rooms={rooms} />
          <BottomRightCorner onOpenRoom={onOpenRoom} />
        </div>
      </section>
    </div>
  );
}
