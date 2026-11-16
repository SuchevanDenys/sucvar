// app/components/studio/SourcePhotoCard.tsx
// Studio · 01 — fotografia sursă: zonă drag-and-drop (sau click / cameră pe mobil), previzualizare COMPLETĂ
// (object-contain, fără decupare), „Schimbă fotografia”, camera demo și intensitatea transformării AI.
"use client";

import React, { useRef, useState } from 'react';
import { ImagePlus, RefreshCw, Wand2 } from 'lucide-react';
import { tr } from '@/app/lib/i18n';
import { ACCEPTED_PHOTO_TYPES } from '@/app/lib/studio/constants';
import { getSkin } from '@/app/lib/theme/skin';
import type { Language } from '@/app/types';
import { StudioCard } from './StudioCard';

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
}

export default function SourcePhotoCard({
  lang, isDark, originalImage, isPhotoLoading, isLoading, aiStrength, onFile, onDemoPhoto, onStrengthChange,
}: SourcePhotoCardProps) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const locked = isLoading || isPhotoLoading;

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
  const backdrop = isDark ? 'bg-[#0B0B0C]' : 'bg-[#F5F5F5]';

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
            <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white text-[13px] font-medium">
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

      <label className="block space-y-2">
        <span className="flex items-center justify-between text-[13px]">
          <span className={`font-medium ${sk.strong}`}>{t('Intensitatea transformării', 'Transformation strength')}</span>
          <span className={`font-mono tabular-nums ${sk.strong}`}>{aiStrength}%</span>
        </span>
        <input
          type="range" min={40} max={100}
          value={aiStrength}
          onChange={onStrengthChange}
          disabled={isLoading}
          className="w-full accent-[var(--foreground)] touch-manipulation touch-pan-y"
        />
        <span className={`flex justify-between text-[11px] ${sk.muted}`}>
          <span>{t('Subtil', 'Subtle')}</span>
          <span>{t('Transformare completă', 'Full makeover')}</span>
        </span>
      </label>
    </StudioCard>
  );
}
