import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDuration } from './useVoiceRecorder';

const BAR_COUNT = 32;

/**
 * Bar heights are derived from the message id, not from the audio itself —
 * they are a consistent visual placeholder, not a real waveform. The filled
 * portion, however, tracks real playback position.
 */
function bars(seed: number): number[] {
  const out: number[] = [];
  let value = seed || 1;
  for (let i = 0; i < BAR_COUNT; i += 1) {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    out.push(0.25 + ((value >> 8) % 100) / 133);
  }
  return out;
}

export function VoiceMessage({
  messageId,
  src,
  durationMs,
  own,
}: {
  messageId: number;
  src: string;
  durationMs?: number | null;
  own?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [total, setTotal] = useState((durationMs || 0) / 1000);
  const [error, setError] = useState(false);

  const shape = useMemo(() => bars(messageId), [messageId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    function onTime() {
      setPosition(audio!.currentTime);
    }
    function onMeta() {
      // WebM from MediaRecorder often reports Infinity, so the stored duration wins.
      if (Number.isFinite(audio!.duration) && audio!.duration > 0) setTotal(audio!.duration);
    }
    function onEnd() {
      setPlaying(false);
      setPosition(0);
      audio!.currentTime = 0;
    }
    function onError() {
      setError(true);
      setPlaying(false);
    }

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('error', onError);
    };
  }, []);

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    try {
      await audio.play();
      setPlaying(true);
    } catch (err) {
      setError(true);
    }
  }

  function seek(event: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !total) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * total;
    setPosition(audio.currentTime);
  }

  const progress = total > 0 ? Math.min(1, position / total) : 0;
  const remaining = total > 0 ? Math.max(0, total - position) : (durationMs || 0) / 1000;

  return (
    <div className={`voice${own ? ' own' : ''}`}>
      <audio ref={audioRef} src={src} preload="metadata" />

      <button
        type="button"
        className="voice-play"
        onClick={toggle}
        disabled={error}
        title={error ? 'Audio unavailable' : playing ? 'Pause' : 'Play'}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
      >
        {error ? '!' : playing ? '❚❚' : '▶'}
      </button>

      <div className="voice-track" onClick={seek} role="presentation">
        {shape.map((height, index) => (
          <span
            key={index}
            className={`voice-bar${index / BAR_COUNT <= progress ? ' played' : ''}`}
            style={{ height: `${Math.round(height * 100)}%` }}
          />
        ))}
      </div>

      <span className="voice-time">
        {error ? 'unavailable' : formatDuration((playing || position > 0 ? remaining : total || 0) * 1000)}
      </span>
    </div>
  );
}
