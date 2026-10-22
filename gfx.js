// STORMBREAK gfx: sky + day/night, sun/moon light with cascaded shadows, height fog / aerial perspective,
// cloud layers, ocean, post FX, camera shake, quality tiers.
//
// Public API (game.gfx):
//   render()                       main.js calls this every frame
//   timeOfDay (hours, get/set), setTimeOfDay(h), dayMinutes (real minutes per game day, default 48), timeSpeed (1; 0 freezes), nightSpeed (night runs faster),
//   shadowCullDist (m; non-world meshes stop casting shadows beyond it; world tags its roots userData.sbOwner='world')
//   sun        three/addons SunLight (2-cascade shadows, NO material setup needed: works on every built-in lit material)
//   csm        compatibility shim: { setupMaterial(mat) {} (no-op), lights: [sun] } — nothing to call
//   sunDir / moonDir (Vector3, toward the body), daylight (0 night .. 1 day), isNight
//   hemi       HemisphereLight fill
//   water      ocean mesh; waterHeightAt(x, z) -> world-space surface height (Gerstner waves, matches the shader)
//   seaLevel   0
//   shake(intensity, duration), shakeAt(pos, intensity, duration, radius) — distance-attenuated
//   flash(amount)                   brief exposure flash (explosions)
//   setQuality('low'|'med'|'high'), quality, autoQuality (true until setQuality is called or ?quality= is given)
//   setAO(bool)                     optional GTAO (off by default, expensive in a big world)
//   exposure (multiplier), fog { density, falloff, base }, clouds { coverage }
// Events emitted: 'timeofday' {hour, night} whenever night/day flips.
// URL: ?nopost (no post FX), ?quality=low|med|high, ?time=18.5 (start hour), ?ao=1
//
// Notes for other modules:
//   * Fog: scene.fog is a FogExp2, but the fog shader chunks are replaced globally with height fog + sun in-scatter.
//     Built-in materials get it automatically. Custom ShaderMaterials with fog:true must use the standard chunks
//     (fog_pars_vertex/fog_vertex/fog_pars_fragment/fog_fragment) and merge THREE.UniformsLib.fog into their uniforms.
//   * Shadows: set castShadow/receiveShadow on meshes. Don't add other shadow-casting DirectionalLights.
//   * Emissive / bright HDR colours (>1.5) bloom.
import * as THREE from 'three';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';

const LAT = 38 * Math.PI / 180, DECL = 19 * Math.PI / 180;
const POLAR = new THREE.Vector3(0, Math.sin(LAT), -Math.cos(LAT));
const srgb = (hex) => new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- global height-fog chunks
const FOGU = {
  sbFogParams: { value: { x: 0.00026, y: 1 / 300, z: 0.000018, w: 1 } },   // height density, falloff, base density, enabled
  sbFogSun: { value: { x: 0, y: 1, z: 0, w: 0.8 } },                      // sun dir, in-scatter strength
  sbFogSunColor: { value: { x: 1, y: 0.9, z: 0.7, w: 1 } },               // in-scatter colour, max fog
};
function patchFogChunks() {
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = `#ifdef USE_FOG
varying float vFogDepth;
varying vec3 vSbFogWorld;
#endif`;
  C.fog_vertex = `#ifdef USE_FOG
vFogDepth = - mvPosition.z;
vSbFogWorld = transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz );
#endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG
uniform vec3 fogColor;
varying float vFogDepth;
varying vec3 vSbFogWorld;
uniform vec4 sbFogParams;
uniform vec4 sbFogSun;
uniform vec4 sbFogSunColor;
#ifdef FOG_EXP2
uniform float fogDensity;
#else
uniform float fogNear;
uniform float fogFar;
#endif
float sbFogAmount( vec3 ro, vec3 rd, float dist ) {
  float b = sbFogParams.y;
  float hy = clamp( rd.y * dist * b, -40.0, 40.0 );
  float k = abs( hy ) > 1e-4 ? ( 1.0 - exp( - hy ) ) / hy : 1.0;
  float h = sbFogParams.x * exp( - b * max( ro.y, -20.0 ) ) * dist * k;
  return min( 1.0 - exp( - ( h + sbFogParams.z * dist ) ), sbFogSunColor.w );
}
#endif`;
  C.fog_fragment = `#ifdef USE_FOG
if ( sbFogParams.w > 0.5 ) {
  vec3 sbD = vSbFogWorld - cameraPosition;
  float sbDist = length( sbD );
  vec3 sbRd = sbD / max( sbDist, 1e-4 );
  float sbF = sbFogAmount( cameraPosition, sbRd, sbDist );
  float sbS = pow( max( dot( sbRd, sbFogSun.xyz ), 0.0 ), 20.0 ) * sbFogSun.w;
  gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( fogColor, sbFogSunColor.rgb, sbS ), sbF );
} else {
  #ifdef FOG_EXP2
  float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
  float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
}
#endif`;
  Object.assign(THREE.UniformsLib.fog, FOGU);
  for (const s of Object.values(THREE.ShaderLib)) if (s?.uniforms && 'fogColor' in s.uniforms) Object.assign(s.uniforms, FOGU);
}

// ---------------------------------------------------------------- shared GLSL noise
const NOISE = /* glsl */`
vec2 sbGrad( vec2 i ) { vec3 p = fract( i.xyx * vec3( 0.1031, 0.1030, 0.0973 ) ); p += dot( p, p.yzx + 33.33 ); return fract( ( p.xx + p.yz ) * p.zy ) * 2.0 - 1.0; }
float sbNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); vec2 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  float a = dot( sbGrad( i ), f ), b = dot( sbGrad( i + vec2( 1, 0 ) ), f - vec2( 1, 0 ) );
  float c = dot( sbGrad( i + vec2( 0, 1 ) ), f - vec2( 0, 1 ) ), d = dot( sbGrad( i + vec2( 1, 1 ) ), f - vec2( 1, 1 ) );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y ) * 1.6;
}
float sbHash13( vec3 p3 ) { p3 = fract( p3 * 0.1031 ); p3 += dot( p3, p3.zyx + 31.32 ); return fract( ( p3.x + p3.y ) * p3.z ); }
vec3 sbHash33( vec3 p3 ) { p3 = fract( p3 * vec3( 0.1031, 0.1030, 0.0973 ) ); p3 += dot( p3, p3.yxz + 33.33 ); return fract( ( p3.xxy + p3.yxx ) * p3.zyx ); }
`;

// ---------------------------------------------------------------- sky
const SKY_VERT = /* glsl */`
uniform vec3 uSunDir; uniform float uRayleigh, uTurbidity, uMieCoef, uStarRot;
varying vec3 vDir; varying vec3 vStarDir; varying vec3 vBetaR; varying vec3 vBetaM; varying float vSunE;
const vec3 totalRayleigh = vec3( 5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5 );
const vec3 MieConst = vec3( 1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14 );
void main() {
  vDir = position;
  vec3 A = vec3( 0.0, ${Math.sin(LAT).toFixed(6)}, ${(-Math.cos(LAT)).toFixed(6)} );
  float c = cos( uStarRot ), s = sin( uStarRot );
  vStarDir = position * c + cross( A, position ) * s + A * dot( A, position ) * ( 1.0 - c );
  float zc = clamp( uSunDir.y, -1.0, 1.0 );
  vSunE = 1000.0 * max( 0.0, 1.0 - exp( - ( 1.6110731556870734 - acos( zc ) ) / 1.5 ) );
  vBetaR = totalRayleigh * uRayleigh;
  vBetaM = 0.434 * ( 0.2 * uTurbidity ) * 10E-18 * MieConst * uMieCoef;
  vec4 p = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
  gl_Position = p.xyww;
}`;
const SKY_FRAG = /* glsl */`
uniform vec3 uSunDir, uMoonDir, uSunColor, uSkyAmb, uFogColor, uFogSunColor, uGround;
uniform float uSkyScale, uMieG, uTime, uNight, uEnvPass, uCoverage, uCloudH, uCirrus, uCloudQ, uDay;
uniform vec2 uWind;
uniform vec4 uFog;
varying vec3 vDir; varying vec3 vStarDir; varying vec3 vBetaR; varying vec3 vBetaM; varying float vSunE;
${NOISE}
const float PI = 3.141592653589793;
float hgPhase( float c, float g ) { float g2 = g * g; return 0.07957747 * ( 1.0 - g2 ) / pow( 1.0 - 2.0 * g * c + g2, 1.5 ); }
float cloudField( vec2 p, int oct ) {
  float r = 0.0, a = 0.5; vec2 q = p;
  for ( int i = 0; i < 6; i ++ ) { if ( i >= oct ) break; r += a * sbNoise( q ); a *= 0.5; q = q * 2.03 + uWind * 0.6 * float( i ); }
  return r;
}
void main() {
  vec3 rd = normalize( vDir );
  float y = rd.y;
  // --- Preetham daylight
  float zen = acos( max( 0.0, y ) );
  float inv = 1.0 / ( cos( zen ) + 0.15 * pow( 93.885 - zen * 180.0 / PI, -1.253 ) );
  vec3 Fex = exp( - ( vBetaR * 8.4E3 * inv + vBetaM * 1.25E3 * inv ) );
  float ct = dot( rd, uSunDir );
  vec3 bR = vBetaR * ( 0.05968310 * ( 1.0 + pow( ct * 0.5 + 0.5, 2.0 ) ) );
  vec3 bM = vBetaM * hgPhase( ct, uMieG );
  vec3 Lin = pow( vSunE * ( ( bR + bM ) / ( vBetaR + vBetaM ) ) * ( 1.0 - Fex ), vec3( 1.5 ) );
  Lin *= mix( vec3( 1.0 ), pow( vSunE * ( ( bR + bM ) / ( vBetaR + vBetaM ) ) * Fex, vec3( 0.5 ) ), clamp( pow( 1.0 - uSunDir.y, 5.0 ), 0.0, 1.0 ) );
  vec3 sky = ( Lin + vec3( 0.1 ) * Fex ) * uSkyScale;
  // --- night sky
  vec3 night = mix( vec3( 0.010, 0.016, 0.034 ), vec3( 0.0025, 0.004, 0.011 ), clamp( y * 1.4, 0.0, 1.0 ) );
  float mc = dot( rd, uMoonDir );
  night += vec3( 0.03, 0.04, 0.06 ) * pow( max( mc, 0.0 ), 24.0 ) * smoothstep( -0.05, 0.1, uMoonDir.y );
  // milky way-ish band
  float band = exp( - pow( dot( vStarDir, normalize( vec3( 0.3, 0.2, 0.93 ) ) ) * 4.0, 2.0 ) );
  night += vec3( 0.010, 0.010, 0.014 ) * band * ( 0.6 + 0.4 * sbNoise( vStarDir.xy * 9.0 + vStarDir.z * 4.0 ) );
  sky += night * uNight;
  float up = smoothstep( -0.02, 0.04, y );
  // --- stars
  if ( uNight > 0.01 && uEnvPass < 0.5 ) {
    vec3 sp = vStarDir * 260.0; vec3 cell = floor( sp ); vec3 f = fract( sp ) - 0.5;
    float h = sbHash13( cell );
    if ( h > 0.982 ) {
      vec3 o = ( sbHash33( cell ) - 0.5 ) * 0.5;
      float d = length( f - o );
      float br = pow( sbHash13( cell + 7.13 ), 4.0 );
      float tw = 0.75 + 0.25 * sin( uTime * ( 2.0 + h * 5.0 ) + h * 400.0 );
      vec3 tint = mix( vec3( 1.0, 0.85, 0.7 ), vec3( 0.75, 0.85, 1.0 ), sbHash13( cell + 3.1 ) );
      sky += tint * ( 1.0 - smoothstep( 0.0, 0.32, d ) ) * ( 0.25 + 4.0 * br ) * tw * uNight * up;
    }
  }
  // --- moon
  float moonR = 0.022;
  if ( mc > cos( moonR * 1.2 ) ) {
    vec3 mT = normalize( cross( uMoonDir, vec3( 0.0, 1.0, 0.0 ) ) ); vec3 mB = cross( mT, uMoonDir );
    vec2 uv = vec2( dot( rd, mT ), dot( rd, mB ) ) / moonR;
    float r2 = dot( uv, uv );
    if ( r2 < 1.0 ) {
      vec3 n = normalize( uv.x * mT + uv.y * mB - sqrt( 1.0 - r2 ) * uMoonDir );
      float lit = max( dot( n, uSunDir ), 0.0 );
      float maria = 0.75 + 0.25 * sbNoise( uv * 2.3 + 3.0 ) + 0.1 * sbNoise( uv * 7.0 );
      vec3 mcol = vec3( 1.0, 0.97, 0.9 ) * maria * ( lit * 1.6 + 0.02 );
      float edge = ( 1.0 - smoothstep( 0.92, 1.0, r2 ) );
      sky = mix( sky, mcol * mix( 0.4, 1.0, uNight ), edge * up );
    }
  }
  // --- sun disc
  if ( uEnvPass < 0.5 ) {
    float sd = smoothstep( 0.99994, 0.999975, ct );
    float halo = pow( max( ct, 0.0 ), 900.0 ) * 1.5;
    sky += uSunColor * ( sd * 40.0 + halo ) * up;
  }
  // --- clouds
  if ( y > 0.0 && uCoverage > 0.0 ) {
    float camY = cameraPosition.y;
    float t = max( uCloudH - camY, 50.0 ) / max( y, 0.02 );
    vec2 p = ( cameraPosition.xz + rd.xz * t ) / 2600.0 + uWind * uTime;
    int oct = int( uCloudQ );
    float base = cloudField( p, oct );
    float d = clamp( ( base + 0.12 - ( 1.0 - uCoverage ) * 0.75 ) * 2.4, 0.0, 1.0 );
    float fade = ( 1.0 - smoothstep( 9000.0, 32000.0, t ) ) * smoothstep( 0.0, 0.06, y );
    // cirrus
    vec2 pc = ( cameraPosition.xz * 0.3 + rd.xz * ( 6500.0 / max( y, 0.03 ) ) ) / 9000.0 + uWind * uTime * 0.5;
    float ci = clamp( sbNoise( pc * vec2( 1.0, 5.0 ) ) * 0.5 + sbNoise( pc * vec2( 3.0, 11.0 ) ) * 0.3 + 0.1, 0.0, 1.0 ) * uCirrus;
    ci *= smoothstep( 0.02, 0.2, y );
    vec3 sunLit = uSunColor * uDay;
    float silver = hgPhase( ct, 0.6 ) * 6.0 + 0.7;
    sky = mix( sky, uSkyAmb * 1.4 + sunLit * 1.6 * silver * 0.6, ci * 0.45 * ( 1.0 - d ) );
    if ( d > 0.0 ) {
      vec2 toSun = normalize( uSunDir.xz + 1e-4 ) * 0.07;
      float s1 = clamp( ( cloudField( p + toSun, oct - 1 ) + 0.12 - ( 1.0 - uCoverage ) * 0.75 ) * 2.4, 0.0, 1.0 );
      float s2 = clamp( ( cloudField( p + toSun * 2.5, 3 ) + 0.12 - ( 1.0 - uCoverage ) * 0.75 ) * 2.4, 0.0, 1.0 );
      float light = exp( - ( s1 * 1.6 + s2 * 0.9 ) );
      float edge = 1.0 - d;
      vec3 col = uSkyAmb * ( 0.9 + 0.5 * edge ) + sunLit * ( 1.9 * light + edge * silver * 0.8 );
      col += uSunColor * 0.25 * ( 1.0 - uDay ) * smoothstep( 0.0, 0.3, uSunDir.y + 0.15 );
      col = mix( col, col * vec3( 0.75, 0.8, 0.92 ), smoothstep( 0.4, 1.0, d ) * 0.4 );
      sky = mix( sky, col, d * fade * 0.97 );
    }
  }
  // --- horizon haze / ground
  vec3 fogCol = mix( uFogColor, uFogSunColor, pow( max( ct, 0.0 ), 20.0 ) * uFog.w );
  float haze = exp( - max( y, 0.0 ) * 11.0 );
  sky = mix( sky, fogCol, haze * 0.8 );
  if ( y < 0.0 ) sky = mix( fogCol, uEnvPass > 0.5 ? uGround : fogCol, ( 1.0 - smoothstep( -0.25, 0.0, y ) ) );
  gl_FragColor = vec4( max( sky, vec3( 0.0 ) ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------------------------------------------------------------- ocean
const WAVES = [ // dirX, dirZ, steepness, wavelength
  [0.92, 0.38, 0.13, 62], [0.6, 0.8, 0.12, 33], [0.98, -0.2, 0.11, 19], [0.3, 0.95, 0.1, 11.5], [0.75, -0.66, 0.09, 7.3], [-0.2, 0.98, 0.07, 4.6],
].map(([x, z, s, l]) => { const n = Math.hypot(x, z); return { x: x / n, z: z / n, s, l, k: 2 * Math.PI / l, c: Math.sqrt(9.8 / (2 * Math.PI / l)) }; });

function waterGeometry(segs, maxR) {
  const pos = [0, 0, 0], idx = [];
  const k = 1 + 2 * Math.PI / segs; let r = 0.6, ring = 0;
  const rings = [];
  while (r < maxR) { rings.push(r); r *= k; } rings.push(maxR);
  for (const rr of rings) for (let i = 0; i < segs; i++) { const a = i / segs * Math.PI * 2; pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr); }
  for (let i = 0; i < segs; i++) idx.push(0, 1 + (i + 1) % segs, 1 + i);
  for (ring = 0; ring < rings.length - 1; ring++) {
    const a0 = 1 + ring * segs, b0 = a0 + segs;
    for (let i = 0; i < segs; i++) { const i1 = (i + 1) % segs; idx.push(a0 + i, a0 + i1, b0 + i, a0 + i1, b0 + i1, b0 + i); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => i % 3 === 1 ? 1 : 0), 3));
  g.setIndex(idx);
  return g;
}

function detailNormalTexture(N = 256) {
  const data = new Uint8Array(N * N * 4);
  const waves = []; let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 28; i++) {
    const f = 2 + Math.floor(rnd() * (6 + i * 1.2)); const a = rnd() * Math.PI * 2;
    const kx = Math.round(Math.cos(a) * f), ky = Math.round(Math.sin(a) * f);
    if (!kx && !ky) continue;
    waves.push({ kx, ky, amp: 1 / Math.pow(Math.hypot(kx, ky), 1.25), ph: rnd() * Math.PI * 2 });
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let dx = 0, dy = 0, h = 0;
    for (const w of waves) {
      const t = 2 * Math.PI * (w.kx * x + w.ky * y) / N + w.ph;
      const c = Math.cos(t) * w.amp * 2 * Math.PI / N * N / 6;
      dx += c * w.kx / 8; dy += c * w.ky / 8; h += Math.sin(t) * w.amp;
    }
    const n = new THREE.Vector3(-dx, -dy, 1).normalize();
    const o = (y * N + x) * 4;
    data[o] = (n.x * 0.5 + 0.5) * 255; data[o + 1] = (n.y * 0.5 + 0.5) * 255; data[o + 2] = (n.z * 0.5 + 0.5) * 255; data[o + 3] = clamp01(h * 0.25 + 0.5) * 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8; t.needsUpdate = true;
  return t;
}

const WATER_PARS = /* glsl */`
uniform float uTime, uAmp, uSea;
uniform vec4 uWaves[ ${WAVES.length} ];
uniform highp sampler2D uHTex;  // world terrain heightfield (R32F, nearest), 0 if unavailable
uniform vec4 uHRect;            // half size, cell size, grid cells, valid
varying vec3 vWaterWorld; varying vec3 vWaterN; varying float vJac; varying float vCrest;
float sbTerrainH( vec2 xz ) {
  if ( uHRect.w < 0.5 ) return -60.0;
  vec2 u = ( xz + uHRect.x ) / uHRect.y;
  if ( any( lessThan( u, vec2( 0.0 ) ) ) || any( greaterThan( u, vec2( uHRect.z - 1.0 ) ) ) ) return -90.0;
  vec2 i = floor( u ); vec2 f = u - i; ivec2 c = ivec2( i );
  float h00 = texelFetch( uHTex, c, 0 ).r, h10 = texelFetch( uHTex, c + ivec2( 1, 0 ), 0 ).r;
  float h01 = texelFetch( uHTex, c + ivec2( 0, 1 ), 0 ).r, h11 = texelFetch( uHTex, c + ivec2( 1, 1 ), 0 ).r;
  return mix( mix( h00, h10, f.x ), mix( h01, h11, f.x ), f.y );
}
`;

// ---------------------------------------------------------------- post: grade
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uExposure: { value: 1 }, uVignette: { value: 0.32 }, uCA: { value: 0.0025 }, uSat: { value: 1.08 },
    uContrast: { value: 1.06 }, uLift: { value: new THREE.Vector3(-0.004, 0.0, 0.012) }, uGain: { value: new THREE.Vector3(1.04, 1.0, 0.95) },
    uTime: { value: 0 }, uUnder: { value: 0 }, uFlash: { value: 0 }, uAspect: { value: 1.7 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse; uniform float uExposure, uVignette, uCA, uSat, uContrast, uTime, uUnder, uFlash, uAspect;
uniform vec3 uLift, uGain; varying vec2 vUv;
vec3 sbRRTFit( vec3 v ) { vec3 a = v * ( v + 0.0245786 ) - 0.000090537; vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081; return a / b; }
vec3 sbAces( vec3 color ) {
  const mat3 ACESInputMat = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
  const mat3 ACESOutputMat = mat3( vec3( 1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 ) );
  color = ACESInputMat * ( color / 0.6 ); color = sbRRTFit( color ); color = ACESOutputMat * color; return clamp( color, 0.0, 1.0 );
}
vec3 toSRGB( vec3 c ) { return mix( c * 12.92, 1.055 * pow( c, vec3( 0.41666 ) ) - 0.055, step( 0.0031308, c ) ); }
vec3 sbSafe( vec3 c ) { uvec3 b = floatBitsToUint( c ); bvec3 bad = equal( b & 0x7f800000u, uvec3( 0x7f800000u ) ); return clamp( mix( c, vec3( 0.0 ), bad ), 0.0, 512.0 ); }
float hash( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
void main() {
  vec2 dc = vUv - 0.5; float r2 = dot( dc, dc );
  vec2 uv = vUv;
  if ( uUnder > 0.0 ) uv += vec2( sin( vUv.y * 40.0 + uTime * 2.0 ), cos( vUv.x * 30.0 + uTime * 1.7 ) ) * 0.0015 * uUnder;
  vec3 col;
  if ( uCA > 0.0 ) { vec2 off = dc * r2 * uCA * 4.0; col = vec3( texture2D( tDiffuse, uv - off ).r, texture2D( tDiffuse, uv ).g, texture2D( tDiffuse, uv + off ).b ); }
  else col = texture2D( tDiffuse, uv ).rgb;
  col = sbSafe( col );
  col *= uExposure * ( 1.0 + uFlash );
  if ( uUnder > 0.0 ) { float l = dot( col, vec3( 0.3, 0.5, 0.2 ) ); col = mix( col, vec3( 0.02, 0.16, 0.2 ) * ( 0.5 + l * 2.0 ), uUnder * 0.85 ); }
  col = toSRGB( sbAces( col ) );
  col = clamp( col * uGain + uLift * ( 1.0 - col ), 0.0, 1.0 );
  float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
  col = mix( vec3( l ), col, uSat );
  col = mix( col, col * col * ( 3.0 - 2.0 * col ), uContrast - 1.0 );
  float v = length( dc * vec2( uAspect, 1.0 ) / sqrt( 1.0 + uAspect * uAspect ) * 2.0 );
  col *= mix( 1.0, ( 1.0 - smoothstep( 0.35, 1.25, v ) ), uVignette );
  col += ( hash( gl_FragCoord.xy + fract( uTime ) * 100.0 ) - 0.5 ) * ( 1.5 / 255.0 );
  gl_FragColor = vec4( col, 1.0 );
}`,
};

const TIERS = {
  high: { pr: 1.5, msaa: 4, aa: null, shadow: 2048, shadowFar: 420, bloom: true, ca: true, cloudQ: 5 },
  med: { pr: 1.0, msaa: 0, aa: 'smaa', shadow: 2048, shadowFar: 300, bloom: true, ca: true, cloudQ: 4 },
  low: { pr: 1.0, prHiDPI: 0.75, msaa: 0, aa: 'fxaa', shadow: 1024, shadowFar: 220, bloom: false, ca: false, cloudQ: 3 },
};
// Accepts UI/URL spellings: 'medium' -> 'med', 'ultra' -> 'high'. Returns null for anything unknown.
const tierName = q => { q = String(q || '').toLowerCase(); q = q === 'medium' ? 'med' : q === 'ultra' ? 'high' : q; return TIERS[q] ? q : null; };
const tierPR = T => (devicePixelRatio || 1) > 1.25 && T.prHiDPI ? T.prHiDPI : Math.min(devicePixelRatio || 1, T.pr);
const QKEY = 'stormbreak.quality';
const lsGet = () => { try { return localStorage.getItem(QKEY); } catch (e) { return null; } };
const lsSet = v => { try { localStorage.setItem(QKEY, v); } catch (e) { /* private mode */ } };

// ================================================================ module
const gfx = {
  name: 'gfx',
  async init(game) {
    const { renderer, scene, camera } = game;
    const params = game.params || new URLSearchParams(location.search);
    patchFogChunks();
    const api = game.gfx = {};
    const sunDir = new THREE.Vector3(0, 1, 0), moonDir = new THREE.Vector3(0, -1, 0);
    let hour = +(params.get('time') ?? 16.5); if (!isFinite(hour)) hour = 16.5; // late afternoon: warm light, ~10 real min to sunset
    let quality = 'high', usePost = !params.has('nopost');

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    scene.fog = new THREE.FogExp2(0xb9cadb, 0.00025);

    // ----- lights
    const sun = new SunLight(0xffffff, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 520;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; sun.shadow.radius = 2;
    scene.add(sun);
    const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x6b5a45, 0.25);
    scene.add(hemi);

    // ----- sky
    const skyU = {
      uSunDir: { value: sunDir }, uMoonDir: { value: moonDir }, uRayleigh: { value: 1.6 }, uTurbidity: { value: 3 }, uMieCoef: { value: 0.0038 },
      uSkyScale: { value: 0.009 }, uMieG: { value: 0.86 }, uStarRot: { value: 0 }, uSunColor: { value: new THREE.Color(1, 1, 1) }, uSkyAmb: { value: new THREE.Color(0.5, 0.6, 0.75) },
      uFogColor: { value: new THREE.Color() }, uFogSunColor: { value: new THREE.Color() }, uGround: { value: new THREE.Color(0.1, 0.09, 0.07) },
      uTime: { value: 0 }, uNight: { value: 0 }, uEnvPass: { value: 0 }, uCoverage: { value: 0.42 }, uCloudH: { value: 1900 }, uCirrus: { value: 0.6 },
      uCloudQ: { value: 5 }, uDay: { value: 1 }, uWind: { value: new THREE.Vector2(0.0035, 0.0012) }, uFog: { value: new THREE.Vector4(0, 0, 0, 0.8) },
    };
    const skyMat = new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
    const skyGeo = new THREE.SphereGeometry(1, 48, 24);
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.frustumCulled = false; sky.renderOrder = 1e9; sky.name = 'gfx-sky';
    scene.add(sky);
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(skyGeo, skyMat); envSky.frustumCulled = false; envScene.add(envSky);
    const pmrem = new THREE.PMREMGenerator(renderer);
    let envRT = null, lastBakeDir = new THREE.Vector3(9, 9, 9), lastBakeTime = -1e9;
    function bakeEnv() {
      skyU.uEnvPass.value = 1;
      const rt = pmrem.fromScene(envScene, 0, 0.1, 100, { size: 128 });
      skyU.uEnvPass.value = 0;
      scene.environment = rt.texture;
      envRT?.dispose(); envRT = rt;
      lastBakeDir.copy(sunDir); lastBakeTime = performance.now();
    }

    // ----- ocean
    const detailTex = detailNormalTexture();
    const heightTexDummy = new THREE.DataTexture(new Float32Array([-60]), 1, 1, THREE.RedFormat, THREE.FloatType); heightTexDummy.needsUpdate = true;
    function hookHeights() { // world builds after gfx: pick up its heightfield texture once it exists
      const T = game.world?.terrain, tex = T?.heightTex;
      if (!tex || waterU.uHTex.value === tex) return;
      waterU.uHTex.value = tex;
      waterU.uHRect.value.set(game.world.half ?? 4096, (2 * (game.world.half ?? 4096)) / (tex.image.width - 1), tex.image.width, 1);
    }
    const waterU = {
      uTime: { value: 0 }, uAmp: { value: 1 }, uWaves: { value: WAVES.map(w => new THREE.Vector4(w.x, w.z, w.s, w.l)) },
      uHTex: { value: heightTexDummy }, uHRect: { value: new THREE.Vector4(4096, 4, 2049, 0) },
      uDetail: { value: detailTex }, uSunI: { value: new THREE.Color() }, uSunDirW: { value: sunDir }, uFoamAmt: { value: 1 },
      uDeep: { value: srgb('#062a3e') }, uMid: { value: srgb('#0d6a78') }, uShallow: { value: srgb('#45c4b0') }, uSea: { value: 0 },
    };
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x0b4f6c, roughness: 0.06, metalness: 0, transparent: true, premultipliedAlpha: true });
    waterMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, waterU);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + WATER_PARS)
        .replace('#include <beginnormal_vertex>', /* glsl */`
          vec3 sbWP = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
          float sbDist = length( sbWP.xz - cameraPosition.xz );
          float sbDepth = uSea - sbTerrainH( sbWP.xz );
          float sbShoal = smoothstep( 0.0, 5.0, sbDepth ) * uAmp;
          vec3 sbDisp = vec3( 0.0 ); vec3 sbT = vec3( 1.0, 0.0, 0.0 ), sbB = vec3( 0.0, 0.0, 1.0 ); float sbCr = 0.0;
          for ( int i = 0; i < ${WAVES.length}; i ++ ) {
            vec4 w = uWaves[ i ];
            float k = 6.2831853 / w.w; float c = sqrt( 9.8 / k );
            float st = w.z * sbShoal * ( 1.0 - smoothstep( w.w * 7.0, w.w * 22.0, sbDist ) );
            float f = k * ( dot( w.xy, sbWP.xz ) - c * uTime );
            float a = st / k; float sf = sin( f ), cf = cos( f );
            sbDisp += vec3( w.x * a * cf, a * sf, w.y * a * cf );
            sbT += vec3( - w.x * w.x * st * sf, w.x * st * cf, - w.x * w.y * st * sf );
            sbB += vec3( - w.x * w.y * st * sf, w.y * st * cf, - w.y * w.y * st * sf );
            sbCr += st * sf;
          }
          vec3 sbN = normalize( cross( sbB, sbT ) );
          vWaterN = sbN; vWaterWorld = sbWP + sbDisp; vJac = sbT.x * sbB.z - sbT.z * sbB.x; vCrest = sbCr;
          #include <beginnormal_vertex>
          objectNormal = sbN;`)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += sbDisp;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + WATER_PARS + NOISE + /* glsl */`
          uniform sampler2D uDetail; uniform vec3 uSunI, uSunDirW, uDeep, uMid, uShallow; uniform float uFoamAmt;
          float sbFoam = 0.0; float sbWDist = 0.0;`)
        .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
          {
            sbWDist = length( vWaterWorld - cameraPosition );
            float depth = uSea - sbTerrainH( vWaterWorld.xz );
            vec3 body = mix( uShallow, uMid, smoothstep( 0.5, 7.0, depth ) );
            body = mix( body, uDeep, smoothstep( 6.0, 40.0, depth ) );
            float n1 = sbNoise( vWaterWorld.xz * 0.35 + uTime * 0.15 ) * 0.5 + 0.5;
            float n2 = sbNoise( vWaterWorld.xz * 1.3 - uTime * 0.2 ) * 0.5 + 0.5;
            float n3 = sbNoise( vWaterWorld.xz * 0.09 - uTime * 0.05 ) * 0.5 + 0.5;
            // lacy shore foam: thin line at the waterline + surf bands that roll in and break up
            float shore = ( 1.0 - smoothstep( 0.0, 0.45 + n3 * 0.35, depth ) ) * smoothstep( 0.25, 0.65, n2 * 0.7 + n1 * 0.5 );
            float wave = sin( depth * 3.2 - uTime * 1.4 + n1 * 2.5 + n3 * 4.0 ) * 0.5 + 0.5;
            float bands = smoothstep( 0.82, 0.97, wave ) * ( 1.0 - smoothstep( 0.6, 2.2, depth ) ) * smoothstep( 0.05, 0.35, depth ) * smoothstep( 0.35, 0.7, n2 );
            float crest = ( 1.0 - smoothstep( 0.45, 0.78, vJac ) ) * smoothstep( 0.15, 0.35, vCrest );
            sbFoam = clamp( ( shore * 0.9 + bands * 0.75 + crest * n1 * n2 * 1.2 ) * uFoamAmt, 0.0, 1.0 );
            sbFoam *= 1.0 - smoothstep( 250.0, 700.0, sbWDist );
            diffuseColor.rgb = mix( body, vec3( 0.92, 0.95, 0.95 ), sbFoam );
            float a = mix( 0.18, 1.0, smoothstep( 0.0, 6.0, depth ) );
            diffuseColor.a = max( a, sbFoam );
          }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( mix( 0.07, 0.2, smoothstep( 60.0, 2500.0, sbWDist ) ), 0.7, sbFoam );')
        .replace('#include <normal_fragment_maps>', /* glsl */`
          {
            vec3 nW = normalize( vWaterN );
            float fadeD = 1.0 - smoothstep( 80.0, 1200.0, sbWDist );
            vec2 uv1 = vWaterWorld.xz * 0.06 + uTime * vec2( 0.021, 0.013 );
            vec2 uv2 = mat2( 0.8, -0.6, 0.6, 0.8 ) * vWaterWorld.xz * 0.019 - uTime * vec2( 0.006, 0.014 );
            vec2 uv3 = vWaterWorld.xz * 0.2 + uTime * vec2( -0.03, 0.04 );
            vec3 t1 = texture2D( uDetail, uv1 ).xyz * 2.0 - 1.0, t2 = texture2D( uDetail, uv2 ).xyz * 2.0 - 1.0, t3 = texture2D( uDetail, uv3 ).xyz * 2.0 - 1.0;
            vec2 dxy = ( t1.xy * 0.55 + t2.xy * 0.6 + t3.xy * 0.3 * fadeD ) * mix( 0.1, 0.32, fadeD );
            nW = normalize( nW + vec3( dxy.x, 0.0, dxy.y ) );
            normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
          }`)
        .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
          {
            vec3 vd = normalize( vWaterWorld - cameraPosition );
            float sss = pow( max( dot( vd, uSunDirW ), 0.0 ), 3.0 ) * 0.0 + pow( max( dot( vd, - uSunDirW ) * -1.0, 0.0 ), 4.0 );
            float hgt = clamp( vCrest * 2.0 + 0.3, 0.0, 1.0 );
            float scat = pow( clamp( dot( vd, uSunDirW ) * 0.5 + 0.5, 0.0, 1.0 ), 3.0 ) * hgt;
            totalEmissiveRadiance += uShallow * uSunI * scat * 0.08 * ( 1.0 - sbFoam );
          }`)
        .replace('#include <opaque_fragment>', /* glsl */`
          gl_FragColor = vec4( ( outgoingLight - totalSpecular ) * diffuseColor.a + totalSpecular, diffuseColor.a );`);
    };
    const water = new THREE.Mesh(waterGeometry(192, 5600), waterMat);
    water.frustumCulled = false; water.renderOrder = -1; water.receiveShadow = true; water.name = 'gfx-ocean';
    scene.add(water);

    function seaLevel() { return game.world?.seaLevel ?? 0; }
    const _p = { x: 0, z: 0 };
    function gerstner(x, z, out, camDist, shoal) {
      let dx = 0, dy = 0, dz = 0; const t = waterU.uTime.value;
      for (const w of WAVES) {
        const st = w.s * shoal * (1 - smooth(w.l * 7, w.l * 22, camDist));
        if (st <= 0) continue;
        const f = w.k * (w.x * x + w.z * z - w.c * t), a = st / w.k;
        const cf = Math.cos(f);
        dx += w.x * a * cf; dy += a * Math.sin(f); dz += w.z * a * cf;
      }
      out.x = dx; out.y = dy; out.z = dz; return out;
    }
    const _d = { x: 0, y: 0, z: 0 };
    api.waterHeightAt = (x, z) => {
      const sea = seaLevel();
      const camDist = Math.hypot(x - camera.position.x, z - camera.position.z);
      const th = game.world?.heightAt ? +game.world.heightAt(x, z) : -60;
      const shoal = smooth(0, 5, sea - (isFinite(th) ? th : -60)) * waterU.uAmp.value;
      if (shoal <= 0) return sea;
      let px = x, pz = z;
      for (let i = 0; i < 2; i++) { gerstner(px, pz, _d, camDist, shoal); px = x - _d.x; pz = z - _d.z; }
      gerstner(px, pz, _d, camDist, shoal);
      return sea + _d.y;
    };

    // ----- post
    let composer = null, renderPass, bloom, grade, aaPass, gtao = null, wantAO = params.get('ao') === '1';
    function buildComposer() {
      const T = TIERS[quality];
      composer?.renderTarget1?.dispose(); composer?.renderTarget2?.dispose();
      const pr = tierPR(T);
      renderer.setPixelRatio(pr);
      const w = innerWidth, h = innerHeight;
      const rt = new THREE.WebGLRenderTarget(Math.floor(w * pr), Math.floor(h * pr), { type: THREE.HalfFloatType, samples: T.msaa });
      composer = new EffectComposer(renderer, rt);
      composer.setPixelRatio(pr); composer.setSize(w, h);
      renderPass = new RenderPass(scene, camera);
      composer.addPass(renderPass);
      if (gtao) composer.addPass(gtao);
      bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.26, 0.5, 1.6);
      bloom.enabled = T.bloom;
      // NaN/Inf guard: one non-finite scene pixel (e.g. an object with a NaN transform) is blurred by the bloom
      // mip chain across the whole frame and turns it black. Sanitize the bloom input bit-exactly
      // (isnan() can be optimised away by Metal fast-math).
      bloom.materialHighPassFilter.fragmentShader = bloom.materialHighPassFilter.fragmentShader.replace(
        'vec4 texel = texture2D( tDiffuse, vUv );',
        'vec4 texel = texture2D( tDiffuse, vUv ); { uvec4 sbB = floatBitsToUint( texel ); texel = clamp( mix( texel, vec4( 0.0 ), equal( sbB & 0x7f800000u, uvec4( 0x7f800000u ) ) ), 0.0, 64.0 ); }');
      bloom.materialHighPassFilter.needsUpdate = true;
      composer.addPass(bloom);
      grade = grade || new ShaderPass(GradeShader);
      grade.uniforms.uCA.value = T.ca ? 0.0025 : 0;
      composer.addPass(grade);
      aaPass = T.aa === 'smaa' ? new SMAAPass() : T.aa === 'fxaa' ? new FXAAPass() : null;
      if (aaPass) composer.addPass(aaPass);
      composer.setSize(w, h);
    }
    async function setAO(on) {
      wantAO = !!on;
      if (on && !gtao) {
        try {
          const { GTAOPass } = await import('three/addons/postprocessing/GTAOPass.js');
          gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
          gtao.output = GTAOPass.OUTPUT.Default; gtao.blendIntensity = 0.8;
          gtao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.5, thickness: 2, scale: 1, samples: 12 });
        } catch (e) { console.warn('[gfx] GTAO unavailable', e); gtao = null; }
      } else if (!on) gtao = null;
      if (usePost) buildComposer();
    }

    function applyQuality() {
      const T = TIERS[quality];
      if (sun.shadow.mapSize.x !== T.shadow) { sun.shadow.mapSize.set(T.shadow, T.shadow); sun.shadow.map?.dispose(); sun.shadow.map = null; }
      sun.shadow.camera.far = T.shadowFar;
      skyU.uCloudQ.value = T.cloudQ;
      if (usePost) buildComposer(); else renderer.setPixelRatio(tierPR(T));
    }

    addEventListener('resize', () => {
      if (composer) { composer.setSize(innerWidth, innerHeight); bloom?.setSize(innerWidth / 2, innerHeight / 2); }
      gtao?.setSize?.(innerWidth, innerHeight);
    });

    // ----- shake / flash
    const shakes = [];
    let flash = 0;
    const savedPos = new THREE.Vector3(), savedQuat = new THREE.Quaternion(), shakeEuler = new THREE.Euler(), shakeQ = new THREE.Quaternion();

    // ----- time of day
    const fogDay = srgb('#a4bbd0'), fogSet = srgb('#e2ab86'), fogTwi = srgb('#4d5372'), fogNight = srgb('#0d1424');
    const inDay = srgb('#fff0d4'), inSet = srgb('#ff8c42'), inNight = srgb('#22304f');
    const tmpC = new THREE.Color(), tmpC2 = new THREE.Color();
    const betaR = [5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5];
    const mieK = [1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14];
    let nightFlag = null;

    function bodyDir(hourAngle, decl, out) {
      const e = -Math.cos(decl) * Math.sin(hourAngle);
      const n = Math.sin(decl) * Math.cos(LAT) - Math.cos(decl) * Math.cos(hourAngle) * Math.sin(LAT);
      const u = Math.sin(decl) * Math.sin(LAT) + Math.cos(decl) * Math.cos(hourAngle) * Math.cos(LAT);
      return out.set(e, u, -n).normalize();
    }
    function transmittance(dirY, out) {
      const zen = Math.acos(Math.max(0, dirY)); const zd = zen * 180 / Math.PI;
      const inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(Math.max(93.885 - zd, 0.001), -1.253));
      const T = skyU.uTurbidity.value, rl = skyU.uRayleigh.value, mc = skyU.uMieCoef.value;
      const c = [0, 1, 2].map(i => Math.exp(-(betaR[i] * rl * 8400 * inv + 0.434 * 0.2 * T * 1e-17 * mieK[i] * mc * 1250 * inv)));
      return out.setRGB(c[0], c[1], c[2]);
    }

    function updateTime() {
      const H = (hour - 12) * 15 * Math.PI / 180;
      bodyDir(H, DECL, sunDir);
      bodyDir(H + Math.PI * 0.92, -0.12, moonDir);
      const se = sunDir.y; // sine of elevation
      const day = smooth(-0.1, 0.12, se);
      const nightF = 1 - smooth(-0.2, 0.02, se);
      api.daylight = day;
      skyU.uNight.value = nightF;
      skyU.uDay.value = day;
      skyU.uStarRot.value = -H;
      skyU.uRayleigh.value = 1.5 + 1.4 * (1 - smooth(0.0, 0.35, se));
      skyU.uTurbidity.value = 2.8 + 1.5 * (1 - smooth(0.0, 0.3, se));
      // sun colour from atmospheric transmittance
      transmittance(se + 0.02, tmpC);
      const sunVis = smooth(-0.035, 0.03, se);
      skyU.uSunColor.value.copy(tmpC).multiplyScalar(sunVis);
      // key light: sun by day, moon by night
      const moonVis = smooth(-0.02, 0.15, moonDir.y) * nightF;
      if (se > -0.03) {
        sun.position.copy(sunDir);
        // golden-hour warmth on top of the analytic transmittance (Mediterranean afternoons read warm)
        const warmK = smooth(0.12, 0.75, se);
        sun.color.copy(tmpC).multiply(tmpC2.setRGB(1, 0.86 + 0.11 * warmK, 0.7 + 0.22 * warmK));
        sun.intensity = 3.4 * smooth(-0.03, 0.06, se);
      } else {
        sun.position.copy(moonDir);
        sun.color.setRGB(0.55, 0.68, 1.0);
        sun.intensity = 0.32 * moonVis;
      }
      sun.updateMatrixWorld();
      sun.castShadow = sun.intensity > 0.01;
      // fog / haze palette
      if (se > 0.05) tmpC2.copy(fogSet).lerp(fogDay, smooth(0.05, 0.4, se));
      else if (se > -0.1) tmpC2.copy(fogTwi).lerp(fogSet, smooth(-0.1, 0.05, se));
      else tmpC2.copy(fogNight).lerp(fogTwi, smooth(-0.25, -0.1, se));
      scene.fog.color.copy(tmpC2);
      skyU.uFogColor.value.copy(tmpC2);
      const inC = se > -0.05 ? tmpC.copy(inSet).lerp(inDay, smooth(0.05, 0.45, se)) : tmpC.copy(inNight);
      skyU.uFogSunColor.value.copy(inC);
      const dirForFog = se > -0.05 ? sunDir : moonDir;
      Object.assign(FOGU.sbFogSun.value, { x: dirForFog.x, y: dirForFog.y, z: dirForFog.z, w: se > -0.05 ? 0.6 : 0.25 });
      Object.assign(FOGU.sbFogSunColor.value, { x: inC.r, y: inC.g, z: inC.b });
      skyU.uFog.value.w = FOGU.sbFogSun.value.w;
      // ambient
      tmpC.setRGB(0.42, 0.55, 0.78).multiplyScalar(0.25 + 0.75 * day).lerp(srgb('#1a2238'), nightF * 0.8);
      skyU.uSkyAmb.value.copy(tmpC).multiplyScalar(0.6 + 0.4 * day);
      skyU.uSkyAmb.value.lerp(skyU.uSunColor.value.clone().multiplyScalar(0.35), (1 - smooth(0.0, 0.25, se)) * sunVis);
      hemi.color.setRGB(0.72, 0.78, 0.92).lerp(tmpC2.setRGB(0.25, 0.32, 0.55), nightF);
      hemi.groundColor.setRGB(0.42, 0.34, 0.25).multiplyScalar(0.3 + 0.7 * day);
      hemi.intensity = 0.18 + 0.12 * day + 0.25 * nightF;
      skyU.uGround.value.setRGB(0.12, 0.1, 0.08).multiplyScalar(0.15 + day);
      scene.environmentIntensity = 0.9 + 0.6 * nightF;
      api.exposure = api.exposure ?? 1;
      const expo = (1 + 1.3 * nightF) * api.exposure;
      renderer.toneMappingExposure = expo;
      if (grade) grade.uniforms.uExposure.value = expo;
      waterU.uSunI.value.copy(sun.color).multiplyScalar(sun.intensity);
      const isNight = se < -0.06;
      if (isNight !== nightFlag) { nightFlag = isNight; api.isNight = isNight; game.events?.emit?.('timeofday', { hour, night: isNight }); }
    }

    // ----- fps-driven auto quality
    // Priority: ?quality=low|medium|high  >  saved choice (localStorage)  >  auto (High on desktop, Medium on touch
    // devices; drops to Medium once if the first ~3 s of play average under 45 fps, then stays put).
    const forced = tierName(params.get('quality')), saved = tierName(lsGet());
    let auto = !forced && !saved;
    if (forced) quality = forced; else if (saved) quality = saved;
    else if (matchMedia?.('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) quality = 'med';
    const perf = { frames: 0, t0: 0, slow: 0, lastChange: 0, last: performance.now() };
    function autoTune(now) {
      if (!auto || !game.ready || document.hidden) { perf.frames = 0; perf.t0 = now; return; }
      perf.frames++;
      if (!perf.t0) perf.t0 = now;
      const span = now - perf.t0;
      if (span < 3000) return;
      const fps = perf.frames * 1000 / span; perf.frames = 0; perf.t0 = now;
      api.fps = fps;
      auto = false; // one-shot decision
      if (fps < 45 && quality === 'high') { quality = 'med'; applyQuality(); console.info('[gfx] auto quality ->', quality, fps.toFixed(1) + 'fps'); }
      game.events?.emit?.('gfx:quality', { quality, auto: true });
    }

    // ----- central shadow-caster distance culling for meshes other modules own (vehicles, enemies, props, weapons).
    // World/gfx objects are tagged userData.sbOwner by their builders and left alone. We only ever turn casting OFF for
    // far meshes and remember that we did (userData.__sbCull) so they cast again when the camera comes back.
    let shadowFrame = 0, playStarted = false;
    const ownGfx = new Set();
    api.shadowCull = { culled: 0, active: 0 };
    function cullShadows() {
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, D2 = api.shadowCullDist ** 2;
      let culled = 0, active = 0;
      const visit = (o) => {
        if (o.isMesh || o.isSkinnedMesh || o.isInstancedMesh) {
          const ud = o.userData;
          if (o.castShadow || ud.__sbCull) {
            const e = o.matrixWorld.elements, dx = e[12] - cx, dy = e[13] - cy, dz = e[14] - cz;
            let r = 0; if (o.isInstancedMesh) r = 1e9; // instanced sets span space; leave them to their owner
            else if (o.geometry?.boundingSphere) r = o.geometry.boundingSphere.radius * Math.max(e[0], e[5], e[10], 1);
            const far = dx * dx + dy * dy + dz * dz > D2 + r * r * 4 + 2 * Math.sqrt(D2) * r * 2;
            if (far && o.castShadow) { o.castShadow = false; ud.__sbCull = true; }
            else if (!far && ud.__sbCull) { o.castShadow = true; ud.__sbCull = false; }
            if (ud.__sbCull) culled++; else if (o.castShadow) active++;
          }
        }
        const ch = o.children; for (let i = 0; i < ch.length; i++) visit(ch[i]);
      };
      for (const c of scene.children) { if (c.userData.sbOwner === 'world' || ownGfx.has(c)) continue; visit(c); }
      api.shadowCull.culled = culled; api.shadowCull.active = active;
    }

    // ----- public API
    // defineProperties, not Object.assign: assign would snapshot the getters (timeOfDay read as a frozen 16.6 for everyone)
    Object.defineProperties(api, Object.getOwnPropertyDescriptors({
      sun, hemi, sky, water, sunDir, moonDir, seaLevel: 0, envScene,
      csm: { setupMaterial() {}, lights: [sun], update() {} },
      get timeOfDay() { return hour; }, set timeOfDay(h) { api.setTimeOfDay(h); },
      dayMinutes: 48, timeSpeed: 1, nightSpeed: 2.2, goldenSpeed: 0.5, // night runs faster, the late-afternoon golden hour slower (~10 real min of it)
      shadowCullDist: 90, // meshes not owned by world/gfx stop casting sun shadows beyond this (m) from the camera
      setTimeOfDay(h) { hour = ((+h % 24) + 24) % 24; updateTime(); bakeEnv(); },
      get quality() { return quality; },
      get autoQuality() { return auto; }, set autoQuality(v) { auto = !!v; },
      // setQuality('low'|'medium'|'med'|'high') persists the choice; setQuality('auto') clears it (next load re-detects).
      setQuality(q) {
        if (String(q).toLowerCase() === 'auto') { lsSet('auto'); return; }
        const t = tierName(q); if (!t) return;
        auto = false; lsSet(t); if (t !== quality) { quality = t; applyQuality(); }
        game.events?.emit?.('gfx:quality', { quality, auto: false });
      },
      get qualityLabel() { return quality === 'med' ? 'medium' : quality; },
      setAO, get post() { return usePost; },
      setPost(on) { usePost = !!on; if (usePost) buildComposer(); },
      fog: { get density() { return FOGU.sbFogParams.value.x; }, set density(v) { FOGU.sbFogParams.value.x = v; },
        get falloff() { return FOGU.sbFogParams.value.y; }, set falloff(v) { FOGU.sbFogParams.value.y = v; },
        get base() { return FOGU.sbFogParams.value.z; }, set base(v) { FOGU.sbFogParams.value.z = v; } },
      clouds: { get coverage() { return skyU.uCoverage.value; }, set coverage(v) { skyU.uCoverage.value = v; } },
      waves: { get amplitude() { return waterU.uAmp.value; }, set amplitude(v) { waterU.uAmp.value = v; } },
      shake(intensity = 0.5, duration = 0.4) { if (intensity > 0 && duration > 0) shakes.push({ i: intensity, d: duration, t: 0, seed: Math.random() * 100 }); if (shakes.length > 12) shakes.shift(); },
      shakeAt(pos, intensity = 1, duration = 0.6, radius = 60) {
        const d = pos ? camera.position.distanceTo(pos) : 0;
        const f = Math.max(0, 1 - d / radius); if (f > 0) api.shake(intensity * f * f, duration);
      },
      flash(a = 0.5) { flash = Math.min(2, flash + a); },
      composer: () => composer,
      bakeEnv,
      playStartHour: hour, // gameplay begins here even if the title sequence posed the clock elsewhere (camera sets golden hour)
      _tick(dt) {
        if (!playStarted && game.state === 'play') { playStarted = true; if (Number.isFinite(api.playStartHour)) api.setTimeOfDay(api.playStartHour); }
        const se = sunDir.y, golden = smooth(-0.02, 0.08, se) * (1 - smooth(0.38, 0.55, se));
        const step = dt * api.timeSpeed * 24 / (api.dayMinutes * 60) * (1 + (api.nightSpeed - 1) * skyU.uNight.value) * (1 - (1 - api.goldenSpeed) * golden);
        skyU.uTime.value += dt; waterU.uTime.value += dt;
        if (step) { hour = (((hour + step) % 24) + 24) % 24; updateTime(); }
        if (sunDir.angleTo(lastBakeDir) > 0.012 || performance.now() - lastBakeTime > 10000) bakeEnv();
      },
      render() {
        const now = performance.now();
        const rdt = Math.min(0.1, (now - perf.last) / 1000); perf.last = now;
        autoTune(now);
        if ((++shadowFrame & 7) === 0) cullShadows();
        // follow camera
        hookHeights();
        water.position.set(camera.position.x, seaLevel(), camera.position.z);
        waterU.uSea.value = seaLevel();
        water.updateMatrixWorld();
        // underwater
        const under = camera.position.y < api.waterHeightAt(camera.position.x, camera.position.z) - 0.05;
        // shake
        let amp = 0;
        for (let i = shakes.length - 1; i >= 0; i--) {
          const s = shakes[i]; s.t += rdt;
          if (s.t >= s.d) { shakes.splice(i, 1); continue; }
          const k = 1 - s.t / s.d; amp += s.i * k * k;
        }
        amp = Math.min(amp, 2.5);
        const shaking = amp > 0.001 && !game.paused;
        if (shaking) {
          savedPos.copy(camera.position); savedQuat.copy(camera.quaternion);
          const t = now / 1000;
          const n = (f, p) => Math.sin(t * f + p) * 0.6 + Math.sin(t * f * 2.13 + p * 1.7) * 0.4;
          camera.position.x += n(23, 1) * amp * 0.12; camera.position.y += n(29, 2) * amp * 0.12; camera.position.z += n(19, 3) * amp * 0.12;
          shakeEuler.set(n(31, 4) * amp * 0.025, n(27, 5) * amp * 0.025, n(17, 6) * amp * 0.018);
          camera.quaternion.multiply(shakeQ.setFromEuler(shakeEuler));
          camera.updateMatrixWorld();
        }
        flash = Math.max(0, flash - rdt * 4);
        if (usePost && composer) {
          grade.uniforms.uTime.value = now / 1000;
          grade.uniforms.uUnder.value = under ? 1 : 0;
          grade.uniforms.uFlash.value = flash;
          grade.uniforms.uAspect.value = innerWidth / innerHeight;
          composer.render(rdt);
        } else {
          const e = renderer.toneMappingExposure; renderer.toneMappingExposure = e * (1 + flash);
          renderer.render(scene, camera);
          renderer.toneMappingExposure = e;
        }
        if (shaking) { camera.position.copy(savedPos); camera.quaternion.copy(savedQuat); camera.updateMatrixWorld(); }
      },
    }));

    for (const o of [sky, water, sun, hemi]) ownGfx.add(o);
    if (usePost) buildComposer();
    applyQuality();
    if (wantAO) await setAO(true);
    updateTime();
    bakeEnv();
    game.render = api.render;
  },

  update(dt, game) { game.gfx?._tick?.(dt); },
};

export default gfx;
