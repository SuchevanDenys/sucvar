// app/components/ui/Editorial.tsx
// Editorial / architectural presentational pieces built on the SUCVAR skin.
// Pure presentational, SSR-safe, no hooks.
import React from 'react';
import { EYEBROW, getSkin, ruleClass } from '@/app/lib/theme/skin';

/** Pulsing telemetry dot + label, e.g. "ENGINE ONLINE". */
export function LiveDot({
  label,
  active = true,
  className = '',
}: {
  label: string;
  active?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${EYEBROW} ${className}`}>
      <span className="relative flex h-1.5 w-1.5">
        {active && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-40" />
        )}
        <span
          className={`relative inline-flex h-1.5 w-1.5 rounded-full ${active ? 'bg-current' : 'bg-current opacity-40'}`}
        />
      </span>
      {label}
    </span>
  );
}

/** Architectural frame with FIG caption. */
export function Frame({
  isDark,
  label,
  meta,
  className = '',
  children,
}: {
  isDark: boolean;
  label?: string;
  meta?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const sk = getSkin(isDark);
  return (
    <figure className={`relative ${className}`}>
      {(label || meta) && (
        <figcaption className={`mb-3 flex items-center justify-between ${EYEBROW} ${sk.dim}`}>
          <span>{label}</span>
          <span className="tabular-nums">{meta}</span>
        </figcaption>
      )}
      <div
        className={`relative rounded-md border p-2 sm:p-3 ${sk.line} ${
          isDark
            ? 'bg-[#1A1416] shadow-[0_24px_48px_-32px_rgba(0,0,0,0.8)]'
            : 'bg-[#F5F2EF] shadow-[0_24px_48px_-36px_rgba(92,22,40,0.35)]'
        }`}
      >
        {children}
        <CornerTicks isDark={isDark} />
      </div>
    </figure>
  );
}

/**
 * Repere de colț ca pe o planșă de arhitectură: patru unghiuri drepte de 1px, în șampanie, așezate
 * peste linia fină a ramei. Pur decorative (aria-hidden), fără mișcare.
 */
export function CornerTicks({ isDark, className = '' }: { isDark: boolean; className?: string }) {
  const tone = isDark ? 'border-[#C49A6C]/55' : 'border-[#A67C52]/60';
  const tick = `pointer-events-none absolute h-3 w-3 ${tone}`;
  return (
    <span aria-hidden className={className}>
      <span className={`${tick} -left-px -top-px rounded-tl-md border-l border-t`} />
      <span className={`${tick} -right-px -top-px rounded-tr-md border-r border-t`} />
      <span className={`${tick} -bottom-px -left-px rounded-bl-md border-b border-l`} />
      <span className={`${tick} -bottom-px -right-px rounded-br-md border-b border-r`} />
    </span>
  );
}

/** "§01 ── EYEBROW" + two-tone title. */
export function SectionHeading({
  isDark,
  index,
  eyebrow,
  title,
  titleMuted,
}: {
  isDark: boolean;
  index: string;
  eyebrow: string;
  title: string;
  titleMuted?: string;
}) {
  const sk = getSkin(isDark);
  return (
    <div>
      <p className={`flex items-center gap-3 ${EYEBROW} ${sk.dim}`}>
        <span className={sk.accent}>§{index}</span>
        <span className={`h-px w-8 ${ruleClass(isDark)}`} />
        {eyebrow}
      </p>
      <h2
        className={`mt-6 max-w-2xl text-3xl sm:text-[2.6rem] font-semibold leading-[1.08] tracking-tight ${sk.strong}`}
      >
        {title}
        {titleMuted ? <> <span className={sk.muted}>{titleMuted}</span></> : null}
      </h2>
    </div>
  );
}