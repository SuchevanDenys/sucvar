// app/components/studio/MaskEditor.tsx
// „Editează o zonă”: fotografia sursă (object-contain, întreagă) + un canvas HiDPI suprapus EXACT peste pixelii
// imaginii (fără benzile de letterbox), pe care utilizatorul pictează cu pensula / radiera. Traseele se păstrează
// în coordonatele imaginii, deci redimensionarea ferestrei sau rotirea telefonului nu deplasează selecția.
// Bara flotantă: Pensulă / Radieră, Mărime pensulă (12–96 px, cursor circular live), Anulează, Resetează selecția.
// Scurtături: B = pensulă, E = radieră, [ / ] = mărime, Ctrl/⌘+Z = anulează.
"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Brush, Eraser, RotateCcw, Undo2 } from 'lucide-react';
import { tr } from '@/app/lib/i18n';
import {
  BRUSH_DEFAULT, BRUSH_MAX, BRUSH_MIN, MASK_OPACITY, MASK_TINT, drawStrokes, hasSelection,
  type MaskPoint, type MaskStroke, type MaskTool,
} from '@/app/lib/studio/mask';
import type { Language } from '@/app/types';

interface MaskEditorProps {
  lang: Language;
  isDark: boolean;
  src: string;
  strokes: MaskStroke[];
  onStrokesChange: (strokes: MaskStroke[]) => void;
  /** Dimensiunile naturale ale fotografiei (pentru metadatele selecției din previzualizarea promptului). */
  onImageSize?: (size: { width: number; height: number }) => void;
  disabled?: boolean;
}

interface ContentRect { left: number; top: number; width: number; height: number }

const isTextTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

export default function MaskEditor({ lang, isDark, src, strokes, onStrokesChange, onImageSize, disabled }: MaskEditorProps) {
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const sliderId = useId();
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<MaskStroke | null>(null);
  const frameReq = useRef(0);

  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [rect, setRect] = useState<ContentRect | null>(null);
  const [tool, setTool] = useState<MaskTool>('brush');
  const [size, setSize] = useState(BRUSH_DEFAULT);
  const [painting, setPainting] = useState(false);

  // Dreptunghiul REAL al pixelilor imaginii în cadru (object-contain → benzi laterale sau sus/jos)
  const measure = useCallback(() => {
    const img = imgRef.current, frame = frameRef.current;
    if (!img || !frame || !img.naturalWidth) return;
    const box = img.getBoundingClientRect(), outer = frame.getBoundingClientRect();
    const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
    const width = img.naturalWidth * scale, height = img.naturalHeight * scale;
    setRect({ left: box.left - outer.left + (box.width - width) / 2, top: box.top - outer.top + (box.height - height) / 2, width, height });
  }, []);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(img);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  // Randare: canvas la rezoluția ecranului (devicePixelRatio), desenat în coordonatele imaginii
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rect || !natural) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(w / natural.width, 0, 0, h / natural.height, 0, 0);
    drawStrokes(ctx, activeRef.current ? [...strokes, activeRef.current] : strokes, MASK_TINT, 'clear');
  }, [rect, natural, strokes]);

  useEffect(() => {
    draw();
  }, [draw]);

  const scheduleDraw = () => {
    cancelAnimationFrame(frameReq.current);
    frameReq.current = requestAnimationFrame(draw);
  };
  useEffect(() => () => cancelAnimationFrame(frameReq.current), []);

  /** Pixeli de ecran → pixeli de imagine. */
  const toImage = (e: { clientX: number; clientY: number }): MaskPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas || !natural) return null;
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * natural.width, y: ((e.clientY - r.top) / r.height) * natural.height };
  };

  const moveCursor = (e: React.PointerEvent) => {
    const el = cursorRef.current, frame = frameRef.current;
    if (!el || !frame) return;
    const outer = frame.getBoundingClientRect();
    el.style.transform = `translate(${e.clientX - outer.left - size / 2}px, ${e.clientY - outer.top - size / 2}px)`;
    el.style.opacity = '1';
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || !rect || !natural || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const p = toImage(e);
    if (!p) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    // Grosimea în pixeli de imagine: aceeași pe ecran acum, stabilă la orice redimensionare ulterioară
    activeRef.current = { tool, size: size * (natural.width / rect.width), points: [p] };
    setPainting(true);
    scheduleDraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    moveCursor(e);
    const active = activeRef.current;
    if (!active) return;
    const native = e.nativeEvent;
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    for (const ev of events.length > 0 ? events : [native]) {
      const p = toImage(ev);
      const last = active.points[active.points.length - 1];
      if (p && (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 0.75)) active.points.push(p);
    }
    scheduleDraw();
  };

  const finish = () => {
    const active = activeRef.current;
    activeRef.current = null;
    setPainting(false);
    if (active && active.points.length > 0) onStrokesChange([...strokes, active]);
  };

  const undo = useCallback(() => onStrokesChange(strokes.slice(0, -1)), [onStrokesChange, strokes]);
  const clear = () => onStrokesChange([]);

  // Scurtături (ignorate cât timp utilizatorul scrie într-un câmp)
  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTextTarget(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (strokes.length > 0) {
          e.preventDefault();
          undo();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'b' || e.key === 'B') setTool('brush');
      else if (e.key === 'e' || e.key === 'E') setTool('eraser');
      else if (e.key === '[') setSize((s) => Math.max(BRUSH_MIN, s - 8));
      else if (e.key === ']') setSize((s) => Math.min(BRUSH_MAX, s + 8));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [disabled, strokes.length, undo]);

  const selected = hasSelection(strokes);
  const backdrop = isDark ? 'bg-[#110D0F]' : 'bg-[#F5F2EF]';
  const bar = isDark
    ? 'bg-[#1A1416]/80 border-[#2E2427] border-t-white/10 text-[#F5F2EF] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset,0_2px_6px_-2px_rgba(0,0,0,0.5),0_18px_40px_-20px_rgba(0,0,0,0.8)]'
    : 'bg-[#FAF8F6]/80 border-[#E8E2E0] border-t-white/60 text-[#1B1416] shadow-[0_1px_0_rgba(255,255,255,0.7)_inset,0_2px_6px_-3px_rgba(27,20,22,0.12),0_18px_40px_-22px_rgba(92,22,40,0.45)]';
  const segOn = isDark ? 'bg-[#C94A6A] text-white' : 'bg-[#5C1628] text-white';
  const segOff = isDark ? 'text-[#B5A9AC] hover:text-[#F5F2EF] hover:bg-[#231B1E]' : 'text-[#685D60] hover:text-[#1B1416] hover:bg-white';
  const iconBtn = `inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium cursor-pointer touch-manipulation transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${segOff}`;

  return (
    <div className="space-y-2.5">
      {/* Bara de unelte flotantă */}
      <div className="flex justify-center">
        <div
          role="toolbar"
          aria-label={t('Unelte de selecție', 'Selection tools', 'Outils de sélection')}
          className={`flex flex-wrap items-center justify-center gap-1 rounded-2xl sm:rounded-full border p-1 backdrop-blur-md backdrop-saturate-150 ${bar}`}
        >
          <div className={`flex rounded-full p-0.5 ${isDark ? 'bg-[#110D0F]' : 'bg-[#F5F2EF] shadow-[inset_0_0_0_1px_rgba(27,20,22,0.04)]'}`} role="radiogroup" aria-label={t('Unealtă', 'Tool', 'Outil')}>
            {([
              ['brush', Brush, t('Pensulă', 'Brush', 'Pinceau')],
              ['eraser', Eraser, t('Radieră', 'Eraser', 'Gomme')],
            ] as const).map(([id, Icon, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={tool === id}
                disabled={disabled}
                onClick={() => setTool(id)}
                title={`${label} (${id === 'brush' ? 'B' : 'E'})`}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium cursor-pointer touch-manipulation transition-colors disabled:opacity-40 ${tool === id ? segOn : segOff}`}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>

          <label htmlFor={sliderId} className="flex items-center gap-2 px-2 text-[12px]">
            <span className="whitespace-nowrap opacity-80">{t('Mărime pensulă', 'Brush size', 'Taille du pinceau')}</span>
            <input
              id={sliderId}
              type="range"
              min={BRUSH_MIN}
              max={BRUSH_MAX}
              step={2}
              value={size}
              disabled={disabled}
              onChange={(e) => setSize(Number(e.target.value))}
              className="w-24 sm:w-28 accent-[#5C1628] touch-pan-y"
            />
            <span aria-hidden className="relative flex h-7 w-7 items-center justify-center">
              <span
                className={`block rounded-full border ${isDark ? 'border-[#E07F98] bg-[#C94A6A]/40' : 'border-[#5C1628] bg-[#5C1628]/35'}`}
                style={{ width: 4 + (size / BRUSH_MAX) * 22, height: 4 + (size / BRUSH_MAX) * 22 }}
              />
            </span>
            <span className="w-9 font-mono tabular-nums text-[11px] opacity-80">{size}px</span>
          </label>

          <span aria-hidden className={`hidden sm:block h-5 w-px ${isDark ? 'bg-[#2E2427]' : 'bg-[#E8E2E0]'}`} />

          <button type="button" onClick={undo} disabled={disabled || strokes.length === 0} title={t('Anulează (Ctrl+Z)', 'Undo (Ctrl+Z)', 'Annuler (Ctrl+Z)')} className={iconBtn}>
            <Undo2 className="w-3.5 h-3.5" aria-hidden />
            {t('Anulează', 'Undo', 'Annuler')}
          </button>
          <button type="button" onClick={clear} disabled={disabled || strokes.length === 0} className={iconBtn}>
            <RotateCcw className="w-3.5 h-3.5" aria-hidden />
            {t('Resetează selecția', 'Clear selection', 'Effacer la sélection')}
          </button>
        </div>
      </div>

      {/* Fotografia + stratul de selecție */}
      <div ref={frameRef} className={`relative flex items-center justify-center rounded-lg overflow-hidden border select-none ${backdrop} ${isDark ? 'border-[#2E2427]' : 'border-[#E8E2E0]'}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
        <img
          ref={imgRef}
          src={src}
          alt={t('Fotografia sursă — pictează zona de modificat', 'Source photo — paint the area to change', 'Photo source — peignez la zone à modifier')}
          draggable={false}
          onLoad={(e) => {
            const size = { width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight };
            setNatural(size);
            onImageSize?.(size);
            measure();
          }}
          className="block w-full h-auto max-h-[72vh] object-contain pointer-events-none"
        />
        {rect && natural && (
          <canvas
            ref={canvasRef}
            aria-label={t('Strat de selecție', 'Selection layer', 'Calque de sélection')}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finish}
            onPointerCancel={finish}
            onPointerLeave={() => {
              if (cursorRef.current) cursorRef.current.style.opacity = '0';
            }}
            className="absolute"
            style={{
              left: rect.left, top: rect.top, width: rect.width, height: rect.height,
              opacity: MASK_OPACITY,
              // Marginea albă discretă păstrează selecția vizibilă și pe mobilier închis la culoare
              filter: 'drop-shadow(0 0 1.5px rgba(255,255,255,0.95))',
              touchAction: 'none',
              cursor: disabled ? 'not-allowed' : 'none',
            }}
          />
        )}
        {/* Cursor circular live = mărimea reală a pensulei */}
        <div
          ref={cursorRef}
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 rounded-full transition-opacity duration-150"
          style={{
            width: size, height: size, opacity: 0,
            border: `1.5px solid ${tool === 'brush' ? '#FFFFFF' : '#FAF8F6'}`,
            boxShadow: `0 0 0 1px ${MASK_TINT}, inset 0 0 0 1px rgba(92,22,40,0.35)`,
            background: tool === 'brush' ? 'rgba(92,22,40,0.18)' : 'rgba(255,255,255,0.12)',
            borderStyle: tool === 'eraser' ? 'dashed' : 'solid',
          }}
        />
        {!selected && !painting && (
          <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 max-w-[90%] rounded-full bg-[#110D0F]/70 px-3.5 py-1.5 text-center text-[12px] text-white backdrop-blur-sm">
            {t(
              'Pictează peste obiectul sau suprafața pe care vrei să o schimbi',
              'Paint over the object or surface you want to change',
              'Peignez l’objet ou la surface à modifier',
            )}
          </span>
        )}
      </div>
    </div>
  );
}
