import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { getToken } from '../lib/api';
import type { BobbyState } from '../components/assistantState';

export type BobbyStatus = 'offline' | 'connecting' | 'connected' | 'error';

export interface BobbySession {
  status: BobbyStatus;
  agentState: BobbyState;
  state: BobbyState;
  room: Room | null;
  isConnected: boolean;
  isConnecting: boolean;
  isMuted: boolean;
  isSharingScreen: boolean;
  isCameraEnabled: boolean;
  micVolume: number;
  agentVolume: number;
  audioVolume: number;
  frequencyData: number[];
  errorMessage: string | null;
  isSimulated: boolean;
  userTranscript: string;
  bobbyTranscript: string;
  connect: (withMicrophone?: boolean) => Promise<void>;
  sendTextMessage: (text: string) => Promise<boolean>;
  disconnect: () => void;
  toggleMute: () => void;
  toggleScreenShare: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  dismissError: () => void;
  toggleSimulation: () => void;
  setAgentState: (state: BobbyState) => void;
  setAgentVolume: (volume: number) => void;
  setMicVolume: (volume: number) => void;
  setTranscripts: (user: string, bobby: string) => void;
}

function stopRoomTracks(room: Room): void {
  room.localParticipant.getTrackPublications().forEach((publication) => publication.track?.stop());
}

export function useBobby(): BobbySession {
  const [status, setStatus] = useState<BobbyStatus>('offline');
  const [agentState, setAgentStateValue] = useState<BobbyState>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);
  const [micVolume, setMicVolumeValue] = useState(0);
  const [agentVolume, setAgentVolumeValue] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSimulated, setIsSimulated] = useState(false);
  const [simulatedState, setSimulatedState] = useState<BobbyState>('idle');
  const [userTranscript, setUserTranscript] = useState('');
  const [bobbyTranscript, setBobbyTranscript] = useState('');
  const [room, setRoom] = useState<Room | null>(null);

  const roomRef = useRef<Room | null>(null);
  const statusRef = useRef<BobbyStatus>('offline');
  const attemptRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);
  const manualDisconnectRef = useRef(false);
  const mutedRef = useRef(false);

  const updateStatus = useCallback((nextStatus: BobbyStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  const setMicVolume = useCallback((volume: number) => {
    setMicVolumeValue(Math.max(0, Math.min(1, volume)));
  }, []);

  const setAgentVolume = useCallback((volume: number) => {
    setAgentVolumeValue(Math.max(0, Math.min(1, volume)));
  }, []);

  const connect = useCallback(async (withMicrophone = true) => {
    if (statusRef.current === 'connecting' || statusRef.current === 'connected') return;

    setErrorMessage(null);
    setIsSimulated(false);
    setAgentStateValue('connecting');
    mutedRef.current = !withMicrophone;
    setIsMuted(!withMicrophone);
    updateStatus('connecting');
    manualDisconnectRef.current = false;

    const attempt = ++attemptRef.current;
    const nextRoom = new Room();
    roomRef.current = nextRoom;
    setRoom(nextRoom);
    const isCurrentAttempt = () => attemptRef.current === attempt && roomRef.current === nextRoom;

    nextRoom.on(RoomEvent.LocalTrackPublished, (publication) => {
      if (publication.source === Track.Source.ScreenShare) setIsSharingScreen(true);
      if (publication.source === Track.Source.Camera) setIsCameraEnabled(true);
    });
    nextRoom.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      if (publication.source === Track.Source.ScreenShare) setIsSharingScreen(false);
      if (publication.source === Track.Source.Camera) setIsCameraEnabled(false);
    });
    nextRoom.on(RoomEvent.Disconnected, () => {
      if (roomRef.current !== nextRoom) return;
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      stopRoomTracks(nextRoom);
      roomRef.current = null;
      setRoom(null);
      setIsSharingScreen(false);
      setIsCameraEnabled(false);
      setAgentStateValue('idle');
      updateStatus(manualDisconnectRef.current ? 'offline' : 'error');
      if (!manualDisconnectRef.current) {
        setErrorMessage('The Bobby session ended unexpectedly. Please reconnect.');
      }
    });

    timeoutRef.current = window.setTimeout(() => {
      if (!isCurrentAttempt()) return;
      manualDisconnectRef.current = true;
      roomRef.current = null;
      setRoom(null);
      stopRoomTracks(nextRoom);
      void nextRoom.disconnect();
      updateStatus('error');
      setAgentStateValue('idle');
      setErrorMessage('Connecting to Bobby timed out after 15 seconds. Please try again.');
    }, 15000);

    try {
      const { token, url } = await getToken();
      if (!isCurrentAttempt()) return;

      await nextRoom.connect(url, token);
      if (!isCurrentAttempt()) {
        stopRoomTracks(nextRoom);
        void nextRoom.disconnect();
        return;
      }

      await nextRoom.localParticipant.setMicrophoneEnabled(withMicrophone && !mutedRef.current);
      if (!isCurrentAttempt()) {
        stopRoomTracks(nextRoom);
        void nextRoom.disconnect();
        return;
      }

      await nextRoom.startAudio();
      if (!isCurrentAttempt()) {
        stopRoomTracks(nextRoom);
        void nextRoom.disconnect();
        return;
      }

      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      updateStatus('connected');
      setUserTranscript('Connected to Bobby. Start speaking...');
    } catch (error: unknown) {
      if (!isCurrentAttempt()) return;
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      const microphoneDenied =
        error instanceof DOMException &&
        (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError');
      setErrorMessage(
        microphoneDenied
          ? 'Microphone permission was denied. Allow microphone access in your browser and try again.'
          : error instanceof Error
            ? error.message
            : 'LiveKit connection failed. Please try again.',
      );
      manualDisconnectRef.current = true;
      roomRef.current = null;
      setRoom(null);
      stopRoomTracks(nextRoom);
      setAgentStateValue('idle');
      updateStatus('error');
      void nextRoom.disconnect();
    }
  }, [updateStatus]);

  const sendTextMessage = useCallback(async (text: string): Promise<boolean> => {
    const message = text.trim();
    if (!message) return false;
    if (message.length > 1000) {
      setErrorMessage('Messages must be 1,000 characters or fewer.');
      return false;
    }

    if (statusRef.current !== 'connected') {
      await connect(false);
    }
    const activeRoom = roomRef.current;
    if (!activeRoom || statusRef.current !== 'connected') return false;

    try {
      await activeRoom.localParticipant.sendText(message, { topic: 'lk.chat' });
      return true;
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? `Could not send your message: ${error.message}` : 'Could not send your message.',
      );
      return false;
    }
  }, [connect]);

  const disconnect = useCallback(() => {
    attemptRef.current += 1;
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    manualDisconnectRef.current = true;
    const activeRoom = roomRef.current;
    roomRef.current = null;
    setRoom(null);
    setIsSharingScreen(false);
    setIsCameraEnabled(false);
    if (activeRoom) {
      stopRoomTracks(activeRoom);
      void activeRoom.disconnect();
    }
    updateStatus('offline');
    setAgentStateValue('idle');
    setMicVolume(0);
    setAgentVolume(0);
    setUserTranscript('');
    setBobbyTranscript('');
  }, [setAgentVolume, setMicVolume, updateStatus]);

  const toggleMute = useCallback(() => {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    setIsMuted(nextMuted);
    const activeRoom = roomRef.current;
    if (activeRoom) {
      void activeRoom.localParticipant.setMicrophoneEnabled(!nextMuted).catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : 'Could not change microphone state.');
      });
    }
  }, []);

  const toggleScreenShare = useCallback(async () => {
    const activeRoom = roomRef.current;
    if (!activeRoom || statusRef.current !== 'connected') return;

    try {
      await activeRoom.localParticipant.setScreenShareEnabled(
        !activeRoom.localParticipant.isScreenShareEnabled,
        {
          audio: false,
          video: { displaySurface: 'monitor' },
          selfBrowserSurface: 'include',
          surfaceSwitching: 'include',
          contentHint: 'detail',
        },
      );
      if (roomRef.current === activeRoom) {
        setIsSharingScreen(activeRoom.localParticipant.isScreenShareEnabled);
      }
    } catch (error: unknown) {
      if (roomRef.current !== activeRoom) return;
      const errorName = error instanceof Error ? error.name : '';
      setErrorMessage(
        errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError'
          ? 'Screen sharing was canceled or denied. Choose a screen in the browser prompt to share it with Bobby.'
          : error instanceof Error
            ? `Could not change screen sharing: ${error.message}`
            : 'Could not change screen sharing.',
      );
    }
  }, []);

  const toggleCamera = useCallback(async () => {
    const activeRoom = roomRef.current;
    if (!activeRoom || statusRef.current !== 'connected') return;

    try {
      await activeRoom.localParticipant.setCameraEnabled(
        !activeRoom.localParticipant.isCameraEnabled,
      );
      if (roomRef.current === activeRoom) {
        setIsCameraEnabled(activeRoom.localParticipant.isCameraEnabled);
      }
    } catch (error: unknown) {
      if (roomRef.current !== activeRoom) return;
      const errorName = error instanceof Error ? error.name : '';
      setErrorMessage(
        errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError'
          ? 'Camera access was canceled or denied. Allow camera access in your browser and try again.'
          : error instanceof Error
            ? `Could not change camera: ${error.message}`
            : 'Could not change camera.',
      );
    }
  }, []);

  const dismissError = useCallback(() => setErrorMessage(null), []);

  const toggleSimulation = useCallback(() => {
    if (statusRef.current === 'connected' || statusRef.current === 'connecting') return;
    setIsSimulated((previous) => !previous);
    setSimulatedState('idle');
    setErrorMessage(null);
  }, []);

  const setAgentState = useCallback(
    (nextState: BobbyState) => {
      if (statusRef.current === 'connected') {
        setAgentStateValue(nextState);
      } else if (isSimulated && statusRef.current !== 'connecting') {
        setSimulatedState(nextState);
      }
    },
    [isSimulated],
  );

  const setTranscripts = useCallback((user: string, bobby: string) => {
    if (user) setUserTranscript(user);
    if (bobby) setBobbyTranscript(bobby);
  }, []);

  useEffect(() => {
    const closeActiveRoom = () => {
      attemptRef.current += 1;
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      const activeRoom = roomRef.current;
      if (!activeRoom) return;
      roomRef.current = null;
      stopRoomTracks(activeRoom);
      void activeRoom.disconnect();
    };

    window.addEventListener('pagehide', closeActiveRoom);
    return () => {
      window.removeEventListener('pagehide', closeActiveRoom);
      closeActiveRoom();
    };
  }, []);

  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';
  const state = isSimulated && !isConnected ? simulatedState : agentState;
  const audioVolume = state === 'speaking' ? agentVolume : state === 'listening' ? micVolume : 0;
  const frequencyData = Array.from({ length: 16 }, (_, index) => {
    const vocalEnvelope = Math.sin((index / 15) * Math.PI);
    return Math.max(0, Math.min(1, audioVolume * (0.55 + vocalEnvelope * 0.45)));
  });

  return {
    status,
    agentState,
    state,
    room,
    isConnected,
    isConnecting,
    isMuted,
    isSharingScreen,
    isCameraEnabled,
    micVolume,
    agentVolume,
    audioVolume,
    frequencyData,
    errorMessage,
    isSimulated,
    userTranscript,
    bobbyTranscript,
    connect,
    sendTextMessage,
    disconnect,
    toggleMute,
    toggleScreenShare,
    toggleCamera,
    dismissError,
    toggleSimulation,
    setAgentState,
    setAgentVolume,
    setMicVolume,
    setTranscripts,
  };
}
