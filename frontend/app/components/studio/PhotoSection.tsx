// app/components/studio/PhotoSection.tsx
// Studio · 01 — încărcarea fotografiei (sau camera demo) și intensitatea transformării AI.
"use client";

import React, { useRef } from 'react';
import { ImagePlus, Wand2 } from 'lucide-react';
import { tr } from '@/app/lib/i18n';
import { ACCEPTED_PHOTO_TYPES } from '@/app/lib/studio/constants';
import { EYEBROW, getSkin } from '@/app/lib/theme/skin';
import type { Language } from '@/app/types';

interface PhotoSectionProps {
  lang: Language;
  isDark: boolean;
  originalImage: string | null;
  /** Fotografia se citește / redimensionează (blochează alegerea alteia). */
  isPhotoLoading: boolean;
  /** O randare rulează (blochează schimbarea fotografiei). */
  isLoading: boolean;
  aiStrength: number;
  onPhotoChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDemoPhoto: () => void;
  onStrengthChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function PhotoSection({
  lang, isDark, originalImage, isPhotoLoading, isLoading, aiStrength, onPhotoChange, onDemoPhoto, onStrengthChange,
}: PhotoSectionProps) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const eyebrow = `${EYEBROW} ${sk.dim}`;
  // Input-ul de fișier e ascuns; butonul mare îl deschide (permite și camera pe mobil).
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <section className={`border rounded-md ${sk.card}`}>
      <div className={`px-4 h-9 flex items-center border-b ${sk.line} ${eyebrow}`}>
        01 · {t('Fotografie', 'Photo')}
      </div>
      <div className="p-4 space-y-4">
        <input ref={fileInputRef} type="file" accept={ACCEPTED_PHOTO_TYPES.join(',')} onChange={onPhotoChange} className="hidden" />
        <button
          type="button"
          disabled={isLoading || isPhotoLoading}
          aria-busy={isPhotoLoading}
          onClick={() => fileInputRef.current?.click()}
          className={`relative w-full h-40 border border-dashed rounded-md flex flex-col items-center justify-center gap-2 overflow-hidden cursor-pointer touch-manipulation transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${sk.btnGhost}`}
        >
          {isPhotoLoading
            ? <span className={EYEBROW}>{t('Se procesează fotografia…', 'Processing photo…')}</span>
            : originalImage
            ? <img src={originalImage} alt="Original" className="w-full h-full object-cover" />
            : (
              <>
                <ImagePlus className="w-5 h-5 opacity-60" />
                <span className={EYEBROW}>{t('Încarcă sau fotografiază', 'Upload or take a photo')}</span>
              </>
            )}
        </button>

        {!originalImage && !isPhotoLoading && (
          <button
            type="button"
            onClick={onDemoPhoto}
            disabled={isLoading}
            className={`w-full inline-flex items-center justify-center gap-2 h-10 rounded-sm cursor-pointer touch-manipulation disabled:opacity-40 ${EYEBROW} ${sk.btnGhost}`}
          >
            <Wand2 className="w-3.5 h-3.5" />
            {t('Încearcă cu o cameră demo', 'Try a demo room')}
          </button>
        )}

        <label className="block space-y-2">
          <span className={`flex items-center justify-between ${eyebrow}`}>
            <span>{t('Intensitatea transformării', 'Transformation strength')}</span>
            <span className={`tabular-nums ${sk.strong}`}>{aiStrength}%</span>
          </span>
          <input
            type="range" min={40} max={100}
            value={aiStrength}
            onChange={onStrengthChange}
            className="w-full accent-[var(--foreground)] touch-manipulation touch-pan-y"
          />
        </label>

      </div>
    </section>
  );
}
