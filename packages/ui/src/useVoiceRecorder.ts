import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'error';

export type Recording = {
  blob: Blob;
  mimeType: string;
  durationMs: number;
};

// Ordered by preference. Chrome/Firefox give Opus in WebM; Safari only does mp4.
const PREFERRED_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported?.(type));
}

export function isRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined'
  );
}

/**
 * Microphone capture for voice messages. Owns the MediaRecorder, the elapsed
 * timer and a live input level, and guarantees the mic track is released on
 * every exit path so the browser's recording indicator does not linger.
 */
export function useVoiceRecorder() {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const cancelledRef = useRef(false);

  const teardown = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    timerRef.current = null;
    rafRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;

    recorderRef.current = null;
    setLevel(0);
  }, []);

  // Releasing the mic matters even if the component unmounts mid-recording.
  useEffect(() => teardown, [teardown]);

  const start = useCallback(async () => {
    if (!isRecordingSupported()) {
      setStatus('error');
      setError('Voice recording is not supported in this browser.');
      return false;
    }

    setStatus('requesting');
    setError(null);
    cancelledRef.current = false;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err: any) {
      setStatus('error');
      setError(
        err?.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow it in your browser settings to send voice messages.'
          : err?.name === 'NotFoundError'
            ? 'No microphone found.'
            : err?.message || 'Could not start recording.'
      );
      return false;
    }

    streamRef.current = stream;
    chunksRef.current = [];

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.start(250);

    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setStatus('recording');
    timerRef.current = window.setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 100);

    // Live input level, so the user can see the mic is actually picking up sound.
    try {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      const context = new AudioContextCtor();
      audioContextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const buffer = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i += 1) {
          const deviation = (buffer[i] - 128) / 128;
          sum += deviation * deviation;
        }
        setLevel(Math.min(1, Math.sqrt(sum / buffer.length) * 3.2));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      // Metering is cosmetic — recording continues without it.
    }

    return true;
  }, []);

  const stop = useCallback(async (): Promise<Recording | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      teardown();
      setStatus('idle');
      return null;
    }

    const durationMs = Date.now() - startedAtRef.current;
    const mimeType = recorder.mimeType || 'audio/webm';

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: mimeType }));
      recorder.stop();
    });

    teardown();
    setStatus('idle');
    setElapsedMs(0);

    if (cancelledRef.current || blob.size === 0) return null;
    return { blob, mimeType, durationMs };
  }, [teardown]);

  const cancel = useCallback(async () => {
    cancelledRef.current = true;
    await stop();
  }, [stop]);

  const clearError = useCallback(() => {
    setError(null);
    setStatus('idle');
  }, []);

  return { status, elapsedMs, level, error, start, stop, cancel, clearError };
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
