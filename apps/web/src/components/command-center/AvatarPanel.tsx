import { useEffect, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { BobbyState } from '../assistantState';
import { ParticleAvatar } from './ParticleAvatar';
import type { PortraitMode } from './particleAvatarParticles';

interface AvatarPanelProps {
  state: BobbyState;
  connected: boolean;
  caption: string;
  audioLevelRef: MutableRefObject<number>;
}

function useAudioLevel(audioLevelRef: MutableRefObject<number>): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = Math.min(1, Math.max(0, audioLevelRef.current));
      setLevel((previous) => previous * 0.35 + next * 0.65);
    }, 40);
    return () => window.clearInterval(timer);
  }, [audioLevelRef]);
  return level;
}

export function AvatarPanel({ state, connected, caption, audioLevelRef }: AvatarPanelProps) {
  const [mode, setMode] = useState<PortraitMode>('female');
  const audioLevel = useAudioLevel(audioLevelRef);
  const activeState = connected ? state : state === 'idle' ? 'idle' : state;
  const particleState = activeState === 'connecting' ? 'idle' : activeState;

  return (
    <section className={`avatar-card glass-panel state-${activeState}`} aria-label="Bobby voice status">
      <div className="avatar-corners" aria-hidden="true"><i /><i /><i /><i /></div>
      <ParticleAvatar
        state={particleState}
        audioLevel={audioLevel}
        mode={mode}
        caption={caption || undefined}
        onModeChange={setMode}
      />
    </section>
  );
}
