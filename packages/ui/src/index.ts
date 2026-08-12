import './styles.css';

export { ChatPage } from './ChatPage';
export { ChatHistory } from './ChatHistory';
export { ChatComposer } from './ChatComposer';
export { VoiceMessage } from './VoiceMessage';
export { useVoiceRecorder, isRecordingSupported, formatDuration } from './useVoiceRecorder';
export type { ChatMessage } from './ChatHistory';
export { avatarGradient, initials, senderColor, shortId, formatTime, dayLabel } from './identity';
export { apiUrl, resolveMediaUrl, API_BASE } from './api';
