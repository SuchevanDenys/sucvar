// app/components/studio/FixtureOverlay.tsx
// „Afișează repere MEP & colțuri”: suprapunere opțională, fină, peste randare — chenare de 1 px pentru prize,
// întrerupătoare și calorifere (Bordeaux #5C1628) și pentru uși, ferestre și colțuri structurale (Champagne #A67C52),
// cu un halou alb discret ca să rămână lizibile pe orice fundal. Elementele protejate de scutul MEP (pixelii originali
// restaurați după generare) au un punct plin. Stratul nu primește evenimente: comparatorul înainte / după rămâne activ.
"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fixtureColor, fixtureLabel, type DetectedFixture } from '@/app/lib/studio/fixtures';

interface FixtureOverlayProps {
  lang: string;
  /** Imaginea afișată (raportul real al conținutului `object-contain`). */
  imageSrc: string;
  fixtures: readonly DetectedFixture[];
  enabled: boolean;
  children: React.ReactNode;
}

interface Box { left: number; top: number; width: number; height: number }

/** Zona ocupată de imaginea `object-contain` în cadrul ei (aceeași regulă ca în ObjectInspector). */
function containBox(frame: Box, natural: { w: number; h: number } | null): Box {
  if (!natural || natural.w <= 0 || natural.h <= 0) return frame;
  const scale = Math.min(frame.width / natural.w, frame.height / natural.h);
  const width = natural.w * scale;
  const height = natural.h * scale;
  return { left: frame.left + (frame.width - width) / 2, top: frame.top + (frame.height - height) / 2, width, height };
}

const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

export default function FixtureOverlay({ lang, imageSrc, fixtures, enabled, children }: FixtureOverlayProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ src: string; w: number; h: number } | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const active = enabled && fixtures.length > 0;

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive) setNatural({ src: imageSrc, w: img.naturalWidth, h: img.naturalHeight }); };
    img.src = imageSrc;
    return () => { alive = false; };
  }, [imageSrc, active]);

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    const frame = wrap?.firstElementChild as HTMLElement | null;
    if (!wrap || !frame) return;
    const w = wrap.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    const next = containBox({ left: f.left - w.left, top: f.top - w.top, width: f.width, height: f.height }, natural?.src === imageSrc ? natural : null);
    setBox((prev) => (prev && Math.abs(prev.left - next.left) < 0.5 && Math.abs(prev.top - next.top) < 0.5 &&
      Math.abs(prev.width - next.width) < 0.5 && Math.abs(prev.height - next.height) < 0.5 ? prev : next));
  }, [natural, imageSrc]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!active || !wrap) return;
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [active, measure]);

  return (
    <div ref={wrapRef} className="relative w-full">
      {children}
      {active && box && box.width > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-30 animate-[gen-fade-in_200ms_ease-out]"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        >
          <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
            {fixtures.map((f, i) => {
              const color = fixtureColor(f.kind);
              if (f.kind === 'corner') {
                // Colț structural: reticul fin centrat pe joncțiune
                const cx = (f.x + f.width / 2) * 100;
                const cy = (f.y + f.height / 2) * 100;
                const arm = 1.6;
                return (
                  <g key={i}>
                    {[0, 1].map((layer) => (
                      <path
                        key={layer}
                        d={`M${cx - arm},${cy} H${cx + arm} M${cx},${cy - arm} V${cy + arm}`}
                        stroke={layer === 0 ? 'rgba(255,255,255,0.75)' : color}
                        strokeWidth={layer === 0 ? 3 : 1}
                        vectorEffect="non-scaling-stroke"
                        fill="none"
                      />
                    ))}
                  </g>
                );
              }
              return (
                <g key={i}>
                  <rect x={f.x * 100} y={f.y * 100} width={f.width * 100} height={f.height * 100}
                    fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={3} vectorEffect="non-scaling-stroke" />
                  <rect x={f.x * 100} y={f.y * 100} width={f.width * 100} height={f.height * 100}
                    fill={f.shielded ? `${color}14` : 'none'} stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke"
                    strokeDasharray={f.kind === 'door' || f.kind === 'window' ? '4 3' : undefined} />
                </g>
              );
            })}
          </svg>
          {fixtures.map((f, i) => (
            <span
              key={i}
              className="absolute -translate-y-full whitespace-nowrap rounded-[3px] px-1 py-px text-[9.5px] font-medium leading-[13px] tracking-wide text-white shadow-[0_1px_3px_rgba(17,13,15,0.35)]"
              style={{ left: pct(f.x), top: pct(f.y), backgroundColor: fixtureColor(f.kind), marginTop: -2 }}
            >
              {f.shielded && <span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full bg-white/90 align-middle" />}
              {fixtureLabel(f.kind, lang)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
