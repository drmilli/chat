import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson } from './api';

/**
 * WebRTC mesh voice chat for a token room.
 *
 * TOPOLOGY: a full mesh. Every participant holds an RTCPeerConnection to every
 * other one, so N participants means N(N-1)/2 connections and each browser
 * uploads its microphone N-1 times. That is fine at six and hopeless at twenty,
 * which is why the server caps the room — see services/backend/src/voice/rooms.js.
 * Audio never touches our server; only the offer/answer/candidate blobs do.
 *
 * GLARE: if both peers of a pair send an offer at the same moment the
 * negotiation collides and neither connects. Rather than implement full perfect
 * negotiation, a pair is given a deterministic initiator: THE LARGER PEER ID
 * OFFERS. Both sides compute it from ids they already have, with no round trip
 * and no race, so exactly one offer is ever created per pair.
 */

export type VoiceParticipant = {
  peerId: string;
  identityId: string;
  displayName: string | null;
  address: string | null;
  muted: boolean;
  /** Imposed by a moderator; unlike `muted`, the participant cannot lift it. */
  forcedMute?: boolean;
  joinedAt: number;
};

export type VoiceStatus = 'idle' | 'joining' | 'live' | 'error';

/** Enough to tell a connection fault from a playback fault. */
export type PeerDiagnostics = {
  connection: string;
  ice: string;
  bytesReceived: number;
  packetsReceived: number;
  /** 'relay' means the audio is flowing through TURN. */
  candidatePair: string | null;
  /** Whether the <audio> element for this peer is actually playing. */
  playing: boolean;
};

export type VoiceEvent =
  | { type: 'voice-peer-joined'; data: { participant: VoiceParticipant } }
  | { type: 'voice-peer-left'; data: { peerId: string; reason?: string } }
  | { type: 'voice-peer-updated'; data: { participant: VoiceParticipant; moderated?: boolean } }
  | { type: 'voice-peer-kicked'; data: { peerId: string; identityId: string; until: number } }
  | { type: 'voice-signal'; data: { from: string; signal: any } };

type JoinResponse = {
  participant: VoiceParticipant;
  peers: VoiceParticipant[];
  iceServers: RTCIceServer[];
  turnConfigured: boolean;
  maxParticipants: number;
  canModerate: boolean;
};

type UseVoiceLoungeOptions = {
  roomId: string;
  /** Server-issued, arrives on the SSE `ready` event. Null until the stream opens. */
  peerId: string | null;
  /** Only verified wallets may open a microphone (moderation, not revenue). */
  canJoin: boolean;
  /** Registers a listener for voice-* frames on the existing SSE stream. */
  subscribe: (handler: (event: VoiceEvent) => void) => () => void;
};

const HEARTBEAT_MS = 20000;
/** Below this the level meter reads as silence rather than as room noise. */
const SPEAKING_THRESHOLD = 0.06;

export function isVoiceSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof RTCPeerConnection !== 'undefined' &&
    Boolean(navigator?.mediaDevices?.getUserMedia)
  );
}

export function useVoiceLounge({ roomId, peerId, canJoin, subscribe }: UseVoiceLoungeOptions) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [turnConfigured, setTurnConfigured] = useState(true);
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});
  const [canModerate, setCanModerate] = useState(false);
  /** A browser refused to play remote audio until the user interacts. */
  const [audioBlocked, setAudioBlocked] = useState(false);
  /** remoteId -> RTCPeerConnectionState, so the UI can show a stalled peer. */
  const [peerStates, setPeerStates] = useState<Record<string, string>>({});
  const [diagnostics, setDiagnostics] = useState<Record<string, PeerDiagnostics>>({});
  /** Set when a moderator silenced us, so the unmute control stays disabled. */
  const [forcedMute, setForcedMute] = useState(false);

  const localStream = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<string, RTCPeerConnection>());
  /** Candidates that arrived before the remote description was set. */
  const pendingIce = useRef(new Map<string, RTCIceCandidateInit[]>());
  const audioEls = useRef(new Map<string, HTMLAudioElement>());
  const iceConfig = useRef<RTCIceServer[]>([]);
  const audioCtx = useRef<AudioContext | null>(null);
  /**
   * Peers this client refuses to connect to. THIS is where a kick is actually
   * enforced: the server cannot stop anyone transmitting, because audio never
   * passes through it. What it can do is tell every listener to stop listening,
   * and a listener needs no cooperation from the peer it is ignoring.
   */
  const refused = useRef(new Set<string>());
  const meters = useRef(new Map<string, { analyser: AnalyserNode; data: Uint8Array }>());
  const statusRef = useRef<VoiceStatus>('idle');
  // Read inside RTCPeerConnection callbacks, which close over the render they
  // were created in — a state value there would be permanently stale.
  const turnConfiguredRef = useRef(true);
  const peerIdRef = useRef<string | null>(peerId);
  // `leave` is defined below the SSE effect that needs it; a ref keeps the
  // effect out of a dependency cycle that would resubscribe on every render.
  const leaveRef = useRef<(() => Promise<void>) | null>(null);

  statusRef.current = status;
  peerIdRef.current = peerId;
  turnConfiguredRef.current = turnConfigured;

  const post = useCallback(
    <T,>(path: string, body: Record<string, unknown>): Promise<T> =>
      fetchJson<T>(`/api/rooms/${encodeURIComponent(roomId)}/voice/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    [roomId]
  );

  /** Tears down one peer connection and everything hanging off it. */
  const dropPeer = useCallback((id: string) => {
    peers.current.get(id)?.close();
    peers.current.delete(id);
    pendingIce.current.delete(id);
    meters.current.delete(id);

    const el = audioEls.current.get(id);
    if (el) {
      el.srcObject = null;
      el.remove();
      audioEls.current.delete(id);
    }
    setSpeaking((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  /**
   * Level meter for the LOCAL microphone only.
   *
   * ⚠️ NEVER CALL THIS WITH A REMOTE STREAM. Routing a remote WebRTC stream
   * through `createMediaStreamSource` is a long-standing Chrome problem: the
   * stream gets pulled into the Web Audio graph, and because the analyser is
   * not connected to `destination`, the <audio> element playing that same
   * stream goes SILENT. Everything looks connected and nobody can hear anyone —
   * which is exactly the bug this comment exists to stop coming back.
   *
   * Remote speaking levels come from getSynchronizationSources() instead (see
   * the polling effect below), which reports audioLevel without touching the
   * audio path at all.
   *
   * The local mic is safe here because it is never played back to ourselves.
   */
  const attachLocalMeter = useCallback((stream: MediaStream) => {
    try {
      audioCtx.current ||= new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.current.createMediaStreamSource(stream);
      const analyser = audioCtx.current.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      meters.current.set('local', { analyser, data: new Uint8Array(analyser.frequencyBinCount) });
    } catch {
      // A level meter is a nicety; never let it stop a call from connecting.
    }
  }, []);

  const createPeer = useCallback(
    (remoteId: string) => {
      const pc = new RTCPeerConnection({ iceServers: iceConfig.current });
      peers.current.set(remoteId, pc);

      localStream.current?.getTracks().forEach((track) => {
        pc.addTrack(track, localStream.current as MediaStream);
      });

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        post('signal', {
          peerId: peerIdRef.current,
          to: remoteId,
          signal: { type: 'candidate', candidate: event.candidate.toJSON() },
        }).catch(() => {
          /* the peer may have left mid-negotiation; the connection state handles it */
        });
      };

      pc.ontrack = (event) => {
        const [stream] = event.streams;
        if (!stream) return;

        let el = audioEls.current.get(remoteId);
        if (!el) {
          el = document.createElement('audio');
          el.autoplay = true;
          // Never render controls: this element exists only to play the stream.
          el.style.display = 'none';
          document.body.appendChild(el);
          audioEls.current.set(remoteId, el);
        }
        el.srcObject = stream;
        // A refused play() is the single most confusing failure in voice chat:
        // everything connects, the tiles look right, and there is simply no
        // sound. Swallowing it leaves the user with no way to know. Surface it
        // so the UI can offer the one thing that fixes it — a click.
        el.play?.().then(
          () => setAudioBlocked(false),
          () => setAudioBlocked(true)
        );
        // Deliberately NOT metered here — see attachLocalMeter.
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        setPeerStates((current) => ({ ...current, [remoteId]: state }));

        if (state === 'failed') {
          // Dropping this silently is what makes "nobody can hear anyone" look
          // like a bug with no cause: presence still lists the peer, so the UI
          // looks healthy while no audio flows. Name the likeliest reason.
          setError(
            turnConfiguredRef.current
              ? 'Could not establish a direct audio connection to one participant.'
              : 'Could not connect audio — no TURN relay is configured, and this network needs one.'
          );
          dropPeer(remoteId);
          return;
        }
        if (state === 'closed') dropPeer(remoteId);
      };

      return pc;
    },
    [dropPeer, post]
  );

  /**
   * Deterministic initiator: the larger peer id offers. Both sides compute the
   * same answer with no round trip, so a pair never both offer (SDP glare).
   */
  const shouldOffer = useCallback((remoteId: string) => {
    const me = peerIdRef.current;
    return Boolean(me && me > remoteId);
  }, []);

  const offerTo = useCallback(
    async (remoteId: string) => {
      const pc = peers.current.get(remoteId) || createPeer(remoteId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await post('signal', {
        peerId: peerIdRef.current,
        to: remoteId,
        signal: { type: 'offer', sdp: pc.localDescription?.sdp },
      });
    },
    [createPeer, post]
  );

  /** Applies candidates that arrived before we had a remote description. */
  const flushIce = useCallback(async (remoteId: string, pc: RTCPeerConnection) => {
    const queued = pendingIce.current.get(remoteId);
    if (!queued) return;
    pendingIce.current.delete(remoteId);
    for (const candidate of queued) {
      await pc.addIceCandidate(candidate).catch(() => {});
    }
  }, []);

  const handleSignal = useCallback(
    async (from: string, signal: any) => {
      if (signal.type === 'bye') return dropPeer(from);
      // A kicked peer may keep offering; refusing here is what makes the kick
      // stick without needing their cooperation.
      if (refused.current.has(from)) return;

      let pc = peers.current.get(from);

      if (signal.type === 'offer') {
        pc ||= createPeer(from);
        await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
        await flushIce(from, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await post('signal', {
          peerId: peerIdRef.current,
          to: from,
          signal: { type: 'answer', sdp: pc.localDescription?.sdp },
        });
        return;
      }

      if (!pc) return; // a signal for a connection we already tore down

      if (signal.type === 'answer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
        await flushIce(from, pc);
        return;
      }

      if (signal.type === 'candidate' && signal.candidate) {
        // Candidates routinely beat the description they belong to; queueing
        // rather than dropping them is the difference between a call that
        // connects and one that stalls in "checking".
        if (!pc.remoteDescription) {
          const queued = pendingIce.current.get(from) || [];
          queued.push(signal.candidate);
          pendingIce.current.set(from, queued);
          return;
        }
        await pc.addIceCandidate(signal.candidate).catch(() => {});
      }
    },
    [createPeer, dropPeer, flushIce, post]
  );

  const leave = useCallback(async () => {
    const me = peerIdRef.current;
    for (const id of [...peers.current.keys()]) dropPeer(id);
    localStream.current?.getTracks().forEach((track) => track.stop());
    localStream.current = null;
    meters.current.clear();
    setParticipants([]);
    setSpeaking({});
    setStatus('idle');
    setMuted(true);
    setForcedMute(false);
    setAudioBlocked(false);
    setPeerStates({});
    setDiagnostics({});
    refused.current.clear();
    if (me) await post('leave', { peerId: me }).catch(() => {});
  }, [dropPeer, post]);

  const join = useCallback(async () => {
    if (!peerIdRef.current) {
      setError('Still connecting to the room — try again in a moment.');
      return;
    }
    if (!isVoiceSupported()) {
      setError('This browser cannot do voice chat.');
      return;
    }

    setStatus('joining');
    setError(null);

    try {
      // Ask for the microphone BEFORE claiming a slot: a denied permission
      // should not leave an occupied slot in a six-person room.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      localStream.current = stream;
      // Join muted — an open microphone the user did not deliberately open is
      // a privacy failure, not a convenience.
      stream.getAudioTracks().forEach((track) => { track.enabled = false; });
      attachLocalMeter(stream);

      const result = await post<JoinResponse>('join', { peerId: peerIdRef.current });
      iceConfig.current = result.iceServers;
      setTurnConfigured(result.turnConfigured);
      setCanModerate(Boolean(result.canModerate));
      setParticipants([result.participant, ...result.peers]);
      setStatus('live');
      // Set imperatively as well as through state. Incoming signals are gated
      // on statusRef, which otherwise only updates on the next render — an
      // answer or ICE candidate arriving in that window would be dropped, and
      // the negotiation would never complete.
      statusRef.current = 'live';

      // Offer only to the peers this side is the initiator for; the others
      // will offer to us when they see our peer-joined event.
      for (const other of result.peers) {
        if (shouldOffer(other.peerId)) await offerTo(other.peerId).catch(() => {});
      }
    } catch (err: any) {
      localStream.current?.getTracks().forEach((track) => track.stop());
      localStream.current = null;
      setStatus('error');
      setError(describeJoinError(err));
    }
  }, [attachLocalMeter, offerTo, post, shouldOffer]);

  const toggleMute = useCallback(async () => {
    // A moderator's mute is not the participant's to lift.
    if (forcedMute && muted) return;
    const next = !muted;
    setMuted(next);
    localStream.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    // Mute is enforced locally on the track; telling the server is only so
    // other participants can render the icon.
    await post('mute', { peerId: peerIdRef.current, muted: next }).catch(() => {});
  }, [forcedMute, muted, post]);

  /**
   * Retries playback for every remote stream. Must be called from a real user
   * gesture — that gesture is the only thing that lifts an autoplay block, and
   * it is why the UI shows a button rather than retrying on a timer.
   */
  const enableAudio = useCallback(async () => {
    const results = await Promise.allSettled(
      [...audioEls.current.values()].map((el) => el.play())
    );
    if (results.every((r) => r.status === 'fulfilled')) {
      setAudioBlocked(false);
      setError(null);
    }
  }, []);

  /**
   * Moderator action against one participant. The server authorises it; this
   * only asks. Enforcement of the result happens on every listener's side —
   * see the `refused` set and the forced-mute handling above.
   */
  const moderate = useCallback(
    async (targetPeerId: string, action: 'mute' | 'unmute' | 'kick') => {
      await post('moderate', { peerId: targetPeerId, action });
    },
    [post]
  );

  // Route voice frames off the shared SSE stream.
  useEffect(() => {
    return subscribe((event) => {
      if (event.type === 'voice-peer-joined') {
        const { participant } = event.data;
        setParticipants((current) =>
          current.some((p) => p.peerId === participant.peerId) ? current : [...current, participant]
        );
        // Only the initiator side offers; the other waits.
        if (statusRef.current === 'live' && shouldOffer(participant.peerId)) {
          offerTo(participant.peerId).catch(() => {});
        }
        return;
      }

      if (event.type === 'voice-peer-left') {
        dropPeer(event.data.peerId);
        setParticipants((current) => current.filter((p) => p.peerId !== event.data.peerId));
        return;
      }

      if (event.type === 'voice-peer-updated') {
        const { participant } = event.data;
        setParticipants((current) =>
          current.map((p) => (p.peerId === participant.peerId ? participant : p))
        );

        // Enforce a moderator's mute HERE, on the receiving side. Asking the
        // offender's client to stop sending is advisory; silencing their audio
        // element locally is not.
        const el = audioEls.current.get(participant.peerId);
        if (el) el.muted = Boolean(participant.forcedMute);

        if (participant.peerId === peerIdRef.current) {
          setForcedMute(Boolean(participant.forcedMute));
          if (participant.forcedMute) {
            setMuted(true);
            localStream.current?.getAudioTracks().forEach((track) => { track.enabled = false; });
            setError('A moderator muted you.');
          }
        }
        return;
      }

      if (event.type === 'voice-peer-kicked') {
        const { peerId: kicked } = event.data;
        refused.current.add(kicked);
        dropPeer(kicked);
        setParticipants((current) => current.filter((p) => p.peerId !== kicked));
        if (kicked === peerIdRef.current) {
          leaveRef.current?.();
          setError('A moderator removed you from voice chat.');
        }
        return;
      }

      if (event.type === 'voice-signal' && statusRef.current === 'live') {
        handleSignal(event.data.from, event.data.signal).catch(() => {});
      }
    });
  }, [subscribe, dropPeer, handleSignal, offerTo, shouldOffer]);

  // Heartbeat keeps the slot; the server sweeps peers that stop reporting.
  useEffect(() => {
    if (status !== 'live') return;
    const timer = setInterval(() => {
      post('heartbeat', { peerId: peerIdRef.current }).catch(() => {});
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [status, post]);

  leaveRef.current = leave;

  // Speaking levels, polled rather than per-frame — this only drives an indicator.
  //
  // Local level comes from the analyser. REMOTE levels come from
  // getSynchronizationSources(), never from Web Audio: see attachLocalMeter for
  // why routing a remote stream through an AudioContext silences it.
  useEffect(() => {
    if (status !== 'live') return;
    const timer = setInterval(() => {
      const next: Record<string, boolean> = {};

      const local = meters.current.get('local');
      if (local) {
        local.analyser.getByteFrequencyData(local.data as any);
        let sum = 0;
        for (let i = 0; i < local.data.length; i += 1) sum += local.data[i];
        next.local = sum / local.data.length / 255 > SPEAKING_THRESHOLD;
      }

      for (const [remoteId, pc] of peers.current) {
        let level = 0;
        for (const receiver of pc.getReceivers()) {
          // audioLevel is 0..1 and is reported by the browser's own decoder,
          // so it costs nothing and cannot interfere with playback.
          for (const source of receiver.getSynchronizationSources?.() ?? []) {
            if (typeof source.audioLevel === 'number') level = Math.max(level, source.audioLevel);
          }
        }
        next[remoteId] = level > SPEAKING_THRESHOLD;
      }

      // The local tile should not light up while muted.
      if (muted) next.local = false;
      setSpeaking(next);
    }, 200);
    return () => clearInterval(timer);
  }, [status, muted]);

  /**
   * Diagnostics.
   *
   * `bytesReceived` splits the whole problem space in one number: above zero
   * means audio IS arriving and any silence is a PLAYBACK fault (autoplay, a
   * muted element, the Web Audio trap); zero means it never arrived and the
   * fault is in the CONNECTION (ICE, TURN, signalling). Without it, "no sound"
   * is unfalsifiable and every fix is a guess.
   */
  useEffect(() => {
    if (status !== 'live') return;

    const timer = setInterval(async () => {
      const next: Record<string, PeerDiagnostics> = {};

      for (const [remoteId, pc] of peers.current) {
        const entry: PeerDiagnostics = {
          connection: pc.connectionState,
          ice: pc.iceConnectionState,
          bytesReceived: 0,
          packetsReceived: 0,
          candidatePair: null,
          playing: false,
        };

        try {
          const stats = await pc.getStats();
          stats.forEach((report: any) => {
            if (report.type === 'inbound-rtp' && report.kind === 'audio') {
              entry.bytesReceived = report.bytesReceived ?? 0;
              entry.packetsReceived = report.packetsReceived ?? 0;
            }
            // 'relay' here means the audio is going through TURN.
            if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
              entry.candidatePair = report.localCandidateType ?? null;
            }
          });
        } catch {
          /* stats are best-effort */
        }

        const el = audioEls.current.get(remoteId);
        entry.playing = Boolean(el && !el.paused && !el.muted && el.readyState > 0);
        next[remoteId] = entry;
      }

      setDiagnostics(next);
    }, 2000);

    return () => clearInterval(timer);
  }, [status]);

  // A reconnect issues a NEW peer id, which orphans every connection negotiated
  // against the old one. Rejoining is the only way back to a working call.
  useEffect(() => {
    if (status !== 'live' || !peerId) return;
    const joined = participants.find((p) => peers.current.size >= 0 && p.peerId === peerId);
    if (joined) return;
    setError('Connection dropped — rejoin to continue talking.');
    leave().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerId]);

  // Never leave a microphone open on unmount.
  useEffect(() => () => {
    for (const id of [...peers.current.keys()]) dropPeer(id);
    localStream.current?.getTracks().forEach((track) => track.stop());
    audioCtx.current?.close().catch(() => {});
  }, [dropPeer]);

  const isFull = participants.length >= 6 && status !== 'live';

  return useMemo(
    () => ({
      status, participants, error, muted, forcedMute, speaking, turnConfigured, isFull, canJoin,
      canModerate, audioBlocked, peerStates, diagnostics,
      join, leave, toggleMute, moderate, enableAudio,
      supported: isVoiceSupported(),
      selfPeerId: peerId,
    }),
    [status, participants, error, muted, forcedMute, speaking, turnConfigured, isFull, canJoin,
     canModerate, audioBlocked, peerStates, diagnostics, join, leave, toggleMute, moderate, enableAudio, peerId]
  );
}

function describeJoinError(err: any): string {
  const name = err?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone access was blocked. Allow it in your browser settings to join.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone found.';
  }
  if (name === 'NotReadableError') {
    return 'Your microphone is in use by another app.';
  }
  if (err?.reason === 'room_full' || /full/i.test(err?.message || '')) {
    return 'This voice room is full. Wait for a slot to open up.';
  }
  if (err?.reason === 'voice_blocked' || /removed from voice/i.test(err?.message || '')) {
    return 'A moderator removed you from voice chat in this room.';
  }
  if (err?.reason === 'banned') {
    return 'You are banned from this room.';
  }
  if (err?.reason === 'wallet_required' || err?.status === 403) {
    return 'Connect and verify a wallet to join voice chat.';
  }
  return err?.message || 'Could not join voice chat.';
}
