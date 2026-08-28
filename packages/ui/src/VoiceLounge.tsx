import { avatarGradient, initials, shortId } from './identity';
import type { VoiceParticipant, VoiceStatus, PeerDiagnostics } from './useVoiceLounge';

type VoiceLoungeProps = {
  status: VoiceStatus;
  participants: VoiceParticipant[];
  speaking: Record<string, boolean>;
  muted: boolean;
  forcedMute: boolean;
  error: string | null;
  canModerate: boolean;
  audioBlocked: boolean;
  peerStates: Record<string, string>;
  diagnostics: Record<string, PeerDiagnostics>;
  isFull: boolean;
  canJoin: boolean;
  supported: boolean;
  turnConfigured: boolean;
  selfPeerId: string | null;
  maxParticipants?: number;
  onJoin: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
  onConnectWallet: () => void;
  onModerate: (peerId: string, action: 'mute' | 'unmute' | 'kick') => void;
  onEnableAudio: () => void;
};

export function VoiceLounge({
  status,
  participants,
  speaking,
  muted,
  forcedMute,
  error,
  canModerate,
  audioBlocked,
  peerStates,
  diagnostics,
  isFull,
  canJoin,
  supported,
  turnConfigured,
  selfPeerId,
  maxParticipants = 6,
  onJoin,
  onLeave,
  onToggleMute,
  onConnectWallet,
  onModerate,
  onEnableAudio,
}: VoiceLoungeProps) {
  // A browser with no WebRTC gets no control at all — better than a button that
  // cannot work.
  if (!supported) return null;

  const live = status === 'live';
  // Guests still see who is talking; that is what makes connecting worth it.
  const active = live || participants.length > 0;

  return (
    <div className={`voice-lounge${live ? ' is-live' : ''}`}>
      <div className="voice-lounge-row">
        <div className="voice-lounge-label">
          <span className={`voice-dot${active ? ' is-live' : ''}`} aria-hidden="true" />
          <span>{active ? 'Voice chat live' : 'Voice chat'}</span>
          <span className="voice-count">
            {participants.length}/{maxParticipants}
          </span>
        </div>

        <div className="voice-lounge-actions">
          {live ? (
            <>
              <button
                type="button"
                className={`voice-btn${muted ? '' : ' is-hot'}`}
                onClick={onToggleMute}
                aria-pressed={!muted}
                disabled={forcedMute}
                title={
                  forcedMute
                    ? 'A moderator muted you'
                    : muted
                      ? 'Unmute your microphone'
                      : 'Mute your microphone'
                }
              >
                {forcedMute ? 'Muted by mod' : muted ? 'Unmute' : 'Mute'}
              </button>
              <button type="button" className="voice-btn is-leave" onClick={onLeave}>
                Leave
              </button>
            </>
          ) : canJoin ? (
            <button
              type="button"
              className="voice-btn is-join"
              onClick={onJoin}
              disabled={status === 'joining' || isFull}
            >
              {status === 'joining' ? 'Joining…' : isFull ? 'Room full' : 'Join voice'}
            </button>
          ) : (
            <button type="button" className="voice-btn is-join" onClick={onConnectWallet}>
              Connect wallet to talk
            </button>
          )}
        </div>
      </div>

      {participants.length > 0 && (
        <ul className="voice-peers">
          {participants.map((participant) => {
            const isSelf = participant.peerId === selfPeerId;
            const name = participant.displayName || shortId(participant.address || participant.identityId);
            const isSpeaking = speaking[isSelf ? 'local' : participant.peerId];
            // A peer whose connection never completed is listed by the server
            // but inaudible. Showing the state is the difference between
            // "voice chat is broken" and "this one person did not connect".
            const connection = isSelf ? null : peerStates[participant.peerId];
            const connecting = connection === 'connecting' || connection === 'new';
            return (
              <li
                key={participant.peerId}
                className={`voice-peer${isSpeaking ? ' is-speaking' : ''}`}
                title={participant.muted ? `${name} (muted)` : name}
              >
                <span
                  className="voice-avatar"
                  style={{ background: avatarGradient(participant.identityId) }}
                  aria-hidden="true"
                >
                  {initials(name)}
                </span>
                <span className="voice-peer-name">{isSelf ? 'You' : name}</span>
                {connecting && (
                  <span className="voice-muted-icon" aria-label="connecting">
                    connecting…
                  </span>
                )}
                {participant.muted && (
                  <span className="voice-muted-icon" aria-label={participant.forcedMute ? 'muted by a moderator' : 'muted'}>
                    {participant.forcedMute ? 'mod-muted' : 'muted'}
                  </span>
                )}

                {canModerate && !isSelf && (
                  <span className="voice-mod-actions">
                    <button
                      type="button"
                      className="voice-mod-btn"
                      onClick={() => onModerate(participant.peerId, participant.forcedMute ? 'unmute' : 'mute')}
                      title={participant.forcedMute ? `Let ${name} speak again` : `Mute ${name} for everyone`}
                    >
                      {participant.forcedMute ? '🔈' : '🔇'}
                    </button>
                    <button
                      type="button"
                      className="voice-mod-btn is-kick"
                      onClick={() => onModerate(participant.peerId, 'kick')}
                      title={`Remove ${name} from voice chat`}
                    >
                      ✕
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {live && Object.keys(diagnostics).length > 0 && (
        <details className="voice-diag">
          <summary>Audio diagnostics</summary>
          <table>
            <tbody>
              {Object.entries(diagnostics).map(([peerId, d]) => {
                // The one number that matters: bytes arriving means the
                // connection is fine and any silence is a playback fault;
                // zero means the audio never got here at all.
                const arriving = d.bytesReceived > 0;
                return (
                  <tr key={peerId}>
                    <td className="mono">{peerId.slice(0, 6)}</td>
                    <td>{d.connection}/{d.ice}</td>
                    <td className={arriving ? 'ok' : 'bad'}>
                      {arriving ? `${Math.round(d.bytesReceived / 1024)} KB in` : 'no audio received'}
                    </td>
                    <td className={d.playing ? 'ok' : 'bad'}>
                      {d.playing ? 'playing' : 'not playing'}
                    </td>
                    <td>{d.candidatePair === 'relay' ? 'via TURN' : d.candidatePair || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="voice-diag-hint">
            Bytes arriving but not playing means a playback problem. No bytes means the
            connection never carried audio.
          </p>
        </details>
      )}

      {audioBlocked && (
        <button type="button" className="voice-btn is-join voice-unblock" onClick={onEnableAudio}>
          🔊 Click to enable audio
        </button>
      )}

      {error && <p className="voice-error">{error}</p>}

      {live && !turnConfigured && (
        // Said plainly rather than left to look like a bug: with no relay a
        // predictable slice of participants cannot connect at all.
        <p className="voice-note">No relay server is configured — some people may not be able to connect.</p>
      )}
    </div>
  );
}
