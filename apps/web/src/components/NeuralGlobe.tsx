import { useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { AdaptiveDpr } from '@react-three/drei';
import * as THREE from 'three';
import type { BobbyState } from './assistantState';

interface NeuralGlobeProps {
  state: BobbyState;
  audioLevelRef: MutableRefObject<number>;
  connected: boolean;
}

interface GlobeSceneProps extends NeuralGlobeProps {
  reducedMotion: boolean;
}

type GeoPoint = [longitude: number, latitude: number];

const LANDMASSES: GeoPoint[][] = [
  [[-168, 70], [-145, 72], [-128, 58], [-130, 48], [-117, 32], [-105, 23], [-97, 15], [-82, 8], [-76, 19], [-63, 46], [-82, 54], [-96, 69], [-130, 73]],
  [[-81, 12], [-66, 10], [-49, 3], [-35, -8], [-47, -24], [-54, -39], [-70, -55], [-77, -34], [-80, -8]],
  [[-11, 71], [12, 72], [32, 63], [42, 52], [30, 42], [18, 36], [5, 43], [-10, 48]],
  [[-18, 36], [8, 38], [33, 30], [49, 11], [42, -12], [30, -34], [17, -35], [4, -27], [-4, -5], [-16, 15]],
  [[30, 72], [62, 78], [103, 72], [143, 63], [177, 57], [163, 42], [146, 34], [139, 16], [119, 3], [105, -7], [89, 8], [75, 8], [61, 24], [46, 37], [35, 54]],
  [[112, -11], [132, -10], [154, -18], [151, -38], [134, -45], [116, -34]],
  [[-53, 82], [-25, 82], [-18, 68], [-41, 58], [-53, 69]],
];

const CITY_COORDINATES: GeoPoint[] = [
  [-122, 38], [-74, 41], [-46, -23], [-70, -34], [-3, 52], [2, 49], [31, 30],
  [55, 25], [73, 19], [103, 1], [116, 40], [127, 37], [139, 36], [151, -34],
  [28, -26], [18, 4], [77, 29], [100, 14],
];

function pointOnGlobe(longitude: number, latitude: number, radius: number): THREE.Vector3 {
  const longitudeRadians = THREE.MathUtils.degToRad(longitude);
  const latitudeRadians = THREE.MathUtils.degToRad(latitude);
  const latitudeRadius = Math.cos(latitudeRadians) * radius;
  return new THREE.Vector3(
    Math.sin(longitudeRadians) * latitudeRadius,
    Math.sin(latitudeRadians) * radius,
    Math.cos(longitudeRadians) * latitudeRadius,
  );
}

function containsGeoPoint(longitude: number, latitude: number, polygon: GeoPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [currentLongitude, currentLatitude] = polygon[index];
    const [previousLongitude, previousLatitude] = polygon[previous];
    const crossesLatitude = (currentLatitude > latitude) !== (previousLatitude > latitude);
    const crossingLongitude =
      ((previousLongitude - currentLongitude) * (latitude - currentLatitude)) /
        (previousLatitude - currentLatitude) +
      currentLongitude;
    if (crossesLatitude && longitude < crossingLongitude) inside = !inside;
  }
  return inside;
}

const VERTEX_SHADER = `
  uniform float uTime;
  uniform float uLevel;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vUv = uv;
    vec3 displaced = position;
    float ripple = sin(position.y * 8.0 + uTime * 0.9)
      * cos(position.x * 7.0 - uTime * 0.65);
    displaced += normal * ripple * (0.012 + uLevel * 0.035);
    vec4 viewPosition = modelViewMatrix * vec4(displaced, 1.0);
    vViewPosition = -viewPosition.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const FRAGMENT_SHADER = `
  uniform float uTime;
  uniform float uLevel;
  uniform vec3 uTint;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vec3 viewDirection = normalize(vViewPosition);
    float fresnel = pow(1.0 - max(dot(normalize(vNormal), viewDirection), 0.0), 2.4);
    float current = uTime * 0.12;
    float flow = sin(vUv.x * 17.0 + sin(vUv.y * 10.0 + current) * 1.7 + current);
    float secondFlow = cos(vUv.y * 19.0 - vUv.x * 7.0 - current * 1.4);
    float water = smoothstep(-0.15, 0.9, flow * 0.55 + secondFlow * 0.45);
    float gold = pow(max(0.0, sin(vUv.x * 11.0 + vUv.y * 8.0 + current * 1.8)), 22.0);
    vec3 deep = vec3(0.004, 0.018, 0.07);
    vec3 ocean = vec3(0.008, 0.13, 0.34);
    vec3 cyan = vec3(0.035, 0.46, 0.74);
    vec3 color = mix(deep, ocean, smoothstep(0.05, 0.95, water));
    color = mix(color, cyan, water * (0.16 + uLevel * 0.2));
    color += uTint * (fresnel * 0.32 + gold * 0.08);
    color += vec3(0.015, 0.09, 0.16) * fresnel;
    gl_FragColor = vec4(color, 1.0);
  }
`;

function createNetworkGeometry(): {
  lines: THREE.BufferGeometry;
  nodes: THREE.BufferGeometry;
  land: THREE.BufferGeometry;
  cityPositions: THREE.Vector3[];
} {
  const positions: THREE.Vector3[] = [];
  const count = 190;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let index = 0; index < count; index += 1) {
    const y = 1 - (index / (count - 1)) * 2;
    const radius = Math.sqrt(1 - y * y);
    const angle = goldenAngle * index;
    const point = new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius).multiplyScalar(1.215);
    positions.push(point);
  }

  const linePositions: number[] = [];
  for (let index = 0; index < positions.length; index += 1) {
    const neighbors = positions
      .map((point, neighbor) => ({ neighbor, distance: positions[index].distanceTo(point) }))
      .filter(({ neighbor }) => neighbor !== index)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 3);
    for (const { neighbor } of neighbors) {
      if (neighbor > index) linePositions.push(...positions[index].toArray(), ...positions[neighbor].toArray());
    }
  }

  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
  const nodes = new THREE.BufferGeometry();
  nodes.setAttribute('position', new THREE.Float32BufferAttribute(positions.flatMap((point) => point.toArray()), 3));
  const landPositions: number[] = [];
  for (let latitude = -56; latitude <= 78; latitude += 5) {
    for (let longitude = -176; longitude <= 180; longitude += 6) {
      if (LANDMASSES.some((polygon) => containsGeoPoint(longitude, latitude, polygon))) {
        landPositions.push(...pointOnGlobe(longitude, latitude, 1.195).toArray());
      }
    }
  }
  const land = new THREE.BufferGeometry();
  land.setAttribute('position', new THREE.Float32BufferAttribute(landPositions, 3));
  const cityPositions = CITY_COORDINATES.map(([longitude, latitude]) =>
    pointOnGlobe(longitude, latitude, 1.23),
  );
  return { lines, nodes, land, cityPositions };
}

function GlobeScene({ state, audioLevelRef, connected, reducedMotion }: GlobeSceneProps) {
  const globeRef = useRef<THREE.Group>(null);
  const cyanCometRef = useRef<THREE.Mesh>(null);
  const amberCometRef = useRef<THREE.Mesh>(null);
  const blueCometRef = useRef<THREE.Mesh>(null);
  const cyanRingMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const amberRingMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uTint: { value: new THREE.Color('#38dcff') },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  }), []);
  const network = useMemo(createNetworkGeometry, []);
  const cityGeometry = useMemo(() => new THREE.SphereGeometry(0.018, 8, 8), []);
  const cityMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#ffc16c', toneMapped: false }),
    [],
  );
  const cityNodes = useMemo(() => {
    const instances = new THREE.InstancedMesh(cityGeometry, cityMaterial, network.cityPositions.length);
    instances.frustumCulled = false;
    const transform = new THREE.Object3D();
    network.cityPositions.forEach((position, index) => {
      transform.position.copy(position);
      transform.updateMatrix();
      instances.setMatrixAt(index, transform.matrix);
    });
    instances.instanceMatrix.needsUpdate = true;
    return instances;
  }, [cityGeometry, cityMaterial, network.cityPositions]);
  const cityNodeTransform = useMemo(() => new THREE.Object3D(), []);
  const targetTint = state === 'thinking'
    ? '#a27bff'
    : state === 'speaking'
      ? '#ff9d1c'
      : state === 'connecting'
        ? '#7ab9ff'
        : '#38dcff';
  const tint = useMemo(() => new THREE.Color(targetTint), [targetTint]);

  useFrame(({ clock }, delta) => {
    const level = connected && (state === 'listening' || state === 'speaking')
      ? Math.min(1, Math.max(0, audioLevelRef.current))
      : 0;
    material.uniforms.uLevel.value = THREE.MathUtils.damp(material.uniforms.uLevel.value, level, 8, delta);
    material.uniforms.uTint.value.lerp(tint, Math.min(1, delta * 2.5));
    if (!reducedMotion || level > 0) {
      network.cityPositions.forEach((position, index) => {
        cityNodeTransform.position.copy(position);
        const pulse = reducedMotion ? 1 : 1 + Math.sin(clock.elapsedTime * 2.2 + index) * 0.13;
        cityNodeTransform.scale.setScalar(pulse * (1 + level * 0.5));
        cityNodeTransform.updateMatrix();
        cityNodes.setMatrixAt(index, cityNodeTransform.matrix);
      });
      cityNodes.instanceMatrix.needsUpdate = true;
    }
    if (cyanRingMaterialRef.current) cyanRingMaterialRef.current.opacity = 0.58 + level * 0.32;
    if (amberRingMaterialRef.current) amberRingMaterialRef.current.opacity = 0.45 + level * 0.3;
    if (globeRef.current) {
      globeRef.current.scale.setScalar(1 + level * 0.025);
    }
    const time = reducedMotion ? 0 : clock.elapsedTime;
    cyanCometRef.current?.position.set(Math.cos(time * 0.72) * 1.52, Math.sin(time * 0.72) * 1.52, 0);
    amberCometRef.current?.position.set(Math.cos(time * -0.51 + 1.3) * 1.68, Math.sin(time * -0.51 + 1.3) * 1.68, 0);
    blueCometRef.current?.position.set(Math.cos(time * 0.88 + 2.4) * 1.42, Math.sin(time * 0.88 + 2.4) * 1.42, 0);
    cyanCometRef.current?.scale.setScalar(1 + level * 0.7);
    amberCometRef.current?.scale.setScalar(1 + level * 0.55);
    if (!reducedMotion) {
      material.uniforms.uTime.value = clock.elapsedTime;
      if (globeRef.current) {
        globeRef.current.rotation.y += delta * (state === 'thinking' ? 0.2 : 0.08);
        globeRef.current.rotation.x = Math.sin(clock.elapsedTime * 0.18) * 0.08;
      }
    }
  });

  return (
    <group ref={globeRef}>
      <mesh>
        <sphereGeometry args={[1.18, 96, 72]} />
        <primitive object={material} attach="material" />
      </mesh>
      <mesh scale={1.012}>
        <sphereGeometry args={[1.18, 64, 48]} />
        <meshBasicMaterial color="#43dfff" transparent opacity={0.075} side={THREE.BackSide} />
      </mesh>
      <lineSegments geometry={network.lines}>
        <lineBasicMaterial color="#72dfff" transparent opacity={0.48} />
      </lineSegments>
      <points geometry={network.nodes}>
        <pointsMaterial color="#c6f4ff" size={0.023} sizeAttenuation transparent opacity={0.92} />
      </points>
      <points geometry={network.land}>
        <pointsMaterial color="#48bafa" size={0.026} sizeAttenuation transparent opacity={0.78} />
      </points>
      <primitive object={cityNodes} />
      <group rotation={[0.94, 0.22, -0.3]}>
        <mesh>
          <torusGeometry args={[1.52, 0.008, 8, 180]} />
          <meshBasicMaterial ref={cyanRingMaterialRef} color="#39d9ff" transparent opacity={0.68} />
        </mesh>
        <mesh ref={cyanCometRef}>
          <sphereGeometry args={[0.035, 12, 8]} />
          <meshBasicMaterial color="#b4fbff" toneMapped={false} />
        </mesh>
      </group>
      <group rotation={[1.22, -0.44, 0.32]}>
        <mesh>
          <torusGeometry args={[1.68, 0.006, 8, 180]} />
          <meshBasicMaterial ref={amberRingMaterialRef} color="#ffb44c" transparent opacity={0.55} />
        </mesh>
        <mesh ref={amberCometRef}>
          <sphereGeometry args={[0.033, 12, 8]} />
          <meshBasicMaterial color="#fff0bd" toneMapped={false} />
        </mesh>
      </group>
      <group rotation={[0.48, 0.9, 0.65]}>
        <mesh>
          <torusGeometry args={[1.42, 0.004, 8, 180]} />
          <meshBasicMaterial color="#368bff" transparent opacity={0.54} />
        </mesh>
        <mesh ref={blueCometRef}>
          <sphereGeometry args={[0.025, 10, 8]} />
          <meshBasicMaterial color="#69cfff" toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

const STATE_LABELS: Record<BobbyState, string> = {
  idle: 'Ready when you are',
  connecting: 'Connecting to Bobby',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
};

export function NeuralGlobe({ state, audioLevelRef, connected }: NeuralGlobeProps) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const status = connected ? STATE_LABELS[state] : 'Start a conversation';

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener('change', updatePreference);
    return () => mediaQuery.removeEventListener('change', updatePreference);
  }, [setReducedMotion]);

  return (
    <div
      className="neural-globe"
      data-state={state}
      data-connected={connected}
      role="img"
      aria-label={`Bobby neural globe: ${status}`}
    >
      <Canvas
        camera={{ position: [0, 0, 4.25], fov: 42 }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true }}
        fallback={<div className="globe-fallback" aria-hidden="true" />}
      >
        <AdaptiveDpr pixelated />
        <GlobeScene
          state={state}
          audioLevelRef={audioLevelRef}
          connected={connected}
          reducedMotion={reducedMotion}
        />
      </Canvas>
      <div className="globe-state" aria-live="polite">
        <span className="globe-state-dot" />
        {status}
      </div>
    </div>
  );
}
