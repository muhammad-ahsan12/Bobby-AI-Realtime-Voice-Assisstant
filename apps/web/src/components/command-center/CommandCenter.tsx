import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { MutableRefObject } from 'react';
import { Camera, CameraOff, Mic, MicOff, MonitorUp, PhoneOff, PanelRightClose, PanelRightOpen } from 'lucide-react';
import type { Room } from 'livekit-client';
import type { ActivityItem } from '../../lib/api';
import type { BobbyState } from '../assistantState';
import { AvatarPanel } from './AvatarPanel';
import { MediaPreview } from './MediaPreview';
import { ToolPanel } from './ToolPanel';
import { ToolExecutionHud } from './ToolExecutionHud';
import { TopBar } from './TopBar';

const NeuralGlobe = lazy(() =>
  import('../NeuralGlobe').then((module) => ({ default: module.NeuralGlobe })),
);

type FeedConnection = 'offline' | 'connecting' | 'connected' | 'reconnecting';

interface CommandCenterProps {
  events: ActivityItem[];
  state: BobbyState;
  connected: boolean;
  connecting: boolean;
  muted: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  room: Room | null;
  activityConnection: FeedConnection;
  errorMessage: string | null;
  agentUnavailable: boolean;
  audioLevelRef: MutableRefObject<number>;
  caption: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleScreen: () => void;
  onDismissError: () => void;
}

const STATE_CAPTIONS: Record<BobbyState, string> = {
  idle: 'Your AI assistant is standing by.',
  connecting: 'Establishing your private voice session…',
  listening: 'I’m listening. Go ahead.',
  thinking: 'Let me think that through…',
  speaking: 'Opening YouTube and playing the video…',
};

function isAssistantTranscript(event: ActivityItem): boolean {
  return !event.id.startsWith('demo-') &&
    event.type === 'transcript' &&
    event.data?.role === 'assistant';
}

export function CommandCenter({
  events,
  state,
  connected,
  connecting,
  muted,
  cameraEnabled,
  screenShareEnabled,
  room,
  activityConnection,
  errorMessage,
  agentUnavailable,
  audioLevelRef,
  caption,
  onConnect,
  onDisconnect,
  onToggleMute,
  onToggleCamera,
  onToggleScreen,
  onDismissError,
}: CommandCenterProps) {
  const [language, setLanguage] = useState('English');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const [waveLevel, setWaveLevel] = useState(0);
  const transcript = useMemo(
    () => events.find(isAssistantTranscript)?.data?.text,
    [events],
  );
  const currentCaption = caption || (typeof transcript === 'string' ? transcript : STATE_CAPTIONS[state]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setWaveLevel(Math.min(1, Math.max(0, audioLevelRef.current)));
    }, 40);
    return () => window.clearInterval(timer);
  }, [audioLevelRef]);

  return (
    <div className="command-center">
      <div className="ambient ambient-beam ambient-beam-one" aria-hidden="true" />
      <div className="ambient ambient-beam ambient-beam-two" aria-hidden="true" />
      <div className="ambient-particles" aria-hidden="true" />

      <motion.div
        className="command-top"
        initial={reducedMotion ? false : { opacity: 0, y: -18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: 'easeOut' }}
      >
        <TopBar
          connected={connected}
          connecting={connecting}
          agentUnavailable={agentUnavailable}
          language={language}
          onLanguageChange={setLanguage}
          onToggleDrawer={() => setDrawerOpen((open) => !open)}
          drawerOpen={drawerOpen}
        />
      </motion.div>

      <main className="command-layout">
        <motion.section
          className="avatar-column"
          aria-label="Voice assistant"
          initial={reducedMotion ? false : { opacity: 0, x: -18, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.08, ease: 'easeOut' }}
        >
          <AvatarPanel
            state={state}
            connected={connected}
            caption={currentCaption}
            audioLevelRef={audioLevelRef}
          />
          <div className={`voice-waveform ${connected ? 'wave-active' : ''}`} aria-hidden="true">
            {Array.from({ length: 42 }, (_, index) => {
              const normalized = (index / 41) * 2 - 1;
              const envelope = Math.max(0.13, 1 - normalized * normalized);
              const height = 7 + envelope * (11 + waveLevel * 29) * (0.32 + Math.abs(Math.sin(index * 2.73)) * 0.68);
              return <i key={index} style={{ height: `${height}px` }} />;
            })}
          </div>
          <div className="voice-controls">
            <button
              type="button"
              className={`control-button mic-control ${connected && !muted ? 'control-active' : ''}`}
              onClick={connected ? onToggleMute : onConnect}
              disabled={connecting}
              aria-label={connected ? muted ? 'Unmute microphone' : 'Mute microphone' : 'Start voice session'}
              title={connected ? muted ? 'Unmute microphone' : 'Mute microphone' : 'Start voice session'}
            >
              {connected && muted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
              <span>{connecting ? 'Connecting' : connected ? muted ? 'Unmute' : 'Mic' : 'Start'}</span>
            </button>
            <button
              type="button"
              className={`control-button ${cameraEnabled ? 'control-active' : ''}`}
              onClick={onToggleCamera}
              disabled={!connected}
              aria-label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
              title={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
            >
              {cameraEnabled ? <CameraOff aria-hidden="true" /> : <Camera aria-hidden="true" />}
              <span>Camera</span>
            </button>
            <button
              type="button"
              className={`control-button ${screenShareEnabled ? 'control-active' : ''}`}
              onClick={onToggleScreen}
              disabled={!connected}
              aria-label={screenShareEnabled ? 'Stop sharing screen' : 'Share screen'}
              title={screenShareEnabled ? 'Stop sharing screen' : 'Share screen'}
            >
              <MonitorUp aria-hidden="true" />
              <span>Screen</span>
            </button>
            <button
              type="button"
              className="control-button end-control"
              onClick={onDisconnect}
              disabled={!connected && !connecting}
              aria-label="End session"
              title="End session"
            >
              <PhoneOff aria-hidden="true" />
              <span>End</span>
            </button>
          </div>
        </motion.section>

        <motion.section
          className="globe-column"
          aria-label="Neural globe"
          initial={reducedMotion ? false : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.12, ease: 'easeOut' }}
        >
          <div className="globe-halo" aria-hidden="true" />
          <div className="globe-wrap">
            <Suspense fallback={<div className="globe-loading" aria-hidden="true" />}>
              <NeuralGlobe state={state} audioLevelRef={audioLevelRef} connected={connected} />
            </Suspense>
            <div className="orbit-label orbit-label-top">GLOBAL NEURAL NETWORK <span>● LIVE</span></div>
            <ToolExecutionHud events={events} />
            <div className="platform" aria-hidden="true">
              <i />
              <i />
              <i />
              <b />
            </div>
          </div>
          <div className="media-stack" aria-label="Active media previews">
            <AnimatePresence>
              {room && cameraEnabled && (
                <MediaPreview
                  key="camera"
                  room={room}
                  source="camera"
                  label="LIVE · CAMERA"
                  onStop={onToggleCamera}
                />
              )}
              {room && screenShareEnabled && (
                <MediaPreview
                  key="screen"
                  room={room}
                  source="screen"
                  label="SHARING SCREEN"
                  onStop={onToggleScreen}
                />
              )}
            </AnimatePresence>
          </div>
        </motion.section>

        <aside
          className={`tools-drawer ${drawerOpen ? 'drawer-open' : ''}`}
          aria-label="Tools and MCPs"
        >
          <div className="drawer-mobile-head">
            <strong>Connected tools</strong>
            <button type="button" className="drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Close tools panel">
              <PanelRightClose aria-hidden="true" />
            </button>
          </div>
          <ToolPanel
            events={events}
            activityConnection={activityConnection}
            room={room}
            screenShareEnabled={screenShareEnabled}
          />
        </aside>
      </main>

      <AnimatePresence>
        {errorMessage && (
          <motion.div
            className="command-toast"
            role="alert"
            initial={reducedMotion ? false : { opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: reducedMotion ? 0 : 0.22 }}
          >
            <span className="toast-indicator" />
            <span>{errorMessage}</span>
            <button type="button" onClick={onDismissError} aria-label="Dismiss notification">×</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
