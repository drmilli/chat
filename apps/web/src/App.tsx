import { ReactNode, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, useParams, Navigate, NavLink, Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowUpRight, Link2, Mic, ShieldCheck, Wallet } from 'lucide-react';
import { ChatPage, apiUrl } from '@token-chat/ui';
import { AdminPanel } from './components/AdminPanel';
import { RoomsPage } from './components/RoomsPage';
import { ActivityFeed } from './components/ActivityFeed';
import { Hero } from './components/hero/Hero';
import { Footer, FooterStats } from './components/hero/Footer';
import { useWallet, WalletState } from './hooks/useWallet';
import { isValidCA, normalizeCA } from './utils/ca';

type PromptMode = 'room' | 'embed';

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function walletLabel(wallet: WalletState) {
  if (wallet.isConnected && wallet.account) return shortAddress(wallet.account);
  return wallet.connecting ? 'Connecting…' : 'Connect wallet';
}

/** Compact top bar for the inner pages; the landing uses the Hero's own navbar. */
function Topbar({
  wallet,
  connect,
  openContractPrompt,
}: {
  wallet: WalletState;
  connect: () => Promise<void>;
  openContractPrompt: (mode: PromptMode) => void;
}) {
  return (
    <nav className="flex items-center justify-between gap-4 py-5 px-1 w-full flex-wrap">
      <Link to="/" className="flex items-center gap-3 no-underline">
        <img src="/logo.svg" alt="" width={38} height={38} className="rounded-[22%]" />
        <span className="flex flex-col leading-none">
          <span className="text-[15px] font-normal text-[rgba(30,50,90,0.95)] tracking-tight">Token Chat</span>
          <span className="text-[10px] uppercase tracking-[0.22em] text-[rgba(30,50,90,0.5)] mt-1">Contract rooms</span>
        </span>
      </Link>

      <div className="flex items-center gap-6 flex-wrap">
        <ul className="flex items-center gap-6 text-[rgb(45,45,45)] font-normal text-sm list-none m-0 p-0">
          <li>
            <NavLink
              to="/rooms"
              className={({ isActive }) =>
                `no-underline transition-opacity hover:opacity-70 ${
                  isActive ? 'text-[rgba(30,50,90,0.95)]' : 'text-[rgba(30,50,90,0.6)]'
                }`
              }
            >
              Rooms
            </NavLink>
          </li>
          <li>
            <button
              type="button"
              onClick={() => openContractPrompt('room')}
              className="bg-transparent border-0 p-0 cursor-pointer text-sm font-normal text-[rgba(30,50,90,0.6)] hover:opacity-70 transition-opacity"
            >
              Open room
            </button>
          </li>
        </ul>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={connect}
          title={wallet.error || undefined}
          className="flex items-center bg-[rgba(30,50,90,0.8)] text-white rounded-full pl-2 pr-4 md:pr-6 py-1.5 md:py-2 gap-2 md:gap-3 hover:bg-[rgba(30,50,90,1)] transition-colors border-0 cursor-pointer"
        >
          <div className="bg-white/20 p-1 md:p-1.5 rounded-full flex items-center justify-center">
            <ArrowUpRight className="w-4 h-4 md:w-5 md:h-5 text-white" />
          </div>
          <span className="text-xs md:text-sm font-normal">{walletLabel(wallet)}</span>
        </motion.button>
      </div>
    </nav>
  );
}

function Shell({
  children,
  wallet,
  connect,
  openContractPrompt,
}: {
  children: ReactNode;
  wallet: WalletState;
  connect: () => Promise<void>;
  openContractPrompt: (mode: PromptMode) => void;
}) {
  return (
    <div className="min-h-screen bg-[#f0f0f0] px-3 md:px-5 pb-10">
      <div className="mx-auto w-full max-w-[1536px]">
        <Topbar wallet={wallet} connect={connect} openContractPrompt={openContractPrompt} />
        {children}
      </div>
    </div>
  );
}

function RoomRoute({ wallet, connect }: { wallet: WalletState; connect: () => Promise<void> }) {
  const { ca } = useParams();
  if (!ca) return <Navigate to="/" replace />;
  return (
    <ChatPage
      contractAddress={ca}
      walletAccount={wallet.account ?? undefined}
      walletChainId={wallet.chainId ?? undefined}
      walletConnected={wallet.isConnected}
      connectWallet={connect}
    />
  );
}

function EmbedRoute({ wallet, connect }: { wallet: WalletState; connect: () => Promise<void> }) {
  const { ca } = useParams();
  if (!ca) return <Navigate to="/" replace />;
  return (
    <ChatPage
      contractAddress={ca}
      embedMode
      walletAccount={wallet.account ?? undefined}
      walletChainId={wallet.chainId ?? undefined}
      walletConnected={wallet.isConnected}
      connectWallet={connect}
    />
  );
}

const FEATURES = [
  {
    Icon: Link2,
    title: 'Contract-keyed rooms',
    body: 'The contract address is the room id. No registration, no owner, no duplicate communities for the same token.',
  },
  {
    Icon: Wallet,
    title: 'Wallet-native identity',
    body: 'Connect to chat as your address and surface your token balance right inside the room.',
  },
  {
    Icon: Mic,
    title: 'Voice messages',
    body: 'Hold the mic to send a voice note. Clips stream back from the API with playback and seeking.',
  },
  {
    Icon: ShieldCheck,
    title: 'Moderation built in',
    body: 'Scam-link blocklists, per-room bans and reports keep a high-value phishing target under control.',
  },
];

function Landing({
  onConnect,
  wallet,
  openContractPrompt,
}: {
  onConnect: () => Promise<void>;
  wallet: WalletState;
  openContractPrompt: (mode: PromptMode) => void;
}) {
  // Fetched once here and shared with the hero card and the footer.
  const [stats, setStats] = useState<FooterStats>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl('/api/rooms/stats'))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setStats(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#f0f0f0]">
      <Hero
        onConnect={onConnect}
        walletLabel={walletLabel(wallet)}
        onOpenRoom={() => openContractPrompt('room')}
        rooms={stats ? stats.rooms : null}
      />

      <div className="mx-auto w-full max-w-[1536px] px-3 md:px-5 pb-16 flex flex-col gap-4 md:gap-5">
        <section className="grid gap-4 md:gap-5 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ Icon, title, body }) => (
            <div
              key={title}
              className="rounded-[1.5rem] md:rounded-[2rem] bg-white/60 backdrop-blur-xl border border-white/60 p-6 flex flex-col gap-3"
            >
              <div className="bg-[rgba(30,50,90,0.05)] w-11 h-11 rounded-full flex items-center justify-center border border-[rgba(30,50,90,0.1)]">
                <Icon className="w-5 h-5 text-[rgba(30,50,90,0.8)]" />
              </div>
              <span className="text-[18px] font-normal text-[rgba(30,50,90,0.95)]">{title}</span>
              <p className="m-0 text-[14px] leading-relaxed text-[rgba(30,50,90,0.6)]">{body}</p>
            </div>
          ))}
        </section>

        <section
          id="extension"
          className="rounded-[1.5rem] md:rounded-[3rem] bg-white/60 backdrop-blur-xl border border-white/60 p-7 md:p-10 flex flex-col gap-4"
        >
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <span className="text-[11px] uppercase tracking-[0.28em] text-[rgba(30,50,90,0.5)]">Extension</span>
              <h2 className="m-0 mt-3 text-[26px] md:text-[34px] font-normal tracking-tight text-[rgba(30,50,90,0.95)]">
                Detects the token you're looking at
              </h2>
            </div>
            <span className="px-4 py-2 rounded-full bg-white/70 border border-white/60 text-[13px] text-[rgba(30,50,90,0.7)]">
              GMGN · Axiom · Padre
            </span>
          </div>
          <p className="m-0 max-w-[70ch] text-[15px] leading-relaxed text-[rgba(30,50,90,0.6)]">
            The browser extension reads the contract address from the page, badges the toolbar, and opens the matching
            room — in a floating widget on the site or in a full tab here. Detection falls back to a manual paste if a
            site changes its markup, so the widget degrades instead of breaking.
          </p>
        </section>

        <div id="activity">
          <ActivityFeed />
        </div>

        <Footer stats={stats} onOpenRoom={() => openContractPrompt('room')} />
      </div>
    </main>
  );
}

export function App() {
  const { wallet, connect, connectWith, dismissError, cancelChoosing } = useWallet();
  const [promptMode, setPromptMode] = useState<PromptMode | null>(null);
  const [contractInput, setContractInput] = useState('');
  const [promptError, setPromptError] = useState<string | null>(null);
  const autoConnected = useRef(false);

  // The extension popup links here with ?connect=1 to hand wallet connection off
  // to the page, where an injected provider is actually available.
  useEffect(() => {
    if (autoConnected.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('connect') !== '1') return;
    autoConnected.current = true;
    connect();
  }, [connect]);

  function openContractPrompt(mode: PromptMode) {
    setPromptMode(mode);
    setContractInput('');
    setPromptError(null);
  }

  function closeContractPrompt() {
    setPromptMode(null);
    setPromptError(null);
  }

  function submitContract() {
    if (!contractInput.trim()) {
      setPromptError('Please enter a contract address.');
      return;
    }
    if (!isValidCA(contractInput)) {
      setPromptError('That does not look like an EVM or Solana address.');
      return;
    }

    const normalizedCA = normalizeCA(contractInput);
    setPromptMode(null);
    window.location.href = promptMode === 'embed' ? `/embed/${normalizedCA}` : `/room/${normalizedCA}`;
  }

  const shellProps = { wallet, connect, openContractPrompt };

  return (
    <>
      <BrowserRouter>
        <Routes>
          {/* The embed renders bare — it lives inside the extension's widget iframe. */}
          <Route path="/embed/:ca" element={<EmbedRoute wallet={wallet} connect={connect} />} />
          <Route
            path="/"
            element={<Landing onConnect={connect} wallet={wallet} openContractPrompt={openContractPrompt} />}
          />
          <Route
            path="/rooms"
            element={
              <Shell {...shellProps}>
                <RoomsPage />
              </Shell>
            }
          />
          <Route
            path="/room/:ca"
            element={
              <Shell {...shellProps}>
                <RoomRoute wallet={wallet} connect={connect} />
              </Shell>
            }
          />
          <Route
            path="/admin"
            element={
              <Shell {...shellProps}>
                <AdminPanel />
              </Shell>
            }
          />
          <Route
            path="*"
            element={
              <Shell {...shellProps}>
                <div className="rounded-[2rem] bg-white/60 backdrop-blur-xl border border-white/60 p-8">
                  <h2 className="m-0 text-[24px] font-normal text-[rgba(30,50,90,0.95)]">Nothing here</h2>
                  <p className="m-0 mt-2 text-[rgba(30,50,90,0.6)]">
                    Use <code className="mono">/room/&lt;CA&gt;</code> or <code className="mono">/embed/&lt;CA&gt;</code>.
                  </p>
                </div>
              </Shell>
            }
          />
        </Routes>
      </BrowserRouter>

      {/* With several wallet extensions installed they all fight over
          window.ethereum, so the user picks which one to connect. */}
      {wallet.choosing ? (
        <div className="modal-backdrop" onClick={cancelChoosing}>
          <div className="modal" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 420 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
              <div>
                <p className="eyebrow">Connect</p>
                <h2 style={{ margin: '10px 0 0', fontSize: '1.5rem', letterSpacing: '-0.02em' }}>Choose a wallet</h2>
              </div>
              <button type="button" className="icon-btn" onClick={cancelChoosing} aria-label="Close">
                ×
              </button>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              {wallet.wallets.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="adm-row"
                  style={{ cursor: 'pointer', textAlign: 'left', font: 'inherit' }}
                  onClick={() => connectWith(entry)}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    {entry.icon ? (
                      <img src={entry.icon} alt="" width={28} height={28} style={{ borderRadius: 8 }} />
                    ) : (
                      <span className="avatar avatar-sm" style={{ background: 'var(--accent)' }}>
                        {entry.name.slice(0, 2)}
                      </span>
                    )}
                    <span style={{ fontSize: '0.95rem' }}>{entry.name}</span>
                  </span>
                  <span className="pill">{entry.kind === 'solana' ? 'Solana' : 'EVM'}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Without this the wallet button silently does nothing when no provider is injected. */}
      {wallet.error ? (
        <div className="wallet-toast" role="alert">
          <span style={{ fontSize: '1.1rem', lineHeight: 1.2 }}>👛</span>
          <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 8 }}>
            <strong style={{ fontSize: '0.92rem' }}>Wallet not connected</strong>
            <p className="muted" style={{ margin: 0, fontSize: '0.83rem', lineHeight: 1.55 }}>{wallet.error}</p>
            {wallet.noProvider ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a className="btn btn-sm" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                  Get MetaMask
                </a>
                <a className="btn btn-sm" href="https://phantom.app/download" target="_blank" rel="noreferrer">
                  Get Phantom
                </a>
              </div>
            ) : (
              <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={connect}>
                Try again
              </button>
            )}
          </div>
          <button type="button" className="icon-btn" onClick={dismissError} aria-label="Dismiss">
            ×
          </button>
        </div>
      ) : null}

      {promptMode ? (
        <div className="modal-backdrop" onClick={closeContractPrompt}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
              <div>
                <p className="eyebrow">{promptMode === 'embed' ? 'Preview widget' : 'Open room'}</p>
                <h2 style={{ margin: '10px 0 0', fontSize: '1.6rem', letterSpacing: '-0.02em' }}>Enter contract address</h2>
              </div>
              <button type="button" className="icon-btn" onClick={closeContractPrompt} aria-label="Close">
                ×
              </button>
            </div>

            <label className="field">
              <span>Contract address</span>
              <input
                className="input mono"
                autoFocus
                value={contractInput}
                onChange={(event) => {
                  setContractInput(event.target.value);
                  setPromptError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submitContract();
                }}
                placeholder="0x… or Solana address"
              />
            </label>

            {promptError ? (
              <p style={{ margin: 0, color: 'var(--danger)', fontSize: '0.85rem' }}>{promptError}</p>
            ) : (
              <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
                EVM addresses are lowercased; Solana addresses keep their case.
              </p>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={submitContract}>
                Continue
              </button>
              <button type="button" className="btn btn-ghost" onClick={closeContractPrompt}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
