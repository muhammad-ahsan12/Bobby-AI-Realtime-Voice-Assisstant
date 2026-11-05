import { useMemo, useRef, useState } from 'react';
import { RoomAudioRenderer, RoomContext } from '@livekit/components-react';
import { useActivityFeed } from './hooks/useActivityFeed';
import { LiveKitVoiceHandler } from './components/LiveKitVoiceHandler';
import { useBobby } from './hooks/useBobby';
import { useDemoEvents } from './hooks/useDemoEvents';
import { CommandCenter } from './components/command-center/CommandCenter';
import type { BobbyState } from './components/assistantState';

export default function App() {
  const bobby = useBobby();
  const activity = useActivityFeed();
  const demo = useDemoEvents(activity.connection !== 'connected');
  const micAudioLevelRef = useRef(0);
  const agentAudioLevelRef = useRef(0);
  const [dismissedSessionFailureId, setDismissedSessionFailureId] = useState<string | null>(null);

  const events = activity.connection === 'connected' || activity.events.length > 0
    ? activity.events
    : demo.events;
  const latestRoomSessionEvent = events.find(
    (event) =>
      !event.id.startsWith('demo-') &&
      event.type === 'session' &&
      event.data?.session_id === bobby.room?.name &&
      ['connecting', 'started', 'failed'].includes(String(event.data?.status)),
  );
  const agentUnavailable = latestRoomSessionEvent?.data?.status === 'failed';
  const sessionFailureMessage =
    agentUnavailable && latestRoomSessionEvent.id !== dismissedSessionFailureId
      ? latestRoomSessionEvent.message ||
        'Bobby could not start the voice session. Check the agent logs, then reconnect.'
      : null;
  const latestAgentState = useMemo(
    () => events.find((event) => event.type === 'agent_state')?.data?.state,
    [events],
  );
  const isBobbyState = (value: unknown): value is BobbyState =>
    value === 'idle' ||
    value === 'connecting' ||
    value === 'listening' ||
    value === 'thinking' ||
    value === 'speaking';
  const state = bobby.isConnected || bobby.isConnecting
    ? bobby.state
    : isBobbyState(latestAgentState)
      ? latestAgentState
      : bobby.state;
  const latestCaption = events.find(
    (event) =>
      !event.id.startsWith('demo-') &&
      event.type === 'transcript' &&
      event.data?.role === 'assistant' &&
      typeof event.data.text === 'string' &&
      event.data.text.trim().length > 0,
  )?.data?.text;
  const visualAudioLevelRef = state === 'speaking' ? agentAudioLevelRef : micAudioLevelRef;

  const commandCenter = (
    <CommandCenter
      events={events}
      state={state}
      connected={bobby.isConnected}
      connecting={bobby.isConnecting}
      muted={bobby.isMuted}
      cameraEnabled={bobby.isCameraEnabled}
      screenShareEnabled={bobby.isSharingScreen}
      room={bobby.room}
      activityConnection={activity.connection}
      errorMessage={bobby.errorMessage ?? sessionFailureMessage}
      agentUnavailable={agentUnavailable}
      audioLevelRef={visualAudioLevelRef}
      caption={bobby.bobbyTranscript || latestCaption || ''}
      onConnect={() => void bobby.connect()}
      onDisconnect={bobby.disconnect}
      onToggleMute={bobby.toggleMute}
      onToggleCamera={() => void bobby.toggleCamera()}
      onToggleScreen={() => void bobby.toggleScreenShare()}
      onDismissError={() => {
        bobby.dismissError();
        activity.dismissError();
        if (agentUnavailable && latestRoomSessionEvent) {
          setDismissedSessionFailureId(latestRoomSessionEvent.id);
        }
      }}
    />
  );

  if (!bobby.room || !bobby.isConnected) return commandCenter;

  return (
    <RoomContext.Provider value={bobby.room}>
      {commandCenter}
      <LiveKitVoiceHandler
        onStateChange={bobby.setAgentState}
        micAudioLevelRef={micAudioLevelRef}
        agentAudioLevelRef={agentAudioLevelRef}
        isMuted={bobby.isMuted}
        onTranscriptsChange={bobby.setTranscripts}
      />
      <RoomAudioRenderer room={bobby.room} />
    </RoomContext.Provider>
  );
}
