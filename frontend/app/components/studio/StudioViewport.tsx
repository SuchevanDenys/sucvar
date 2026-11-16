// app/components/studio/StudioViewport.tsx
// Canvasul Studio-ului: fotografia sursă sau comparația înainte / după, ÎNTREAGĂ (object-contain, cadru adaptat
// raportului real al imaginii), starea de randare (voal + etapă + bară de progres), previzualizare pe tot ecranul.
"use client";

import React, { useState } from 'react';
import { ImagePlus, Maximize2 } from 'lucide-react';
import BeforeAfterSlider from '@/app/components/ui/BeforeAfterSlider';
import ImageLightbox from '@/app/components/ui/ImageLightbox';
import { getSkin } from '@/app/lib/theme/skin';
import type { Language } from '@/app/types';
import { tr } from '@/app/lib/i18n';

interface StudioViewportProps {
  lang: Language;
  isDark: boolean;
  originalImage: string | null;
  generatedImage: string | null;
  issueDate: string;
  isDemoResult: boolean;
  providerNote: string | null;
  isLoading: boolean;
  loadingLabel: string;
  /** Etapa curentă (0-based) și numărul de etape ale randării, pentru indicatorul de progres. */
  loadingStep: number;
  loadingSteps: number;
  /** Drag-and-drop direct pe canvas (același flux ca încărcarea din panoul de control). */
  onFile?: (file: File) => void;
  onPickFile?: () => void;
}

export default function StudioViewport({
  lang, isDark, originalImage, generatedImage, issueDate, isDemoResult, providerNote, isLoading, loadingLabel,
  loadingStep, loadingSteps, onFile, onPickFile,
}: StudioViewportProps) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const [lightbox, setLightbox] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const hasResult = Boolean(originalImage && generatedImage);
  const backdrop = isDark ? 'bg-[#0B0B0C]' : 'bg-[#F5F5F5]';

  const dropProps = onFile && !isLoading
    ? {
        onDragOver: (e: React.DragEvent) => {
          e.preventDefault();
          setDragOver(true);
        },
        onDragLeave: () => setDragOver(false),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFile(file);
        },
      }
    : {};

  return (
    <div className={`relative border rounded-xl p-2 sm:p-3 ${sk.card}`}>
      <div className={`flex items-center justify-between gap-3 px-1.5 pb-2.5 text-[12px] ${sk.muted}`}>
        <span className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${isLoading ? 'bg-amber-500 animate-pulse' : hasResult ? 'bg-emerald-500' : isDark ? 'bg-[#52525B]' : 'bg-[#A3A3A3]'}`} />
          {isLoading ? t('Randare în curs', 'Rendering') : hasResult ? t('Randare finalizată', 'Render complete') : originalImage ? t('Fotografie încărcată', 'Photo loaded') : t('Canvas', 'Canvas')}
        </span>
        <span className="flex items-center gap-3">
          {issueDate && <span className="font-mono tabular-nums">{issueDate}</span>}
          {(hasResult || originalImage) && !isLoading && (
            <button
              type="button"
              onClick={() => setLightbox(true)}
              className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium cursor-pointer touch-manipulation ${sk.btnGhost}`}
            >
              <Maximize2 className="w-3.5 h-3.5" />
              {t('Ecran complet', 'Full screen')}
            </button>
          )}
        </span>
      </div>

      {hasResult && !isLoading ? (
        <BeforeAfterSlider
          beforeImg={originalImage as string}
          afterImg={generatedImage as string}
          beforeLabel={t('Înainte', 'Before')}
          afterLabel={t('Proiect SUCVAR', 'SUCVAR design')}
          onExpand={() => setLightbox(true)}
          expandLabel={t('Ecran complet', 'Full screen')}
          className="max-h-[72vh]"
        />
      ) : originalImage ? (
        <div {...dropProps} className={`relative flex items-center justify-center rounded-lg overflow-hidden border ${backdrop} ${dragOver ? 'dropzone-active' : sk.line}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
          <img
            src={originalImage}
            alt={t('Fotografia sursă', 'Source photo')}
            className={`block w-full h-auto max-h-[72vh] object-contain transition-[filter,opacity] duration-500 ${isLoading ? 'opacity-70 blur-[2px]' : ''}`}
          />
          {isLoading && (
            <>
              <div aria-hidden className="scan-line z-10" />
              <div className="absolute inset-0 z-20 flex items-center justify-center p-4" role="status" aria-live="polite">
                <div className="w-full max-w-xs rounded-xl bg-[#0B0B0C]/75 backdrop-blur-md px-5 py-4 text-white shadow-2xl">
                  <p className="text-[13px] font-medium">{loadingLabel}</p>
                  <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/15">
                    <div className="studio-progress h-full w-1/3 rounded-full bg-white" />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[11px] text-white/60">
                    <span className="flex gap-1">
                      {Array.from({ length: loadingSteps }).map((_, i) => (
                        <span key={i} className={`h-1.5 w-1.5 rounded-full ${i <= loadingStep ? 'bg-white' : 'bg-white/25'}`} />
                      ))}
                    </span>
                    <span>{t('de obicei 20–60 s', 'usually 20–60 s')}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <button
          type="button"
          {...dropProps}
          onClick={onPickFile}
          disabled={!onPickFile}
          className={`w-full aspect-[4/3] max-h-[72vh] rounded-lg border border-dashed flex flex-col items-center justify-center gap-4 px-6 text-center cursor-pointer touch-manipulation transition-colors ${sk.grid} ${dragOver ? 'dropzone-active' : `${sk.line} ${sk.rowHover}`}`}
        >
          <span className={`flex h-14 w-14 items-center justify-center rounded-full border ${sk.line} ${isDark ? 'bg-[#141416]' : 'bg-white'}`}>
            <ImagePlus className={`w-6 h-6 ${sk.strong}`} />
          </span>
          <span>
            <span className={`block text-[16px] font-semibold tracking-tight ${sk.strong}`}>
              {t('Începe cu o fotografie a spațiului', 'Start with a photo of the space')}
            </span>
            <span className={`block mt-1.5 text-[13px] ${sk.muted}`}>
              {t('Trage imaginea aici — rezultatul apare pe acest canvas, întreg, fără decupaje.', 'Drop the image here — the result appears on this canvas, uncropped.')}
            </span>
          </span>
        </button>
      )}

      {(isDemoResult || providerNote) && !isLoading && (
        <div className="px-1.5 pt-2.5 space-y-1">
          {isDemoResult && (
            <p className={`text-xs ${sk.muted}`}>
              {t('Mod demonstrativ: imagine de test (furnizor AI neconfigurat).', 'Demo mode: sample image (no AI provider configured).')}
            </p>
          )}
          {providerNote && <p className="text-xs text-red-500 font-mono">{providerNote}</p>}
        </div>
      )}

      {(generatedImage || originalImage) && (
        <ImageLightbox
          open={lightbox}
          onClose={() => setLightbox(false)}
          src={(generatedImage ?? originalImage) as string}
          beforeSrc={generatedImage ? originalImage : null}
          alt={t('Randare SUCVAR', 'SUCVAR render')}
          labels={{ before: t('Înainte', 'Before'), after: t('După', 'After'), close: t('Închide', 'Close'), download: t('Descarcă', 'Download') }}
          downloadName={generatedImage ? 'sucvar-randare.jpg' : 'sucvar-original.jpg'}
        />
      )}
    </div>
  );
}
