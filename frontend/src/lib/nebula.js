/**
 * The 3D nebula behind the splash, Home and /start: an ILLUSTRATION drawn in code (not SPHEREx data; the page
 * says so). Soft gas clouds at many depths and a few thousand stars in the same space; the camera drifts
 * forward slowly, turns a little with the cursor, and speeds through the clouds for the fly-through on Start.
 * Loaded on its own (dynamic import) so Three.js never delays the first paint.
 */
import * as THREE from 'three'

const DEPTH = 900 // how deep the field of clouds and stars is; things that pass the camera wrap to the back
const STARS = 3200
const CLOUDS = 26
const CRUISE = 7 // units per second
const WARP = 340
const COLOURS = ['#8b5cf6', '#c026d3', '#22d3ee', '#14b8a6', '#f59e0b', '#ec4899', '#6366f1', '#3b82f6']

/** A small random generator, so the scene is the same on every visit. */
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A soft, wispy cloud as an alpha texture: fractal value noise under a round fall-off. */
function cloudTexture(seed, size = 256, stretch = 1) {
  const rand = rng(seed)
  const G = 64
  const grid = Float32Array.from({ length: G * G }, rand)
  const at = (x, y) => grid[((y % G) + G) % G * G + (((x % G) + G) % G)]
  const smooth = (t) => t * t * (3 - 2 * t)
  const noise = (x, y) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const fx = smooth(x - xi)
    const fy = smooth(y - yi)
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * fx
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * fx
    return a + (b - a) * fy
  }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(size, size)
  const ox = rand() * 50
  const oy = rand() * 50
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size
      const v = j / size
      let f = 0
      let amp = 0.5
      let freq = 3
      for (let o = 0; o < 5; o++) {
        f += amp * noise(ox + u * freq * stretch, oy + v * freq)
        amp *= 0.5
        freq *= 2.1
      }
      const r = Math.hypot(u - 0.5, v - 0.5) * 2 // 0 centre … 1 edge
      const fall = Math.max(0, 1 - r) ** 1.6
      const a = Math.min(1, Math.max(0, f - 0.4) * 3.2) ** 1.3 * fall
      const k = (j * size + i) * 4
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255
      img.data[k + 3] = Math.min(255, a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const starVertex = /* glsl */ `
  attribute float size;
  attribute float phase;
  attribute vec3 tint;
  uniform float time;
  uniform float pixelRatio;
  uniform float warp;
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float depth = -mv.z;
    gl_PointSize = max(1.5, size * pixelRatio * (560.0 / max(depth, 1.0))) * (1.0 + warp * 1.5);
    vTint = tint;
    vAlpha = (0.65 + 0.35 * sin(time * (0.8 + phase) + phase * 6.28)) * smoothstep(${DEPTH.toFixed(1)}, ${(DEPTH * 0.6).toFixed(1)}, depth);
  }
`
const starFragment = /* glsl */ `
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vTint, a * a * vAlpha);
  }
`

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ still?: boolean }} opts  still: draw one frame and never move ("reduce motion")
 */
export function createNebula(canvas, { still = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, DEPTH * 1.5)
  const rand = rng(20261120)

  // stars: spread through the whole depth, a little more on the right (the headline is on the left)
  const pos = new Float32Array(STARS * 3)
  const size = new Float32Array(STARS)
  const phase = new Float32Array(STARS)
  const tint = new Float32Array(STARS * 3)
  const starTints = ['#ffffff', '#cfe0ff', '#ffe9c8', '#b9d4ff', '#ffd1e8'].map((c) => new THREE.Color(c))
  for (let i = 0; i < STARS; i++) {
    pos[i * 3] = (rand() * 2 - 0.7) * 420
    pos[i * 3 + 1] = (rand() * 2 - 1) * 260
    pos[i * 3 + 2] = -rand() * DEPTH
    size[i] = rand() < 0.05 ? 4 + rand() * 4 : 1 + rand() * 2
    phase[i] = rand()
    starTints[(rand() * starTints.length) | 0].toArray(tint, i * 3)
  }
  const starGeo = new THREE.BufferGeometry()
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  starGeo.setAttribute('size', new THREE.BufferAttribute(size, 1))
  starGeo.setAttribute('phase', new THREE.BufferAttribute(phase, 1))
  starGeo.setAttribute('tint', new THREE.BufferAttribute(tint, 3))
  const starMat = new THREE.ShaderMaterial({
    vertexShader: starVertex,
    fragmentShader: starFragment,
    uniforms: { time: { value: 0 }, pixelRatio: { value: renderer.getPixelRatio() }, warp: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  scene.add(new THREE.Points(starGeo, starMat))

  // clouds: soft sprites at many depths, biased to the right and the middle
  const textures = [
    [11, 1],
    [23, 1.8],
    [37, 1],
    [51, 2.6],
    [67, 1.4],
  ].map(([seed, stretch]) => cloudTexture(seed, 256, stretch))
  const clouds = []
  for (let i = 0; i < CLOUDS; i++) {
    const mat = new THREE.SpriteMaterial({
      map: textures[i % textures.length],
      color: new THREE.Color(COLOURS[(rand() * COLOURS.length) | 0]),
      transparent: true,
      opacity: 0.32 + rand() * 0.38,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      rotation: rand() * Math.PI * 2,
    })
    const s = new THREE.Sprite(mat)
    s.position.set((rand() * 1.6 - 0.35) * 260, (rand() * 2 - 1) * 120, -rand() * DEPTH)
    const k = 180 + rand() * 260
    s.scale.set(k, k * (0.6 + rand() * 0.5), 1)
    s.userData.spin = (rand() - 0.5) * 0.03
    clouds.push(s)
    scene.add(s)
  }

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
  let flying = false
  let speed = CRUISE
  let raf = 0
  let last = 0
  let time = 0

  const resize = () => {
    const w = canvas.clientWidth || 1
    const h = canvas.clientHeight || 1
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  const step = (dt) => {
    time += dt
    speed += ((flying ? WARP : CRUISE) - speed) * Math.min(1, dt * (flying ? 2.2 : 1.4))
    const dz = speed * dt
    const warp = Math.min(1, (speed - CRUISE) / (WARP - CRUISE))
    starMat.uniforms.time.value = time
    starMat.uniforms.warp.value = warp
    camera.fov = 60 + warp * 22
    camera.updateProjectionMatrix()
    // everything moves towards the camera; what passes it goes back to the far end
    const p = starGeo.attributes.position.array
    for (let i = 2; i < p.length; i += 3) {
      p[i] += dz
      if (p[i] > 5) p[i] -= DEPTH
    }
    starGeo.attributes.position.needsUpdate = true
    for (const c of clouds) {
      c.position.z += dz
      if (c.position.z > 20) c.position.z -= DEPTH
      c.material.rotation += c.userData.spin * dt
      // clouds fade in from the distance and out just before the camera
      const near = Math.min(1, Math.max(0, (20 - c.position.z) / 140))
      const far = Math.min(1, Math.max(0, (c.position.z + DEPTH) / (DEPTH * 0.35)))
      c.material.opacity = (c.userData.base ??= c.material.opacity) * near * far
    }
    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 2)
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 2)
    camera.position.x = pointer.x * 10
    camera.position.y = -pointer.y * 6
    camera.rotation.y = -pointer.x * 0.07
    camera.rotation.x = -pointer.y * 0.045
  }

  const frame = (now) => {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0
    last = now
    step(dt)
    renderer.render(scene, camera)
    raf = requestAnimationFrame(frame)
  }

  resize()
  step(0)
  renderer.render(scene, camera)

  return {
    start() {
      if (still || raf) return
      last = 0
      raf = requestAnimationFrame(frame)
    },
    stop() {
      cancelAnimationFrame(raf)
      raf = 0
    },
    resize() {
      resize()
      if (!raf) renderer.render(scene, camera)
    },
    /** -1…1 across the window */
    setPointer(x, y) {
      pointer.tx = x
      pointer.ty = y
    },
    setFlying(on) {
      flying = on
    },
    dispose() {
      cancelAnimationFrame(raf)
      textures.forEach((t) => t.dispose())
      clouds.forEach((c) => c.material.dispose())
      starGeo.dispose()
      starMat.dispose()
      renderer.dispose()
    },
  }
}
