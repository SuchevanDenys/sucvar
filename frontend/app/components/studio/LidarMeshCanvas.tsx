// app/components/studio/LidarMeshCanvas.tsx
// Vizualizatorul plasei REALE a scanării (OBJ texturat / colorat, ex. arhiva Scaniverse .zip) — WebGL2 nativ.
//   • „Vedere ansamblu” (orbită): tragere = rotire, rotița / ciupirea = zoom; pereții apropiați sunt eliminați
//     (casă de păpuși), deci se vede interiorul real al camerei.
//   • „Unghi interior 1 / 2”: ochiul la 1,45 m; tragerea rotește privirea, rotița / ciupirea schimbă câmpul vizual.
//   • Cotele metrice L / l / H (bordo + șampanie) sunt pe un <canvas> 2D separat, deasupra: comutatorul „Arată cote
//     3D” le ascunde, iar captura Studio (`renderScanMeshToImage`) nu le conține niciodată.
//   • Bucla rAF rulează doar cât se mișcă ceva (tragere, inerție, rotire automată) — 60 FPS, apoi se oprește.
// Vederea curentă stă în `viewRef` (al părintelui): presetările o înlocuiesc și cresc `viewVersion`, iar captura o
// citește direct, fără o randare React la fiecare cadru.
"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Ruler } from 'lucide-react';
import type { RoomScan, Vec3 } from '@/app/lib/studio/lidarParser';
import {
  INTERIOR_HFOV,
  INTERIOR_PITCH,
  ORBIT_PITCH,
  ORBIT_ZOOM,
  defaultOrbitView,
  interiorMeshView,
  projectMeshPoint,
  type MeshView,
} from '@/app/lib/studio/scanRender';
import { ScanMeshRenderer, loadScanTextures } from '@/app/lib/studio/meshRenderer';

interface Props {
  scan: RoomScan;
  isDark: boolean;
  labels: { length: string; width: string; height: string; hint: string; showDims: string; loadingTexture: string };
  viewRef: React.MutableRefObject<MeshView>;
  /** Crește când părintele a înlocuit vederea (presetare). */
  viewVersion: number;
  /** Utilizatorul a modificat vederea (sfârșitul unei trageri / zoom): părintele actualizează presetarea activă. */
  onViewCommit?: (view: MeshView) => void;
  /** WebGL2 indisponibil / context pierdut definitiv: părintele cade pe vizualizatorul schematic. */
  onUnsupported?: () => void;
  className?: string;
}

const BG = { light: [0xfa / 255, 0xf8 / 255, 0xf6 / 255], dark: [0x11 / 255, 0x0d / 255, 0x0f / 255] } as const;
const BORDEAUX = '#5C1628';
const CHAMPAGNE = '#A67C52';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export default function LidarMeshCanvas({ scan, isDark, labels, viewRef, viewVersion, onViewCommit, onUnsupported, className = '' }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ScanMeshRenderer | null>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const velocity = useRef({ yaw: 0, pitch: 0 });
  const autoSpin = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDist = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const [showDims, setShowDims] = useState(true);
  const [texturesPending, setTexturesPending] = useState(false);
  const latest = useRef({ scan, isDark, labels, showDims, onViewCommit, onUnsupported });
  useEffect(() => {
    latest.current = { scan, isDark, labels, showDims, onViewCommit, onUnsupported };
  });

  // ── Desen: plasa (WebGL) + cotele (2D, aceeași matrice) ──
  const draw = useCallback(() => {
    const r = renderer.current;
    const gl = glRef.current, ov = overlayRef.current;
    const { w, h, dpr } = size.current;
    if (!r || !gl || !ov || !w || !h) return;
    const { scan: s, isDark: dark, labels: lb, showDims: dims } = latest.current;
    const mvp = r.draw(viewRef.current, s, gl.width, gl.height, [...BG[dark ? 'dark' : 'light']] as [number, number, number]);
    const ctx = ov.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (dims) drawDimensions(ctx, s, mvp, w, h, lb, viewRef.current.kind === 'interior');
  }, [viewRef]);

  const commit = useCallback(() => latest.current.onViewCommit?.({ ...viewRef.current }), [viewRef]);

  const kick = useCallback(() => {
    if (raf.current !== null) return;
    const loop = () => {
      raf.current = null;
      const v = viewRef.current;
      const vel = velocity.current;
      let moving = false;
      if (pointers.current.size === 0) {
        if (Math.abs(vel.yaw) > 0.0004 || Math.abs(vel.pitch) > 0.0004) {
          v.yaw += vel.yaw;
          v.pitch = v.kind === 'orbit' ? clamp(v.pitch + vel.pitch, ORBIT_PITCH.min, ORBIT_PITCH.max) : clamp(v.pitch + vel.pitch, INTERIOR_PITCH.min, INTERIOR_PITCH.max);
          vel.yaw *= 0.9;
          vel.pitch *= 0.9;
          moving = true;
        } else if (autoSpin.current && v.kind === 'orbit') {
          v.yaw += 0.003;
          moving = true;
        }
      }
      draw();
      if (moving) raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
  }, [draw, viewRef]);

  // Renderer-ul: o dată pe plasă (bufferele GPU se încarcă o singură dată), texturile asincron
  useEffect(() => {
    const canvas = glRef.current;
    if (!canvas || !scan.mesh) return;
    const mesh = scan.mesh;
    let disposed = false;
    const init = () => {
      const r = ScanMeshRenderer.create(canvas, mesh);
      if (!r) {
        latest.current.onUnsupported?.();
        return;
      }
      renderer.current = r;
      if (mesh.textures.length) {
        setTexturesPending(true);
        void loadScanTextures(mesh).then((imgs) => {
          if (disposed || renderer.current !== r) return;
          r.setTextures(imgs);
          setTexturesPending(false);
          draw();
        });
      }
      draw();
    };
    const onLost = (e: Event) => {
      e.preventDefault();
      renderer.current = null;
    };
    const onRestored = () => init();
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    init();
    return () => {
      disposed = true;
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, [scan.mesh, draw]);

  // Scanare nouă: rotire automată scurtă în „Vedere ansamblu” (dacă utilizatorul nu preferă mișcare redusă)
  useEffect(() => {
    velocity.current = { yaw: 0, pitch: 0 };
    autoSpin.current = viewRef.current.kind === 'orbit' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    kick();
  }, [scan, kick, viewRef]);

  // Presetare nouă / temă / cote: redesenare imediată
  useEffect(() => {
    velocity.current = { yaw: 0, pitch: 0 };
    if (viewVersion > 0) autoSpin.current = false;
    draw();
  }, [viewVersion, isDark, showDims, labels, draw]);

  // Dimensiunea canvas-urilor (DPR ≤ 2) urmărește containerul
  useEffect(() => {
    const wrap = wrapRef.current, gl = glRef.current, ov = overlayRef.current;
    if (!wrap || !gl || !ov) return;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size.current = { w: r.width, h: r.height, dpr };
      for (const c of [gl, ov]) {
        c.width = Math.max(1, Math.round(r.width * dpr));
        c.height = Math.max(1, Math.round(r.height * dpr));
      }
      draw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [draw]);

  // Rotița: zoom (orbită) / câmp vizual (interior); listener ne-pasiv ca pagina să nu deruleze
  useEffect(() => {
    const canvas = glRef.current;
    if (!canvas) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      autoSpin.current = false;
      zoomBy(viewRef.current, Math.exp(-e.deltaY * 0.0015));
      draw();
      if (timer) clearTimeout(timer);
      timer = setTimeout(commit, 250);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      if (timer) clearTimeout(timer);
    };
  }, [draw, commit, viewRef]);

  useEffect(() => () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
  }, []);

  const rotate = (dx: number, dy: number) => {
    const v = viewRef.current;
    if (v.kind === 'orbit') {
      // „Apuci” camera: tragerea spre dreapta rotește modelul spre dreapta
      const dyaw = -dx * 0.008, dpitch = dy * 0.006;
      v.yaw += dyaw;
      v.pitch = clamp(v.pitch + dpitch, ORBIT_PITCH.min, ORBIT_PITCH.max);
      velocity.current = { yaw: dyaw, pitch: dpitch };
    } else {
      // Privire în jur: viteza scade cu câmpul vizual (zoom-ul optic rămâne controlabil)
      const k = (0.0042 * v.hfovDeg) / 78;
      const dyaw = dx * k, dpitch = dy * k;
      v.yaw += dyaw;
      v.pitch = clamp(v.pitch + dpitch, INTERIOR_PITCH.min, INTERIOR_PITCH.max);
      velocity.current = { yaw: dyaw, pitch: dpitch };
    }
    if (v.preset !== 'overview') v.preset = 'custom';
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    autoSpin.current = false;
    velocity.current = { yaw: 0, pitch: 0 };
    pinchDist.current = null;
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    if (pointers.current.size >= 2) {
      const [p1, p2] = [...pointers.current.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (pinchDist.current !== null && pinchDist.current > 0) zoomBy(viewRef.current, d / pinchDist.current);
      pinchDist.current = d;
    } else {
      rotate(cur.x - prev.x, cur.y - prev.y);
    }
    draw();
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const had = pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchDist.current = null;
    if (had && pointers.current.size === 0) commit();
    kick(); // inerție
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const v = viewRef.current;
    const step: Record<string, () => void> = {
      ArrowLeft: () => rotate(-18, 0),
      ArrowRight: () => rotate(18, 0),
      ArrowUp: () => rotate(0, -14),
      ArrowDown: () => rotate(0, 14),
      '+': () => zoomBy(v, 1.15),
      '=': () => zoomBy(v, 1.15),
      '-': () => zoomBy(v, 1 / 1.15),
    };
    const fn = step[e.key];
    if (!fn) return;
    e.preventDefault();
    autoSpin.current = false;
    fn();
    velocity.current = { yaw: 0, pitch: 0 };
    draw();
    commit();
  };
  const onDoubleClick = () => {
    const v = viewRef.current;
    viewRef.current = v.kind === 'orbit' ? defaultOrbitView() : v.preset === 'entry' || v.preset === 'window' ? interiorMeshView(scan, { preset: v.preset }) : { ...v, pitch: 0, hfovDeg: 78 };
    velocity.current = { yaw: 0, pitch: 0 };
    draw();
    commit();
  };

  return (
    <div ref={wrapRef} className={`relative w-full overflow-hidden rounded-lg ${isDark ? 'bg-[#110D0F]' : 'bg-[#FAF8F6]'} ${className}`}>
      <canvas
        ref={glRef}
        role="img"
        tabIndex={0}
        aria-label={`${labels.length} ${scan.lengthM} m · ${labels.width} ${scan.widthM} m · ${labels.height} ${scan.heightM} m. ${labels.hint}`}
        className="absolute inset-0 h-full w-full select-none outline-none touch-none cursor-grab active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-[#A67C52]/60"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
      />
      <canvas ref={overlayRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
      <button
        type="button"
        aria-pressed={showDims}
        onClick={() => setShowDims((v) => !v)}
        className={`absolute right-2 top-2 inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium backdrop-blur-md cursor-pointer touch-manipulation transition-colors ${
          showDims
            ? 'border-[#A67C52]/60 bg-white/85 text-[#5C1628]'
            : isDark ? 'border-[#2E2427] bg-[#1A1416]/80 text-[#B5A9AC]' : 'border-[#E8E2E0] bg-white/70 text-[#685D60]'
        }`}
      >
        <Ruler className="h-3.5 w-3.5" aria-hidden />
        {labels.showDims}
      </button>
      {texturesPending && (
        <span role="status" className={`absolute left-2 top-2 inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] backdrop-blur-md ${isDark ? 'bg-[#1A1416]/80 text-[#B5A9AC]' : 'bg-white/80 text-[#685D60]'}`}>
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
          {labels.loadingTexture}
        </span>
      )}
    </div>
  );
}

function zoomBy(v: MeshView, k: number) {
  if (v.kind === 'orbit') v.zoom = clamp(v.zoom * k, ORBIT_ZOOM.min, ORBIT_ZOOM.max);
  else {
    v.hfovDeg = clamp(v.hfovDeg / k, INTERIOR_HFOV.min, INTERIOR_HFOV.max);
    if (v.preset !== 'overview') v.preset = 'custom';
  }
}

// ── Cotele metrice (L / l / H) pe cutia camerei scanate ─────────────────────

type Edge = { a: Vec3; b: Vec3; out: Vec3 };

function drawDimensions(
  ctx: CanvasRenderingContext2D,
  scan: RoomScan,
  mvp: Float32Array,
  w: number,
  h: number,
  lb: { length: string; width: string; height: string },
  interior: boolean,
) {
  const L = scan.lengthM, W = scan.widthM, H = scan.heightM;
  const D = Math.SQRT1_2;
  const lenEdges: Edge[] = [
    { a: [0, 0, 0], b: [L, 0, 0], out: [0, 0, -1] },
    { a: [0, 0, W], b: [L, 0, W], out: [0, 0, 1] },
  ];
  const widEdges: Edge[] = [
    { a: [0, 0, 0], b: [0, 0, W], out: [-1, 0, 0] },
    { a: [L, 0, 0], b: [L, 0, W], out: [1, 0, 0] },
  ];
  const hgtEdges: Edge[] = ([[0, 0], [L, 0], [L, W], [0, W]] as [number, number][]).map(([x, z]) => ({
    a: [x, 0, z],
    b: [x, H, z],
    out: [x === 0 ? -D : D, 0, z === 0 ? -D : D],
  }));

  // Din exterior: cota stă în afara camerei (0,32 m); din interior: puțin spre interior, deasupra podelei
  const off = interior ? -0.12 : 0.32;
  const place = (e: Edge) => {
    const lift = interior && e.a[1] === e.b[1] ? 0.02 : 0;
    const shift = (p: Vec3): Vec3 => [p[0] + e.out[0] * off, p[1] + lift, p[2] + e.out[2] * off];
    const pa = projectMeshPoint(mvp, shift(e.a), w, h), pb = projectMeshPoint(mvp, shift(e.b), w, h);
    const ea = projectMeshPoint(mvp, e.a, w, h), eb = projectMeshPoint(mvp, e.b, w, h);
    if (!pa || !pb || !ea || !eb) return null;
    return { pa, pb, ea, eb };
  };
  const pick = (edges: Edge[]) => {
    let best: { p: NonNullable<ReturnType<typeof place>>; score: number } | null = null;
    for (const e of edges) {
      const p = place(e);
      if (!p) continue;
      const mx = (p.pa[0] + p.pb[0]) / 2, my = (p.pa[1] + p.pb[1]) / 2;
      const onScreen = mx > 8 && mx < w - 8 && my > 8 && my < h - 8;
      // Exterior: muchia cea mai apropiată; interior: cea mai lungă pe ecran, cu mijlocul în cadru
      const score = interior
        ? (onScreen ? 1e6 : 0) + Math.hypot(p.pb[0] - p.pa[0], p.pb[1] - p.pa[1])
        : -(p.pa[2] + p.pb[2]) + (onScreen ? 1e6 : 0);
      if (!best || score > best.score) best = { p, score };
    }
    return best?.p ?? null;
  };

  const fmt = (n: number) => `${n.toFixed(2).replace('.', ',')} m`;
  const dimLine = (p: NonNullable<ReturnType<typeof place>>, text: string) => {
    const { pa, pb, ea, eb } = p;
    ctx.save();
    ctx.lineCap = 'round';
    // Liniile de extensie (punctate) de la muchie la linia de cotă
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(92,22,40,0.7)';
    ctx.beginPath();
    ctx.moveTo(ea[0], ea[1]);
    ctx.lineTo(pa[0], pa[1]);
    ctx.moveTo(eb[0], eb[1]);
    ctx.lineTo(pb[0], pb[1]);
    ctx.stroke();
    ctx.setLineDash([]);
    // Linia de cotă: halou alb (lizibilă pe textură) + bordo
    for (const [color, width] of [['rgba(255,255,255,0.85)', 4], [BORDEAUX, 1.6]] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
      ctx.stroke();
    }
    // Capete: tăieturi arhitecturale la 45° în șampanie
    const ang = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]) + Math.PI / 4;
    ctx.strokeStyle = CHAMPAGNE;
    ctx.lineWidth = 2;
    for (const q of [pa, pb]) {
      ctx.beginPath();
      ctx.moveTo(q[0] - Math.cos(ang) * 5, q[1] - Math.sin(ang) * 5);
      ctx.lineTo(q[0] + Math.cos(ang) * 5, q[1] + Math.sin(ang) * 5);
      ctx.stroke();
    }
    // Eticheta
    const mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2;
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    const tw = ctx.measureText(text).width;
    const bw = tw + 16, bh = 21;
    const x = clamp(mx - bw / 2, 4, w - bw - 4);
    const y = clamp(my - bh / 2, 4, h - bh - 4);
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.strokeStyle = CHAMPAGNE;
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, bw, bh, 10.5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = BORDEAUX;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 8, y + bh / 2 + 0.5);
    ctx.restore();
  };

  const len = pick(lenEdges), wid = pick(widEdges), hgt = pick(hgtEdges);
  if (len) dimLine(len, `${lb.length}: ${fmt(L)}`);
  if (wid) dimLine(wid, `${lb.width}: ${fmt(W)}`);
  if (hgt) dimLine(hgt, `${lb.height}: ${fmt(H)}`);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}