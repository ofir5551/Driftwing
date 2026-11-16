import * as THREE from 'three';
import { Config } from '../../core/Config';
import { withMist } from '../Mist';
import { getToonGradient } from '../Terrain';

/** Shared clock for Sea of Clouds' animated things (set once per frame by the world). */
export const peaksTime = { value: 0 };

/**
 * The props' toon material (vertex colours, instance tints, the valley mist). Prayer flags
 * flutter in the vertex shader, keyed by the geometry's `aAnim` (kind 1, weight down the
 * cloth): each flag ripples on its own phase (from where its instance hangs), so a line of
 * them reads as wind running along it. Nothing moves on the CPU.
 */
export function propMaterial(twoSided: boolean): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    vertexColors: true,
    gradientMap: getToonGradient(),
    side: twoSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPkTime = peaksTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 aAnim;\nuniform float uPkTime;',
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
#ifdef USE_INSTANCING
if (aAnim.x > 0.5 && aAnim.x < 1.5) {
  vec3 iPos = instanceMatrix[3].xyz;
  float ph = dot(iPos, vec3(0.37, 0.11, 0.29));
  float w = aAnim.y;
  // The cloth billows out of the line's plane and its hem lifts in the gusts.
  transformed.z += (sin(uPkTime * 5.3 + ph + transformed.x * 3.0) * 0.22 + 0.12) * w;
  transformed.y += sin(uPkTime * 3.7 + ph * 1.3) * 0.06 * w;
}
#endif`,
      );
  };
  m.customProgramCacheKey = () => (twoSided ? 'peaks-cloth' : 'peaks-props');
  return withMist(m);
}

/**
 * Cranes wheeling round their flock's circle. The instance carries the circle's centre (its
 * translation) and `aSlot` (metres behind the leader, metres outward of its track, the circle's
 * radius signed by direction, a phase): the shader moves each bird round the circle, nose along
 * it, banked a little into the turn, and beats its wings (aAnim 2, weight out to the tip) in
 * slow strokes between long glides, each bird a little out of step with the next.
 */
export function craneMaterial(): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    vertexColors: true,
    gradientMap: getToonGradient(),
    side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPkTime = peaksTime;
    shader.uniforms.uCraneSpeed = {
      get value() {
        return Config.peaks.craneSpeed;
      },
    };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 aAnim;\nattribute vec4 aSlot;\nuniform float uPkTime;\nuniform float uCraneSpeed;',
      )
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `#include <beginnormal_vertex>
float crR = abs(aSlot.z);
float crDir = sign(aSlot.z);
float crA = aSlot.w + crDir * (uPkTime * uCraneSpeed - aSlot.x) / crR;
vec2 crT = crDir * vec2(-sin(crA), cos(crA));
float crBank = 0.22 * crDir;
// Nose (local +z) along the track: turn by the heading, bank into the circle.
mat3 crRot = mat3(
  vec3(crT.y, 0.0, -crT.x),
  vec3(0.0, 1.0, 0.0),
  vec3(crT.x, 0.0, crT.y)) * mat3(
  vec3(cos(crBank), sin(crBank), 0.0),
  vec3(-sin(crBank), cos(crBank), 0.0),
  vec3(0.0, 0.0, 1.0));
objectNormal = crRot * objectNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
{
  float ph = aSlot.w * 7.0 + aSlot.x * 0.37;
  // Slow beats, then a long glide on set wings.
  float beat = smoothstep(-0.2, 0.4, sin(uPkTime * 0.45 + ph));
  float w = aAnim.y;
  if (aAnim.x > 1.5) transformed.y += sin(uPkTime * 3.2 + ph) * 0.9 * w * beat - 0.12 * w * (1.0 - beat);
  transformed = crRot * transformed;
  float rr = crR + aSlot.y;
  transformed.xz += vec2(cos(crA), sin(crA)) * rr;
  transformed.y += sin(crA * 2.0 + ph) * 3.0;
}`,
      );
  };
  m.customProgramCacheKey = () => 'peaks-cranes';
  return withMist(m);
}

/** Uniforms of the sun's beams (PeaksWorld sets them per frame). */
export const beamUniforms = {
  uBeamDir: { value: new THREE.Vector3(0, -1, 0) },
  uBeamColor: { value: new THREE.Color() },
  uBeamStrength: { value: 0 },
};

/**
 * Shafts of sunlight breaking through the sky's clouds and falling through the hazy air onto
 * the cloud sea: long additive quads along the sunlight, turned round their own axis to face
 * the camera, brightest down the middle, fading in from the sky and out into the sea, and
 * fading with distance and when seen end-on. Instances: translation = the shaft's foot on the
 * cloud sea, scale x = width, y = length.
 */
export function beamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: beamUniforms,
    vertexShader: /* glsl */ `
      uniform vec3 uBeamDir;
      varying vec2 vUv;
      varying vec3 vWp;
      varying float vSide;
      void main() {
        vec3 foot = instanceMatrix[3].xyz;
        float wid = length(instanceMatrix[0].xyz);
        float len = length(instanceMatrix[1].xyz);
        vec3 axis = -uBeamDir;
        vec3 view = normalize(cameraPosition - foot);
        vec3 side = normalize(cross(axis, view) + vec3(1e-4, 0.0, 0.0));
        float u = position.y + 0.5;
        // Wider toward the sky, as light through a gap spreads.
        vec3 wp = foot + axis * (u * len) + side * position.x * wid * (0.55 + 0.45 * u);
        vUv = vec2(position.x * 2.0, u);
        vWp = wp;
        // Seen end-on a beam is a smear across the view: fade it.
        vSide = 1.0 - smoothstep(0.75, 0.95, abs(dot(view, axis)));
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uBeamColor;
      uniform float uBeamStrength;
      varying vec2 vUv;
      varying vec3 vWp;
      varying float vSide;
      void main() {
        float across = 1.0 - smoothstep(0.0, 1.0, abs(vUv.x));
        float along = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
        // Per pixel: near the bird (or with the camera inside one) a beam would wash the screen.
        float d = distance(vWp, cameraPosition);
        float fade = smoothstep(90.0, 260.0, d) * (1.0 - smoothstep(900.0, 1300.0, d));
        float a = across * across * along * fade * vSide * uBeamStrength;
        gl_FragColor = vec4(uBeamColor * a, 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
