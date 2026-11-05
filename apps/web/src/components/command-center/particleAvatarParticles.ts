export interface ParticleSource {
  positions: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;
  sizes: Float32Array;
  seeds: Float32Array;
  dust: Float32Array;
}

export type PortraitMode = 'core' | 'female' | 'male';

function randomGenerator(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function portraitCoordinates(mode: Exclude<PortraitMode, 'core'>, random: () => number): [number, number] {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const x = random() * 2 - 1;
    const y = random() * 2 - 1;
    const headWidth = mode === 'female' ? 0.39 : 0.43;
    const headHeight = mode === 'female' ? 0.58 : 0.55;
    const headCenter = mode === 'female' ? 0.31 : 0.3;
    const head = ((x / headWidth) ** 2) + (((y - headCenter) / headHeight) ** 2) < 1;
    const neck = Math.abs(x) < (mode === 'female' ? 0.19 : 0.22) && y < -0.05 && y > -0.56;
    const shoulderWidth = mode === 'female' ? 0.91 : 0.99;
    const shoulders =
      y < -0.25 &&
      y > -1.02 &&
      Math.abs(x) < shoulderWidth * Math.sqrt(Math.max(0, 1 - ((y + 0.29) / 0.76) ** 2));
    const hairline = mode === 'female' && y > 0.1 && Math.abs(x) > 0.28;
    const inside = head || neck || shoulders || hairline;
    if (!inside || random() > 0.77) continue;
    return [x, y];
  }
  return [random() * 1.5 - 0.75, random() * 1.6 - 0.8];
}

export function createCorePositions(count: number): Float32Array {
  const positions = new Float32Array(count * 3);
  const random = randomGenerator(1741);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < count; index += 1) {
    const y = 1 - (index / Math.max(1, count - 1)) * 2;
    const radius = Math.sqrt(1 - y * y);
    const angle = goldenAngle * index;
    const pointRadius = 0.82 + random() * 0.035;
    positions[index * 3] = Math.cos(angle) * radius * pointRadius;
    positions[index * 3 + 1] = y * pointRadius;
    positions[index * 3 + 2] = Math.sin(angle) * radius * pointRadius;
  }
  return positions;
}

export function createProceduralPortrait(
  count: number,
  mode: Exclude<PortraitMode, 'core'>,
  seed: number,
): ParticleSource {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const sizes = new Float32Array(count);
  const seeds = new Float32Array(count);
  const dust = new Float32Array(count);
  const random = randomGenerator(seed);

  for (let index = 0; index < count; index += 1) {
    const [x, y] = portraitCoordinates(mode, random);
    const depth = (random() - 0.5) * 0.2;
    const brightness = 0.42 + random() * 0.58;
    positions[index * 3] = x * 0.82;
    positions[index * 3 + 1] = y * 0.98;
    positions[index * 3 + 2] = depth + brightness * 0.045;
    colors[index * 3] = brightness;
    colors[index * 3 + 1] = brightness * 0.74;
    colors[index * 3 + 2] = 0.82 + brightness * 0.18;
    uvs[index * 2] = (x + 1) * 0.5;
    uvs[index * 2 + 1] = (y + 1) * 0.5;
    sizes[index] = 0.84 + brightness * 1.68;
    seeds[index] = random();
    dust[index] = y < -0.48 ? Math.min(1, (-y - 0.48) * 1.8) : 0;
  }

  return { positions, colors, uvs, sizes, seeds, dust };
}

export async function createPortraitParticles(
  source: string,
  count: number,
): Promise<ParticleSource> {
  const image = new Image();
  image.decoding = 'async';
  image.src = source;
  await image.decode();

  const width = 300;
  const height = 360;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not create an offscreen canvas for the particle portrait.');

  context.clearRect(0, 0, width, height);
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);

  const { data } = context.getImageData(0, 0, width, height);
  const candidates: number[] = [];
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const alpha = data[offset + 3] / 255;
    const brightness = (data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114) / 255;
    if (alpha > 0.12 && brightness > 0.035) candidates.push(pixel);
  }
  if (candidates.length < 100) {
    throw new Error(`The portrait at ${source} did not contain enough visible pixels.`);
  }

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const sizes = new Float32Array(count);
  const seeds = new Float32Array(count);
  const dust = new Float32Array(count);
  const random = randomGenerator(90210 + count);

  for (let index = 0; index < count; index += 1) {
    const pixel = candidates[Math.floor(random() * candidates.length)];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const offset = pixel * 4;
    const alpha = data[offset + 3] / 255;
    const brightness = (data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114) / 255;
    const randomDepth = (random() - 0.5) * 0.18;
    const nx = (x / (width - 1) - 0.5) * 1.72;
    const ny = (0.5 - y / (height - 1)) * 2.15;

    positions[index * 3] = nx;
    positions[index * 3 + 1] = ny;
    positions[index * 3 + 2] = randomDepth + brightness * 0.14;
    const blueToCyan = Math.min(1, Math.max(0, brightness * 1.3));
    const highlight = Math.max(0, (brightness - 0.58) * 1.8);
    colors[index * 3] = 0.118 + highlight * 0.74;
    colors[index * 3 + 1] = 0.435 + blueToCyan * 0.396 + highlight * 0.1;
    colors[index * 3 + 2] = 1;
    uvs[index * 2] = x / (width - 1);
    uvs[index * 2 + 1] = 1 - y / (height - 1);
    sizes[index] = (0.84 + brightness * 1.68) * (0.62 + alpha * 0.38);
    seeds[index] = random();
    dust[index] = Math.min(1, Math.max(0, (y / height - 0.67) * 3.2));
  }

  canvas.width = 0;
  canvas.height = 0;
  return { positions, colors, uvs, sizes, seeds, dust };
}
