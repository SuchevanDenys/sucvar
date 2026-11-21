// app/components/studio/LidarWireframeCanvas.tsx
// Vizualizator 3D al scanării: wireframe arhitectural pe <canvas> 2D (fără WebGL / biblioteci).
//   • Orbită cu mouse / deget (tragere), zoom cu rotița sau ciupire, săgeți + / − de la tastatură, dublu-click = reset.
//   • Bucla rAF rulează doar cât se mișcă ceva (tragere, inerție, rotire automată) — 60 FPS, apoi se oprește.
//   • Grilă de podea 0,5 m, pereți + perimetrul podelei în bordo, goluri (uși / ferestre) în șampanie,
//     cote flotante L / l / H pe muchiile cele mai apropiate de cameră.
//   • Mod „perspectivă interioară” (`interior`): vederea de la nivelul ochilor (~1,45 m) din interiorul camerei, exact
//     imaginea trimisă în Studio (`lib/studio/scanRender.ts`) — fără orbită; unghiul se alege din presetări.
"use client";

import React, { useCallback, useEffect, useRef } from 'react';
import type { EdgeKind, RoomScan, Vec3 } from '@/app/lib/studio/lidarParser';
import { buildInteriorScene, drawInteriorScene, type ScanCameraAngle } from '@/app/lib/studio/scanRender';

interface Props {
  scan: RoomScan;
  isDark: boolean;
  /** Etichetele cotelor (localizate). */
  labels: { length: string; width: string; height: string; hint: string };
  className?: string;
  /** Perspectiva interioară (sursa Studio „Proiect scanat 3D”); null / absent = orbită 3D. */
  interior?: ScanCameraAngle | null;
  /** Unghiul curent al orbitei (pentru „Unghiul tău”), raportat la fiecare cadru desenat. */
  onViewChange?: (view: { yaw: number; pitch: number }) => void;
}

interface Palette {
  bg: string;
  grid: string;
  gridMajor: string;
  wall: string;
  floor: string;
  door: string;
  window: string;
  opening: string;
  mesh: string;
  cloud: string;
  dim: string;
  labelBg: string;
  labelText: string;
  labelLine: string;
}

const PALETTES: Record<'light' | 'dark', Palette> = {
  light: {
    bg: '#FAF8F6',
    grid: 'rgba(27,20,22,0.055)',
    gridMajor: 'rgba(27,20,22,0.11)',
    wall: '#5C1628',
    floor: '#5C1628',
    door: '#A67C52',
    window: '#A67C52',
    opening: '#A67C52',
    mesh: 'rgba(92,22,40,0.22)',
    cloud: 'rgba(92,22,40,0.45)',
    dim: '#685D60',
    labelBg: '#FFFFFF',
    labelText: '#1B1416',
    labelLine: '#E8E2E0',
  },
  dark: {
    bg: '#110D0F',
    grid: 'rgba(245,242,239,0.05)',
    gridMajor: 'rgba(245,242,239,0.1)',
    wall: '#C94A6A',
    floor: '#C94A6A',
    door: '#C49A6C',
    window: '#C49A6C',
    opening: '#C49A6C',
    mesh: 'rgba(201,74,106,0.28)',
    cloud: 'rgba(214,93,123,0.55)',
    dim: '#B5A9AC',
    labelBg: '#1A1416',
    labelText: '#F5F2EF',
    labelLine: '#2E2427',
  },
};

const MIN_PITCH = 0.08;
const MAX_PITCH = 1.45;
const DEFAULT_VIEW = { yaw: -0.72, pitch: 0.55, zoom: 1 };

export default function LidarWireframeCanvas({ scan, isDark, labels, className = '', interior = null, onViewChange }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ ...DEFAULT_VIEW });
  const velocity = useRef({ yaw: 0, pitch: 0 });
  const autoSpin = useRef(true);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDist = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const latest = useRef({ scan, isDark, labels, interior, onViewChange });

  // ── Desen ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { scan: s, isDark: dark, labels: lb, interior: inside, onViewChange: report } = latest.current;
    const pal = PALETTES[dark ? 'dark' : 'light'];
    const { w, h, dpr } = size.current;
    if (!w || !h) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (inside) {
      // Aceeași scenă ca exportul Studio (paleta luminoasă: e „fotografia” trimisă modelului, nu o piesă de interfață)
      drawInteriorScene(ctx, buildInteriorScene(s, inside, w, h));
      return;
    }
    report?.({ yaw: view.current.yaw, pitch: view.current.pitch });
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, w, h);

    const L = s.lengthM, W = s.widthM, H = s.heightM;
    const center: Vec3 = [L / 2, H / 2, W / 2];
    const radius = Math.max(0.5, Math.hypot(L, W, H) / 2);
    const { yaw, pitch, zoom } = view.current;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const dist = radius * 3.1;
    const focal = (Math.min(w, h) * 0.5 * zoom * dist) / (radius * 1.25);

    // Lume → cameră (orbită: rotație în jurul lui Y, apoi înclinare în jurul lui X)
    const toCam = (p: Vec3): Vec3 => {
      const x = p[0] - center[0], y = p[1] - center[1], z = p[2] - center[2];
      const x1 = x * cy - z * sy;
      const z1 = x * sy + z * cy;
      // pitch > 0 ⇒ privim de sus: punctele înalte se apropie de cameră
      const y2 = y * cp + z1 * sp;
      const z2 = -y * sp + z1 * cp;
      return [x1, y2, z2 + dist];
    };
    const project = (p: Vec3): [number, number, number] | null => {
      const c = toCam(p);
      if (c[2] <= 0.05) return null;
      return [w / 2 + (c[0] * focal) / c[2], h / 2 - (c[1] * focal) / c[2], c[2]];
    };
    const line = (a: Vec3, b: Vec3) => {
      const pa = project(a), pb = project(b);
      if (!pa || !pb) return;
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
    };

    // Grila podelei (0,5 m; linii majore la 1 m), extinsă cu 1 m în jurul camerei
    const pad = 1;
    for (const major of [false, true]) {
      ctx.beginPath();
      ctx.strokeStyle = major ? pal.gridMajor : pal.grid;
      ctx.lineWidth = 1;
      for (let x = -pad; x <= L + pad + 1e-6; x += 0.5) {
        if ((Math.abs(x % 1) < 1e-6) !== major) continue;
        line([x, 0, -pad], [x, 0, W + pad]);
      }
      for (let z = -pad; z <= W + pad + 1e-6; z += 0.5) {
        if ((Math.abs(z % 1) < 1e-6) !== major) continue;
        line([-pad, 0, z], [L + pad, 0, z]);
      }
      ctx.stroke();
    }

    // Nor de puncte (scanări fără fețe)
    if (s.cloud.length) {
      ctx.fillStyle = pal.cloud;
      for (let i = 0; i + 2 < s.cloud.length; i += 3) {
        const p = project([s.cloud[i], s.cloud[i + 1], s.cloud[i + 2]]);
        if (p) ctx.fillRect(p[0] - 0.75, p[1] - 0.75, 1.5, 1.5);
      }
    }

    // Muchiile, grupate pe tip (un singur stroke per tip = rapid și la mii de muchii)
    const styles: Record<EdgeKind, { color: string; width: number; alpha?: number }> = {
      mesh: { color: pal.mesh, width: 0.8 },
      wall: { color: pal.wall, width: 1.6 },
      floor: { color: pal.floor, width: 2.4 },
      door: { color: pal.door, width: 2 },
      window: { color: pal.window, width: 2 },
      opening: { color: pal.opening, width: 1.6 },
    };
    for (const kind of ['mesh', 'wall', 'floor', 'opening', 'window', 'door'] as EdgeKind[]) {
      const st = styles[kind];
      ctx.beginPath();
      ctx.strokeStyle = st.color;
      ctx.lineWidth = st.width;
      ctx.lineCap = 'round';
      let any = false;
      for (const e of s.edges) {
        if (e.kind !== kind) continue;
        line(e.a, e.b);
        any = true;
      }
      if (any) ctx.stroke();
    }

    // Cotele: pentru fiecare direcție, muchia (dintre cele paralele) cea mai apropiată de cameră
    const depth = (p: Vec3) => toCam(p)[2];
    const pickNear = (cands: [Vec3, Vec3][]) =>
      cands.reduce((best, c) => (depth(mid(c)) < depth(mid(best)) ? c : best));
    const lenEdge = pickNear([[[0, 0, 0], [L, 0, 0]], [[0, 0, W], [L, 0, W]]]);
    const widEdge = pickNear([[[0, 0, 0], [0, 0, W]], [[L, 0, 0], [L, 0, W]]]);
    // H pe colțul de la celălalt capăt al lungimii (nu pe colțul comun L / l) — cotele nu se mai suprapun
    const hx0 = widEdge[0][0] === 0 ? L : 0;
    const hz0 = lenEdge[0][2];
    const hEdge: [Vec3, Vec3] = [[hx0, 0, hz0], [hx0, H, hz0]];

    const fmt = (n: number) => `${n.toFixed(2).replace('.', ',')} m`;
    const dimLine = (edge: [Vec3, Vec3], outward: Vec3, text: string) => {
      const off = 0.32;
      const a: Vec3 = [edge[0][0] + outward[0] * off, edge[0][1] + outward[1] * off, edge[0][2] + outward[2] * off];
      const b: Vec3 = [edge[1][0] + outward[0] * off, edge[1][1] + outward[1] * off, edge[1][2] + outward[2] * off];
      const pa = project(a), pb = project(b), pe0 = project(edge[0]), pe1 = project(edge[1]);
      if (!pa || !pb || !pe0 || !pe1) return;
      ctx.save();
      ctx.strokeStyle = pal.dim;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pe0[0], pe0[1]);
      ctx.lineTo(pa[0], pa[1]);
      ctx.moveTo(pe1[0], pe1[1]);
      ctx.lineTo(pb[0], pb[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
      ctx.stroke();
      // Capete de cotă
      for (const p of [pa, pb]) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 2.2, 0, Math.PI * 2);
        ctx.fillStyle = pal.dim;
        ctx.fill();
      }
      const mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2;
      ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      const tw = ctx.measureText(text).width;
      const bw = tw + 14, bh = 20;
      const x = Math.min(Math.max(mx - bw / 2, 4), w - bw - 4);
      const y = Math.min(Math.max(my - bh / 2, 4), h - bh - 4);
      ctx.fillStyle = pal.labelBg;
      ctx.strokeStyle = pal.labelLine;
      roundRect(ctx, x, y, bw, bh, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = pal.labelText;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + 7, y + bh / 2 + 0.5);
      ctx.restore();
    };
    const outwardZ = lenEdge[0][2] === 0 ? -1 : 1;
    const outwardX = widEdge[0][0] === 0 ? -1 : 1;
    dimLine(lenEdge, [0, 0, outwardZ], `${lb.length}: ${fmt(L)}`);
    dimLine(widEdge, [outwardX, 0, 0], `${lb.width}: ${fmt(W)}`);
    const hx = hEdge[0][0] === 0 ? -1 : 1, hz = hEdge[0][2] === 0 ? -1 : 1;
    dimLine(hEdge, [hx * Math.SQRT1_2, 0, hz * Math.SQRT1_2], `${lb.height}: ${fmt(H)}`);
  }, []);

  // ── Bucla de animație (doar când e nevoie): inerție după tragere + rotire automată ──
  const kick = useCallback(() => {
    if (raf.current !== null) return;
    const loop = () => {
      raf.current = null;
      const v = velocity.current;
      let moving = false;
      if (pointers.current.size === 0 && !latest.current.interior) {
        if (Math.abs(v.yaw) > 0.0004 || Math.abs(v.pitch) > 0.0004) {
          view.current.yaw += v.yaw;
          view.current.pitch = clamp(view.current.pitch + v.pitch, MIN_PITCH, MAX_PITCH);
          v.yaw *= 0.92;
          v.pitch *= 0.92;
          moving = true;
        } else if (autoSpin.current) {
          view.current.yaw += 0.0035;
          moving = true;
        }
      }
      draw();
      if (moving) raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
  }, [draw]);

  useEffect(() => {
    latest.current = { scan, isDark, labels, interior, onViewChange };
    // Desen imediat: `kick` nu face nimic dacă un cadru rAF e deja programat (comutarea orbită ↔ interior nu așteaptă)
    draw();
    kick();
  }, [scan, isDark, labels, interior, onViewChange, draw, kick]);

  // Scanare nouă ⇒ vedere implicită + rotire automată (dacă utilizatorul nu preferă mișcare redusă)
  useEffect(() => {
    view.current = { ...DEFAULT_VIEW };
    velocity.current = { yaw: 0, pitch: 0 };
    autoSpin.current = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    kick();
  }, [scan, kick]);

  // Dimensiunea canvas-ului (DPR) urmărește containerul
  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size.current = { w: r.width, h: r.height, dpr };
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      draw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [draw]);

  // Rotița: listener ne-pasiv (preventDefault ca pagina să nu deruleze)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      if (latest.current.interior) return;
      e.preventDefault();
      autoSpin.current = false;
      view.current.zoom = clamp(view.current.zoom * Math.exp(-e.deltaY * 0.0015), 0.45, 4);
      kick();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [kick]);

  useEffect(() => () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (interior) return;
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
      if (pinchDist.current !== null && pinchDist.current > 0) {
        view.current.zoom = clamp(view.current.zoom * (d / pinchDist.current), 0.45, 4);
      }
      pinchDist.current = d;
    } else {
      const dyaw = (cur.x - prev.x) * 0.008;
      const dpitch = (cur.y - prev.y) * 0.006;
      view.current.yaw += dyaw;
      view.current.pitch = clamp(view.current.pitch + dpitch, MIN_PITCH, MAX_PITCH);
      velocity.current = { yaw: dyaw, pitch: dpitch };
    }
    draw();
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchDist.current = null;
    kick(); // inerție
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (interior) return;
    const v = view.current;
    const step: Record<string, () => void> = {
      ArrowLeft: () => (v.yaw -= 0.12),
      ArrowRight: () => (v.yaw += 0.12),
      ArrowUp: () => (v.pitch = clamp(v.pitch + 0.08, MIN_PITCH, MAX_PITCH)),
      ArrowDown: () => (v.pitch = clamp(v.pitch - 0.08, MIN_PITCH, MAX_PITCH)),
      '+': () => (v.zoom = clamp(v.zoom * 1.15, 0.45, 4)),
      '=': () => (v.zoom = clamp(v.zoom * 1.15, 0.45, 4)),
      '-': () => (v.zoom = clamp(v.zoom / 1.15, 0.45, 4)),
      '0': () => (view.current = { ...DEFAULT_VIEW }),
    };
    const fn = step[e.key];
    if (!fn) return;
    e.preventDefault();
    autoSpin.current = false;
    fn();
    draw();
  };

  return (
    <div ref={wrapRef} className={`relative w-full overflow-hidden rounded-lg ${className}`}>
      <canvas
        ref={canvasRef}
        role="img"
        tabIndex={0}
        aria-label={`${labels.length} ${scan.lengthM} m · ${labels.width} ${scan.widthM} m · ${labels.height} ${scan.heightM} m. ${labels.hint}`}
        className={`absolute inset-0 h-full w-full select-none outline-none focus-visible:ring-2 focus-visible:ring-[#A67C52]/60 ${interior ? '' : 'cursor-grab touch-none active:cursor-grabbing'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => {
          if (interior) return;
          view.current = { ...DEFAULT_VIEW };
          velocity.current = { yaw: 0, pitch: 0 };
          draw();
        }}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const mid = ([a, b]: [Vec3, Vec3]): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
