import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { PointerEvent } from 'react';
import * as THREE from 'three';
import type { BobbyState } from '../assistantState';
import {
  createCorePositions,
  createPortraitParticles,
  createProceduralPortrait,
} from './particleAvatarParticles';
import type { ParticleSource, PortraitMode } from './particleAvatarParticles';
import {
  PARTICLE_AVATAR_FRAGMENT_SHADER,
  PARTICLE_AVATAR_VERTEX_SHADER,
} from './particleAvatar.shaders';

interface ParticleAvatarProps {
  state: 'idle' | 'listening' | 'thinking' | 'speaking';
  audioLevel: number;
  mode: PortraitMode;
  caption?: string;
  audioLevelRef?: MutableRefObject<number>;
  onModeChange?: (mode: PortraitMode) => void;
}

interface ParticleCloudProps extends ParticleAvatarProps {
  pointer: MutableRefObject<THREE.Vector2>;
  reducedMotion: boolean;
}

const MODES: Array<{ value: PortraitMode; label: string }> = [
  { value: 'core', label: 'CORE' },
  { value: 'female', label: 'FEMALE' },
  { value: 'male', label: 'MALE' },
];

const STATE_LABELS: Record<ParticleAvatarProps['state'], string> = {
  idle: 'Ready',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
};

function particleCountForDevice(): number {
  const device = navigator as Navigator & { deviceMemory?: number };
  const cores = navigator.hardwareConcurrency || 8;
  if (cores <= 4 || (device.deviceMemory !== undefined && device.deviceMemory <= 4)) return 16_000;
  if (cores <= 8) return 26_000;
  return 34_000;
}

function makeParticleGeometry(
  portraits: { female: ParticleSource; male: ParticleSource },
  core: Float32Array,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(portraits.female.positions, 3));
  geometry.setAttribute('aFemale', new THREE.BufferAttribute(portraits.female.positions, 3));
  geometry.setAttribute('aMale', new THREE.BufferAttribute(portraits.male.positions, 3));
  geometry.setAttribute('aCore', new THREE.BufferAttribute(core, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(portraits.female.colors, 3));
  geometry.setAttribute('aMaleColor', new THREE.BufferAttribute(portraits.male.colors, 3));
  geometry.setAttribute('aUv', new THREE.BufferAttribute(portraits.female.uvs, 2));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(portraits.female.sizes, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(portraits.female.seeds, 1));
  geometry.setAttribute('aDust', new THREE.BufferAttribute(portraits.female.dust, 1));
  geometry.computeBoundingSphere();
  if (geometry.boundingSphere) geometry.boundingSphere.radius = 5;
  return geometry;
}

function modeIndex(mode: PortraitMode): number {
  if (mode === 'core') return 0;
  if (mode === 'female') return 1;
  return 2;
}

function ParticleCloud({
  state,
  audioLevel,
  mode,
  pointer,
  reducedMotion,
}: ParticleCloudProps) {
  const [particleData, setParticleData] = useState<{ female: ParticleSource; male: ParticleSource } | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const previousMode = useRef(mode);
  const { gl } = useThree();
  const count = useMemo(particleCountForDevice, []);
  const core = useMemo(() => createCorePositions(count), [count]);

  useEffect(() => {
    let active = true;
    const loadPortraits = async () => {
      const load = async (gender: 'female' | 'male'): Promise<ParticleSource> => {
        try {
          return await createPortraitParticles(`/avatars/${gender}.png`, count);
        } catch (error: unknown) {
          console.warn(
            `Bobby ${gender} portrait is unavailable; using the procedural particle silhouette.`,
            error,
          );
          return createProceduralPortrait(count, gender, gender === 'female' ? 3817 : 7429);
        }
      };
      const [female, male] = await Promise.all([load('female'), load('male')]);
      if (active) setParticleData({ female, male });
    };
    void loadPortraits();
    return () => {
      active = false;
    };
  }, [count]);

  const geometry = useMemo(
    () => particleData ? makeParticleGeometry(particleData, core) : null,
    [core, particleData],
  );
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAudioLevel: { value: 0 },
      uState: { value: 0 },
      uModeFrom: { value: modeIndex(mode) },
      uModeTo: { value: modeIndex(mode) },
      uMorphStart: { value: -2 },
      uReducedMotion: { value: 0 },
      uPixelRatio: { value: 1 },
      uPointer: { value: new THREE.Vector2() },
    }),
    [],
  );

  useEffect(() => {
    if (!geometry) return;
    return () => geometry.dispose();
  }, [geometry]);

  useEffect(() => {
    if (previousMode.current === mode) return;
    previousMode.current = mode;
    const material = materialRef.current;
    if (!material) return;
    material.uniforms.uModeFrom.value = material.uniforms.uModeTo.value;
    material.uniforms.uModeTo.value = modeIndex(mode);
    material.uniforms.uMorphStart.value = material.uniforms.uTime.value;
  }, [mode]);

  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;
    material.uniforms.uReducedMotion.value = reducedMotion ? 1 : 0;
    material.uniforms.uPixelRatio.value = gl.getPixelRatio();
  }, [gl, reducedMotion]);

  useFrame(({ clock }) => {
    const material = materialRef.current;
    if (!material) return;
    const stateValue = state === 'listening' ? 1 : state === 'thinking' ? 2 : state === 'speaking' ? 3 : 0;
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uAudioLevel.value = Math.max(0, Math.min(1, audioLevel));
    material.uniforms.uState.value = stateValue;
    material.uniforms.uPointer.value.lerp(pointer.current, reducedMotion ? 0.025 : 0.07);
  });

  if (!geometry) return null;

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={PARTICLE_AVATAR_VERTEX_SHADER}
        fragmentShader={PARTICLE_AVATAR_FRAGMENT_SHADER}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}

export function ParticleAvatar({
  state,
  audioLevel,
  mode,
  caption,
  onModeChange,
}: ParticleAvatarProps) {
  const pointer = useRef(new THREE.Vector2());
  const reducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');

  useEffect(() => {
    const onVisibilityChange = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    pointer.current.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      1 - ((event.clientY - bounds.top) / bounds.height) * 2,
    );
  };
  const handlePointerLeave = () => pointer.current.set(0, 0);

  return (
    <div className="particle-avatar">
      <div
        className="particle-avatar-stage"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        role="img"
        aria-label={`${mode} holographic particle avatar, ${STATE_LABELS[state]}`}
      >
        <div className="avatar-starfield" aria-hidden="true" />
        <div className="avatar-core-glow" aria-hidden="true" />
        <Canvas
            className="particle-avatar-canvas"
            camera={{ position: [0, 0, 3.2], fov: 40 }}
            dpr={[1, 2]}
            frameloop={visible ? 'always' : 'never'}
            gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
            onCreated={({ gl }) => {
              gl.setClearColor(0x000000, 0);
              gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            }}
          >
            <ParticleCloud
              state={state}
              audioLevel={audioLevel}
              mode={mode}
              pointer={pointer}
              reducedMotion={Boolean(reducedMotion)}
            />
        </Canvas>
        <div className={`particle-scan particle-scan-${state}`} aria-hidden="true" />
      </div>

      <div className="avatar-copy particle-avatar-copy">
        <motion.div
          className="voice-state-pill"
          layout
          transition={{ type: 'spring', stiffness: 330, damping: 27 }}
          style={{ transform: `scale(${1 + Math.max(0, Math.min(1, audioLevel)) * 0.035})` }}
        >
          <span className="state-equalizer" aria-hidden="true">
            <i /><i /><i /><i /><i />
          </span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.strong
              key={state}
              initial={reducedMotion ? false : { opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -5 }}
              transition={{ duration: reducedMotion ? 0 : 0.16 }}
            >
              {STATE_LABELS[state]}
            </motion.strong>
          </AnimatePresence>
        </motion.div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={caption}
            className="live-caption"
            dir="auto"
            initial={reducedMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: reducedMotion ? 0 : 0.2 }}
          >
            {caption || (state === 'listening' ? 'I’m here and listening…' : 'Your voice-first assistant is ready.')}
          </motion.p>
        </AnimatePresence>
      </div>

      <div className="avatar-mode-switcher" role="group" aria-label="Avatar style">
        {MODES.map((item) => (
          <button
            key={item.value}
            className={`avatar-mode-button ${mode === item.value ? 'mode-selected' : ''}`}
            type="button"
            onClick={() => onModeChange?.(item.value)}
            aria-pressed={mode === item.value}
          >
            {mode === item.value && (
              <motion.span
                className="avatar-mode-highlight"
                layoutId="avatar-mode-highlight"
                transition={{ type: 'spring', stiffness: 360, damping: 30 }}
              />
            )}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
