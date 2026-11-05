export const PARTICLE_AVATAR_VERTEX_SHADER = `
  attribute vec3 aFemale;
  attribute vec3 aMale;
  attribute vec3 aCore;
  attribute vec3 aColor;
  attribute vec3 aMaleColor;
  attribute vec2 aUv;
  attribute float aSize;
  attribute float aSeed;
  attribute float aDust;

  uniform float uTime;
  uniform float uAudioLevel;
  uniform float uState;
  uniform float uModeFrom;
  uniform float uModeTo;
  uniform float uMorphStart;
  uniform float uReducedMotion;
  uniform float uPixelRatio;
  uniform vec2 uPointer;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vState;
  varying float vScan;
  varying float vSeed;
  varying float vDust;

  vec3 modePosition(float mode) {
    if (mode < 0.5) return aCore;
    if (mode < 1.5) return aFemale;
    return aMale;
  }

  void main() {
    float time = uTime * mix(1.0, 0.38, uReducedMotion);
    float morphTime = clamp((uTime - uMorphStart) / 1.2, 0.0, 1.0);
    float stagger = smoothstep(aSeed * 0.32, min(1.0, aSeed * 0.32 + 0.68), morphTime);
    vec3 fromPosition = modePosition(uModeFrom);
    vec3 toPosition = modePosition(uModeTo);
    vec3 position = mix(fromPosition, toPosition, stagger);

    float explosionEnvelope = (1.0 - uReducedMotion)
      * sin(morphTime * 3.14159265)
      * (1.0 - smoothstep(0.82, 1.0, morphTime));
    vec3 explosionDirection = normalize(vec3(
      sin(aSeed * 91.7) + 0.001,
      cos(aSeed * 63.1) + 0.001,
      sin(aSeed * 27.3) + cos(aSeed * 18.5)
    ));
    position += explosionDirection * explosionEnvelope * 0.22;

    float entrance = smoothstep(0.0, mix(2.0, 0.45, uReducedMotion), time);
    vec3 assemblyOrigin = vec3(
      (aSeed - 0.5) * 4.2,
      (fract(aSeed * 41.31) - 0.5) * 3.4,
      (fract(aSeed * 9.17) - 0.5) * 1.6
    );
    position = mix(assemblyOrigin, position, entrance);

    float breath = sin(time * 1.35) * 0.012;
    float listening = 1.0 - smoothstep(0.5, 1.5, abs(uState - 1.0));
    float thinking = 1.0 - smoothstep(0.5, 1.5, abs(uState - 2.0));
    float speaking = 1.0 - smoothstep(0.5, 1.5, abs(uState - 3.0));
    float curl = sin(position.y * 5.2 + time * 0.48 + aSeed * 9.0)
      * cos(position.x * 4.0 - time * 0.38 + aSeed * 5.0);
    position.xy += vec2(
      sin(time * 0.7 + aSeed * 20.0),
      cos(time * 0.62 + aSeed * 16.0)
    ) * (0.008 + thinking * 0.016 + uAudioLevel * speaking * 0.026);
    position.z += sin(time * 1.8 + aSeed * 39.0) * 0.016
      + curl * thinking * 0.035;

    float face = smoothstep(0.32, 0.42, aUv.y)
      * (1.0 - smoothstep(0.76, 0.86, aUv.y))
      * (1.0 - smoothstep(0.12, 0.3, abs(aUv.x - 0.5)));
    float mouth = face * smoothstep(0.42, 0.48, aUv.y)
      * (1.0 - smoothstep(0.57, 0.63, aUv.y));
    float speakingJitter = speaking * uAudioLevel * mouth;
    position += vec3(
      sin(time * 37.0 + aSeed * 143.0),
      cos(time * 31.0 + aSeed * 91.0),
      sin(time * 43.0 + aSeed * 71.0)
    ) * speakingJitter * 0.028;

    float pulse = 1.0 + uAudioLevel * speaking * (0.07 + 0.06 * sin(time * 7.0 + aSeed * 11.0));
    position.xy *= 1.0 + breath + uAudioLevel * speaking * 0.035;
    position *= pulse;
    position.x += uPointer.x * 0.035;
    position.y += uPointer.y * 0.035;

    float dustSpread = aDust * (0.035 + fract(aSeed * 71.3) * 0.16);
    position.x += (fract(aSeed * 27.71) - 0.5) * dustSpread;
    position.y += aDust * (0.018 + fract(aSeed * 11.3) * 0.11)
      + aDust * sin(time * 0.7 + aSeed * 29.0) * 0.018;

    float shimmer = 0.78 + 0.22 * sin(time * (2.1 + aSeed * 3.0) + aSeed * 60.0);
    float scan = 1.0 - smoothstep(0.0, 0.065, abs(aUv.y - fract(time * 0.22) * 1.12));
    vec3 blue = vec3(0.118, 0.435, 1.0);
    vec3 cyan = vec3(0.0, 0.831, 1.0);
    vec3 white = vec3(0.86, 0.96, 1.0);
    vec3 sourceColor = mix(aColor, aMaleColor, step(1.5, mix(uModeFrom, uModeTo, stagger)));
    vec3 baseColor = mix(blue, cyan, clamp(sourceColor.g * 0.7 + sourceColor.b * 0.32, 0.0, 1.0));
    baseColor = mix(baseColor, white, clamp(sourceColor.r * 0.85, 0.0, 0.8));
    vec3 thinkingColor = vec3(0.48, 0.36, 1.0);
    vec3 speakingColor = vec3(1.0, 0.43, 0.12);
    baseColor = mix(baseColor, thinkingColor, thinking * 0.54);
    baseColor = mix(baseColor, speakingColor, speaking * uAudioLevel * (0.25 + 0.28 * face));
    baseColor = mix(baseColor, white, listening * scan * 0.72);
    vColor = baseColor * shimmer * (1.0 + uAudioLevel * speaking * 0.35);
    vAlpha = entrance * (0.55 + aColor.r * 0.45) * mix(1.0, 0.3, aDust);
    vState = uState;
    vScan = scan;
    vSeed = aSeed;
    vDust = aDust;

    float pointerTiltY = uPointer.x * 0.12;
    float pointerTiltX = -uPointer.y * 0.09;
    float cosineY = cos(pointerTiltY);
    float sineY = sin(pointerTiltY);
    float cosineX = cos(pointerTiltX);
    float sineX = sin(pointerTiltX);
    vec3 tilted = vec3(
      position.x * cosineY + position.z * sineY,
      position.y * cosineX - position.z * sineX,
      position.x * -sineY + position.z * cosineY
    );

    vec4 viewPosition = modelViewMatrix * vec4(tilted, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = clamp(aSize * uPixelRatio * (2.2 / max(1.0, -viewPosition.z)), 1.0, 8.0);
  }
`;

export const PARTICLE_AVATAR_FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vState;
  varying float vScan;
  varying float vSeed;
  varying float vDust;

  void main() {
    vec2 centered = gl_PointCoord - 0.5;
    float distanceFromCenter = length(centered);
    float core = 1.0 - smoothstep(0.12, 0.5, distanceFromCenter);
    float glow = 1.0 - smoothstep(0.12, 0.5, distanceFromCenter);
    float halo = 1.0 - smoothstep(0.25, 0.5, distanceFromCenter);
    float speckle = 0.75 + 0.25 * sin(vSeed * 89.0);
    float listening = 1.0 - smoothstep(0.5, 1.5, abs(vState - 1.0));
    float dustAlpha = mix(1.0, 0.45 + 0.45 * sin(vSeed * 61.0), vDust);
    float alpha = max(core, glow * 0.46 + halo * 0.18)
      * vAlpha * speckle * dustAlpha;
    vec3 color = vColor * (1.0 + halo * 0.4 + listening * vScan * 0.42);
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
