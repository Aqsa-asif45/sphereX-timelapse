import { useCallback, useEffect, useRef, useState } from 'react';
import { lut, STRETCH_ID, type Colormap, type Stretch } from '@/lib/image';
import type { Cutout } from '@/lib/types';

export interface HoverInfo { x: number; y: number; value: number; sigma: number | null; flags: number; ra: number; dec: number }

const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Same stretch formulas as lib/image.ts (tested there). NaN = no data, drawn in the gap colour, never filled.
const FS = `#version 300 es
precision highp float; precision highp int; precision highp isampler2D;
uniform highp sampler2D uImg; uniform isampler2D uFlags; uniform sampler2D uLut;
uniform float uLo; uniform float uHi; uniform int uStretch; uniform int uShowFlags; uniform int uMask;
in vec2 vUv; out vec4 o;
float stretchT(float t) {
  if (uStretch == 1) return asinh(10.0 * t) / asinh(10.0);
  if (uStretch == 2) return log(1.0 + 1000.0 * t) / log(1001.0);
  if (uStretch == 3) return sqrt(t);
  return t;
}
void main() {
  float v = texture(uImg, vUv).r;
  if (isnan(v) || isinf(v)) { o = vec4(0.071, 0.086, 0.125, 1.0); return; }
  float t = clamp((v - uLo) / max(uHi - uLo, 1e-12), 0.0, 1.0);
  vec3 c = texture(uLut, vec2(stretchT(t), 0.5)).rgb;
  if (uShowFlags == 1) {
    int f = texture(uFlags, vUv).r;
    if (f > 0 && (f & uMask) != 0) c = mix(c, vec3(0.0, 0.9, 1.0), 0.55);
  }
  o = vec4(c, 1.0);
}`;

interface GL { gl: WebGL2RenderingContext; prog: WebGLProgram; img: WebGLTexture; flags: WebGLTexture; lut: WebGLTexture; u: Record<string, WebGLUniformLocation | null> }

function init(canvas: HTMLCanvasElement): GL | null {
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = (unit: number, filter: number) => {
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const u = Object.fromEntries(['uImg', 'uFlags', 'uLut', 'uLo', 'uHi', 'uStretch', 'uShowFlags', 'uMask'].map((n) => [n, gl.getUniformLocation(prog, n)]));
  const g = { gl, prog, img: tex(0, gl.NEAREST), flags: tex(1, gl.NEAREST), lut: tex(2, gl.LINEAR), u };
  gl.uniform1i(u.uImg, 0);
  gl.uniform1i(u.uFlags, 1);
  gl.uniform1i(u.uLut, 2);
  return g;
}

export function FitsView({ cutout, lo, hi, stretch, colormap, showFlags, flagMask, onHover }: {
  cutout: Cutout; lo: number; hi: number; stretch: Stretch; colormap: Colormap; showFlags: boolean; flagMask: number; onHover?: (h: HoverInfo | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<GL | null>(null);
  const [scale, setScale] = useState({ k: 1, dpr: 1 });
  const [failure, setFailure] = useState<string | null>(null);
  const { nx, ny } = cutout;

  // whole device pixels per SPHEREx pixel, so every pixel is an exact square
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const k = Math.max(1, Math.floor(Math.min((el.clientWidth * dpr) / nx, (el.clientHeight * dpr) / ny)));
      setScale((s) => (s.k === k && s.dpr === dpr ? s : { k, dpr }));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [nx, ny]);

  useEffect(() => {
    if (!canvas.current || glRef.current) return;
    try {
      glRef.current = init(canvas.current);
      if (!glRef.current) setFailure('This browser cannot show the image: WebGL 2 is not available.');
    } catch (e) {
      setFailure(`The image renderer failed to start (${(e as Error).message}).`);
    }
    const c = canvas.current;
    const lost = (ev: Event) => { ev.preventDefault(); setFailure('The graphics context was lost. Reload the page to show the image again.'); };
    c.addEventListener('webglcontextlost', lost);
    return () => c.removeEventListener('webglcontextlost', lost);
  }, []);

  // upload data (only when the cutout changes)
  useEffect(() => {
    const g = glRef.current;
    if (!g) return;
    const { gl } = g;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, g.img);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, nx, ny, 0, gl.RED, gl.FLOAT, cutout.image);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, g.flags);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32I, nx, ny, 0, gl.RED_INTEGER, gl.INT, cutout.flagsArr);
  }, [cutout, nx, ny]);

  useEffect(() => {
    const g = glRef.current;
    if (!g) return;
    g.gl.activeTexture(g.gl.TEXTURE2);
    g.gl.bindTexture(g.gl.TEXTURE_2D, g.lut);
    g.gl.texImage2D(g.gl.TEXTURE_2D, 0, g.gl.RGBA8, 256, 1, 0, g.gl.RGBA, g.gl.UNSIGNED_BYTE, lut(colormap));
  }, [colormap]);

  // draw on demand: only when something on screen changed
  useEffect(() => {
    const g = glRef.current, c = canvas.current;
    if (!g || !c) return;
    c.width = nx * scale.k;
    c.height = ny * scale.k;
    const { gl, u } = g;
    gl.viewport(0, 0, c.width, c.height);
    gl.uniform1f(u.uLo, lo);
    gl.uniform1f(u.uHi, hi);
    gl.uniform1i(u.uStretch, STRETCH_ID[stretch]);
    gl.uniform1i(u.uShowFlags, showFlags ? 1 : 0);
    gl.uniform1i(u.uMask, flagMask);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }, [cutout, colormap, lo, hi, stretch, showFlags, flagMask, scale, nx, ny]);

  const cssW = (nx * scale.k) / scale.dpr, cssH = (ny * scale.k) / scale.dpr, px = scale.k / scale.dpr;
  const [x0, y0] = cutout.target_pixel_0based;
  const tx = (x0 + 0.5) * px, ty = (ny - 1 - y0 + 0.5) * px; // array row 0 is the bottom row

  const hover = useCallback((ev: React.PointerEvent) => {
    if (!onHover) return;
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const ix = Math.floor((ev.clientX - r.left) / px), iyTop = Math.floor((ev.clientY - r.top) / px);
    const iy = ny - 1 - iyTop;
    if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) return onHover(null);
    const i = iy * nx + ix, w = cutout.local_wcs, [[a, b], [c, d]] = w.cd_deg_per_px;
    const dx = ix - w.x0, dy = iy - w.y0;
    const dec = w.dec0 + c * dx + d * dy;
    const ra = (((w.ra0 + (a * dx + b * dy) / Math.cos((w.dec0 * Math.PI) / 180)) % 360) + 360) % 360;
    const v = cutout.variance?.[i];
    onHover({ x: ix, y: iy, value: cutout.image[i], sigma: v !== undefined && v >= 0 ? Math.sqrt(v) : null, flags: cutout.flagsArr[i], ra, dec });
  }, [cutout, nx, ny, px, onHover]);

  const arrow = (v: [number | null, number | null], label: string, color: string) => {
    if (v[0] === null || v[1] === null) return null;
    const len = Math.hypot(v[0], v[1]) || 1, L = 26;
    const ex = 34 + (v[0] / len) * L, ey = 34 - (v[1] / len) * L; // pixel y is up, screen y is down
    return (
      <g key={label}>
        <line x1={34} y1={34} x2={ex} y2={ey} stroke={color} strokeWidth={1.5} />
        <text x={34 + (v[0] / len) * (L + 9)} y={34 - (v[1] / len) * (L + 9)} fill={color} fontSize={11} textAnchor="middle" dominantBaseline="middle" className="font-mono">{label}</text>
      </g>
    );
  };

  return (
    <div ref={box} className="relative grid h-full w-full place-items-center overflow-hidden">
      {failure ? (
        <p role="alert" className="max-w-sm text-center text-sm text-danger">{failure}</p>
      ) : (
        <div className="relative" style={{ width: cssW, height: cssH }} onPointerMove={hover} onPointerLeave={() => onHover?.(null)}>
          <canvas ref={canvas} style={{ width: cssW, height: cssH, imageRendering: 'pixelated' }} aria-label={`SPHEREx image, ${nx} by ${ny} pixels`} role="img" />
          <svg className="pointer-events-none absolute inset-0" width={cssW} height={cssH} aria-hidden="true">
            <circle cx={tx} cy={ty} r={Math.max(8, px * 2.2)} fill="none" stroke="#ffb84d" strokeWidth={1.5} />
          </svg>
          <svg className="pointer-events-none absolute right-1 top-1" width={68} height={68} aria-label="Compass: north and east on this image">
            <rect x={0} y={0} width={68} height={68} rx={6} fill="#07090ecc" />
            {arrow(cutout.north_px, 'N', '#edf1f6')}
            {arrow(cutout.east_px, 'E', '#a9b4c3')}
          </svg>
        </div>
      )}
    </div>
  );
}
