// app/components/studio/SourcePhotoCard.tsx
// Studio · 01 — fotografia sursă: zonă drag-and-drop (sau click / cameră pe mobil), previzualizare COMPLETĂ
// (object-contain, fără decupare), „Schimbă fotografia”, camera demo și intensitatea transformării AI
// (banda recomandată 68–75 % e marcată pe glisor).
"use client";

import React, { useId, useRef, useState } from 'react';
import { ImagePlus, RefreshCw, Wand2 } from 'lucide-react';
import { tr } from '@/app/lib/i18n';
import { AI_STRENGTH } from '@/app/lib/studio/aiConfig';
import { ACCEPTED_PHOTO_TYPES } from '@/app/lib/studio/constants';
import { getSkin } from '@/app/lib/theme/skin';
import type { Language } from '@/app/types';
import { StudioCard } from './StudioCard';

const STRENGTH_MIN = 40, STRENGTH_MAX = 100;
/** Poziția (%) a unei valori pe glisor, pentru banda recomandată */
const pct = (v: number) => ((v - STRENGTH_MIN) / (STRENGTH_MAX - STRENGTH_MIN)) * 100;

interface SourcePhotoCardProps {
  lang: Language;
  isDark: boolean;
  originalImage: string | null;
  /** Fotografia se citește / redimensionează (blochează alegerea alteia). */
  isPhotoLoading: boolean;
  /** O randare rulează (blochează schimbarea fotografiei). */
  isLoading: boolean;
  aiStrength: number;
  /** Același flux pentru click, cameră și drag-and-drop. */
  onFile: (file: File) => void;
  onDemoPhoto: () => void;
  onStrengthChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** false = modelul activ nu folosește intensitatea (FLUX Kontext urmează instrucțiunea, fără prompt_strength). */
  showStrength?: boolean;
}

export default function SourcePhotoCard({
  lang, isDark, originalImage, isPhotoLoading, isLoading, aiStrength, onFile, onDemoPhoto, onStrengthChange, showStrength = true,
}: SourcePhotoCardProps) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const locked = isLoading || isPhotoLoading;
  const helpId = useId();
  const inSweetSpot = aiStrength >= AI_STRENGTH.sweetSpot.min && aiStrength <= AI_STRENGTH.sweetSpot.max;

  const pick = () => fileInputRef.current?.click();
  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite alegerea aceluiași fișier de două ori la rând
    if (file) onFile(file);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (locked) return;
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };
  const dragProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      if (!locked) setDragOver(true);
    },
    onDragLeave: () => setDragOver(false),
    onDrop,
  };
  const backdrop = isDark ? 'bg-[#110D0F]' : 'bg-[#F5F2EF]';

  return (
    <StudioCard
      isDark={isDark}
      step="01"
      title={t('Fotografia sursă', 'Source photo')}
      aside={originalImage && !isPhotoLoading ? (
        <button
          type="button"
          onClick={pick}
          disabled={locked}
          className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium cursor-pointer touch-manipulation disabled:opacity-40 disabled:cursor-not-allowed ${sk.btnGhost}`}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t('Schimbă fotografia', 'Change photo')}
        </button>
      ) : undefined}
    >
      <input ref={fileInputRef} type="file" accept={ACCEPTED_PHOTO_TYPES.join(',')} onChange={onInput} className="hidden" />

      {originalImage && !isPhotoLoading ? (
        <div
          {...dragProps}
          className={`relative flex items-center justify-center rounded-lg border overflow-hidden ${backdrop} ${dragOver ? 'dropzone-active' : sk.line}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
          <img src={originalImage} alt={t('Fotografia sursă', 'Source photo')} className="block w-full h-auto max-h-64 object-contain" />
          {dragOver && (
            <span className="absolute inset-0 flex items-center justify-center bg-[#110D0F]/45 text-white text-[13px] font-medium">
              {t('Eliberează pentru a înlocui', 'Drop to replace')}
            </span>
          )}
        </div>
      ) : (
        <button
          type="button"
          {...dragProps}
          disabled={locked}
          aria-busy={isPhotoLoading}
          onClick={pick}
          className={`w-full min-h-44 rounded-lg border border-dashed flex flex-col items-center justify-center gap-3 px-6 py-8 text-center cursor-pointer touch-manipulation transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            dragOver ? 'dropzone-active' : `${sk.line} ${sk.rowHover}`
          }`}
        >
          {isPhotoLoading ? (
            <>
              <span className="inline-block w-5 h-5 rounded-full border-2 border-current border-t-transparent animate-spin" />
              <span className={`text-[13px] ${sk.muted}`}>{t('Se procesează fotografia…', 'Processing photo…')}</span>
            </>
          ) : (
            <>
              <span className={`flex h-11 w-11 items-center justify-center rounded-full ${backdrop}`}>
                <ImagePlus className={`w-5 h-5 ${sk.strong}`} />
              </span>
              <span>
                <span className={`block text-[14px] font-medium ${sk.strong}`}>
                  {t('Trage fotografia aici sau alege un fișier', 'Drag your photo here or choose a file')}
                </span>
                <span className={`block mt-1 text-[12px] ${sk.muted}`}>JPG, PNG, WebP · {t('sau fotografiază cu telefonul', 'or take one with your phone')}</span>
              </span>
            </>
          )}
        </button>
      )}

      {!originalImage && !isPhotoLoading && (
        <button
          type="button"
          onClick={onDemoPhoto}
          disabled={isLoading}
          className={`inline-flex items-center gap-1.5 text-[12px] font-medium underline-offset-4 hover:underline cursor-pointer touch-manipulation disabled:opacity-40 ${sk.muted}`}
        >
          <Wand2 className="w-3.5 h-3.5" />
          {t('Nu ai o fotografie? Încearcă o cameră demo', 'No photo? Try a demo room')}
        </button>
      )}

      {showStrength && (
      <label className="block space-y-2">
        <span className="flex items-center justify-between text-[13px]">
          <span className={`font-medium ${sk.strong}`}>{t('Intensitate transformare', 'Transformation strength')}</span>
          <span className={`font-mono tabular-nums ${sk.strong}`}>
            {aiStrength}%
            {inSweetSpot && <span className={`ml-1.5 text-[11px] font-sans ${sk.muted}`}>· {t('optim', 'optimal', 'optimal')}</span>}
          </span>
        </span>
        <span className="relative block">
          {/* Banda recomandată 68–75 % (structură păstrată, finisaje complet transformate) */}
          <span
            aria-hidden
            className={`pointer-events-none absolute top-1/2 -translate-y-1/2 h-2 rounded-full ${isDark ? 'bg-[#C94A6A]/30' : 'bg-[#5C1628]/15'}`}
            style={{ left: `${pct(AI_STRENGTH.sweetSpot.min)}%`, width: `${pct(AI_STRENGTH.sweetSpot.max) - pct(AI_STRENGTH.sweetSpot.min)}%` }}
          />
          <input
            type="range" min={STRENGTH_MIN} max={STRENGTH_MAX}
            value={aiStrength}
            onChange={onStrengthChange}
            disabled={isLoading}
            aria-describedby={helpId}
            className="relative w-full accent-[var(--foreground)] touch-manipulation touch-pan-y"
          />
        </span>
        <span className={`flex justify-between text-[11px] ${sk.muted}`}>
          <span>{t('Subtil', 'Subtle')}</span>
          <span>{t('Transformare completă', 'Full makeover')}</span>
        </span>
        <span id={helpId} className={`block text-[11px] leading-relaxed ${sk.muted}`}>
          {t(
            `Recomandat ${AI_STRENGTH.sweetSpot.min}–${AI_STRENGTH.sweetSpot.max}%: finisajele, mobilierul și lumina se schimbă complet, iar pereții, ferestrele și unghiul rămân. Cu structura păstrată, AI-ul aplică între ${AI_STRENGTH.preserveRange.min} și ${AI_STRENGTH.preserveRange.max}%.`,
            `Recommended ${AI_STRENGTH.sweetSpot.min}–${AI_STRENGTH.sweetSpot.max}%: finishes, furniture and light change completely while walls, windows and camera angle stay. With structure kept, the AI applies ${AI_STRENGTH.preserveRange.min}–${AI_STRENGTH.preserveRange.max}%.`,
          )}
        </span>
      </label>
      )}
    </StudioCard>
  );
}
