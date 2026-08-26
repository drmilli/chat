import './styles.css';

export { ChatPage } from './ChatPage';
export { ChatHistory } from './ChatHistory';
export { ChatComposer } from './ChatComposer';
export { VoiceMessage } from './VoiceMessage';
export { useVoiceRecorder, isRecordingSupported, formatDuration } from './useVoiceRecorder';
export type { ChatMessage } from './ChatHistory';
export { avatarGradient, initials, senderColor, shortId, formatTime, dayLabel } from './identity';
export { apiUrl, fetchJson, resolveMediaUrl, ApiError, API_BASE } from './api';
export { ensureSession, signInWithWallet, fetchIdentity, clearSession, getToken } from './session';
export type { SessionIdentity } from './session';
export { readHostContext, postToHost, onHostMessage, WIDGET_PROTOCOL } from './embedBridge';
export { VoiceLounge } from './VoiceLounge';
export { useVoiceLounge, isVoiceSupported } from './useVoiceLounge';
export type { VoiceParticipant, VoiceStatus, VoiceEvent } from './useVoiceLounge';
