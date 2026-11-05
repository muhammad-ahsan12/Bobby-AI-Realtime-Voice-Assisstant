import { useEffect, useRef } from 'react';
import {
  useLocalParticipant,
  useTrackVolume,
  useVoiceAssistant,
} from '@livekit/components-react';
import { LocalAudioTrack } from 'livekit-client';
import type { MutableRefObject } from 'react';
import type { BobbyState } from './assistantState';

interface LiveKitVoiceHandlerProps {
  onStateChange: (state: BobbyState) => void;
  onTranscriptsChange: (user: string, bobby: string) => void;
  micAudioLevelRef: MutableRefObject<number>;
  agentAudioLevelRef: MutableRefObject<number>;
  isMuted: boolean;
}

export function LiveKitVoiceHandler({
  onStateChange,
  onTranscriptsChange,
  micAudioLevelRef,
  agentAudioLevelRef,
  isMuted,
}: LiveKitVoiceHandlerProps) {
  const voiceAssistant = useVoiceAssistant();
  const { localParticipant, microphoneTrack } = useLocalParticipant();
  const agentVolume = useTrackVolume(voiceAssistant.audioTrack);
  const localMicTrack = microphoneTrack?.track;
  const micVolume = useTrackVolume(
    localMicTrack instanceof LocalAudioTrack ? localMicTrack : undefined,
  );
  const smoothedAgentVolume = useRef(0);
  const smoothedMicVolume = useRef(0);

  useEffect(() => {
    void localParticipant.setMicrophoneEnabled(!isMuted).catch((error: unknown) => {
      console.error('Could not synchronize microphone state:', error);
    });
  }, [isMuted, localParticipant]);

  useEffect(() => {
    let mappedState: BobbyState;
    switch (voiceAssistant.state) {
      case 'initializing':
      case 'connecting':
      case 'pre-connect-buffering':
        mappedState = 'connecting';
        break;
      case 'listening':
        mappedState = 'listening';
        break;
      case 'thinking':
        mappedState = 'thinking';
        break;
      case 'speaking':
        mappedState = 'speaking';
        break;
      case 'idle':
      case 'disconnected':
      case 'failed':
        mappedState = 'idle';
        break;
    }
    onStateChange(mappedState);
  }, [onStateChange, voiceAssistant.state]);

  useEffect(() => {
    smoothedMicVolume.current =
      smoothedMicVolume.current * 0.72 + (isMuted ? 0 : micVolume) * 0.28;
    smoothedAgentVolume.current = smoothedAgentVolume.current * 0.72 + agentVolume * 0.28;
    micAudioLevelRef.current = smoothedMicVolume.current;
    agentAudioLevelRef.current = smoothedAgentVolume.current;
  }, [
    agentAudioLevelRef,
    agentVolume,
    isMuted,
    micAudioLevelRef,
    micVolume,
  ]);

  useEffect(() => {
    const text = voiceAssistant.agentTranscriptions
      .slice(-4)
      .map((segment) => segment.text)
      .join(' ')
      .trim();
    if (text) onTranscriptsChange('', text);
  }, [onTranscriptsChange, voiceAssistant.agentTranscriptions]);

  return null;
}

export default LiveKitVoiceHandler;
