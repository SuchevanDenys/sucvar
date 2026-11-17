// app/components/studio/StudioViewport.tsx
// Canvasul Studio-ului: fotografia sursă sau comparația înainte / după, ÎNTREAGĂ (object-contain, cadru adaptat
// raportului real al imaginii), starea de randare (voal + etapă + bară de progres), previzualizare pe tot ecranul.
// Comutatorul „Redesign complet” / „Editează o zonă”: în modul zonă, fotografia devine un canvas de mască (MaskEditor).
"use client";

import React, { useState } from 'react';
import { ImagePlus, Maximize2, PenLine, Repeat2, Sparkles } from 'lucide-react';
import BeforeAfterSlider from '@/app/components/ui/BeforeAfterSlider';
import ImageLightbox from '@/app/components/ui/ImageLightbox';
import MaskEditor from '@/app/components/studio/MaskEditor';
import type { MaskStroke } from '@/app/lib/studio/mask';
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
  /** „Editează o zonă” (inpainting) activ: fotografia se poate picta cu masca selecției. */
  editArea?: boolean;
  onEditAreaChange?: (value: boolean) => void;
  maskStrokes?: MaskStroke[];
  onMaskStrokesChange?: (strokes: MaskStroke[]) => void;
  onImageSize?: (size: { width: number; height: number }) => void;
  /** Rezumatul ultimei editări de zonă (ex. „prim-plan, centru · 14 % din cadru”). */
  regionalNote?: string | null;
  /** Continuă editarea pe rezultat (randarea devine noua fotografie sursă). */
  onUseResultAsSource?: () => void;
}

export default function StudioViewport({
  lang, isDark, originalImage, generatedImage, issueDate, isDemoResult, providerNote, isLoading, loadingLabel,
  loadingStep, loadingSteps, onFile, onPickFile,
  editArea = false, onEditAreaChange, maskStrokes = [], onMaskStrokesChange, onImageSize, regionalNote, onUseResultAsSource,
}: StudioViewportProps) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const [lightbox, setLightbox] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const hasResult = Boolean(originalImage && generatedImage);
  // După o randare, „Ajustează selecția” redeschide editorul pentru ACEST rezultat (o randare nouă îl închide singură)
  const [editorFor, setEditorFor] = useState<string | null>(null);
  const showEditor = Boolean(editArea && originalImage && onMaskStrokesChange && !isLoading && (!hasResult || editorFor === generatedImage));
  const seg = (on: boolean) =>
    `inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium cursor-pointer touch-manipulation transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      on ? (isDark ? 'bg-[#C94A6A] text-white' : 'bg-[#5C1628] text-white') : sk.segOff
    }`;
  const backdrop = isDark ? 'bg-[#110D0F]' : 'bg-[#F5F2EF]';

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
          <span className={`h-1.5 w-1.5 rounded-full ${isLoading ? 'bg-amber-500 animate-pulse' : hasResult ? 'bg-emerald-500' : isDark ? 'bg-[#62535A]' : 'bg-[#A99EA1]'}`} />
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

      {originalImage && onEditAreaChange && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2.5">
          <div
            role="radiogroup"
            aria-label={t('Tip de editare', 'Edit type', 'Type de modification')}
            className={`inline-flex rounded-full border p-0.5 ${sk.line} ${isDark ? 'bg-[#110D0F]' : 'bg-[#FAF8F6]'}`}
          >
            <button type="button" role="radio" aria-checked={!editArea} disabled={isLoading} onClick={() => onEditAreaChange(false)} className={seg(!editArea)}>
              <Sparkles className="w-3.5 h-3.5" aria-hidden />
              {t('Redesign complet', 'Full redesign', 'Refonte complète')}
            </button>
            <button type="button" role="radio" aria-checked={editArea} disabled={isLoading} onClick={() => onEditAreaChange(true)} className={seg(editArea)}>
              <PenLine className="w-3.5 h-3.5" aria-hidden />
              {t('Editează o zonă', 'Edit selected area', 'Modifier une zone')}
            </button>
          </div>
          {editArea && hasResult && !isLoading && (
            <span className="flex flex-wrap gap-1.5">
              {!showEditor && (
                <button type="button" onClick={() => setEditorFor(generatedImage)} className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium cursor-pointer touch-manipulation ${sk.btnGhost}`}>
                  <PenLine className="w-3.5 h-3.5" aria-hidden />
                  {t('Ajustează selecția', 'Adjust selection', 'Ajuster la sélection')}
                </button>
              )}
              {onUseResultAsSource && (
                <button type="button" onClick={onUseResultAsSource} className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium cursor-pointer touch-manipulation ${sk.btnGhost}`}>
                  <Repeat2 className="w-3.5 h-3.5" aria-hidden />
                  {t('Continuă pe rezultat', 'Continue on result', 'Continuer sur le résultat')}
                </button>
              )}
            </span>
          )}
        </div>
      )}

      {showEditor ? (
        <MaskEditor
          lang={lang}
          isDark={isDark}
          src={originalImage as string}
          strokes={maskStrokes}
          onStrokesChange={onMaskStrokesChange as (s: MaskStroke[]) => void}
          onImageSize={onImageSize}
        />
      ) : hasResult && !isLoading ? (
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
                <div className="w-full max-w-xs rounded-xl border border-white/10 border-t-white/20 bg-[#110D0F]/70 backdrop-blur-md backdrop-saturate-150 px-5 py-4 text-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.4),0_28px_60px_-24px_rgba(17,13,15,0.85)]">
                  <p className="text-[13px] font-medium">{loadingLabel}</p>
                  <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/15">
                    <div className="studio-progress h-full w-1/3 rounded-full bg-[#C94A6A]" />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[11px] text-white/60">
                    <span className="flex gap-1">
                      {Array.from({ length: loadingSteps }).map((_, i) => (
                        <span key={i} className={`h-1.5 w-1.5 rounded-full ${i <= loadingStep ? 'bg-[#D65D7B]' : 'bg-white/25'}`} />
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
          <span className={`flex h-14 w-14 items-center justify-center rounded-full border ${sk.line} ${isDark ? 'bg-[#1A1416]' : 'bg-white'}`}>
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

      {(isDemoResult || providerNote || (regionalNote && hasResult)) && !isLoading && (
        <div className="px-1.5 pt-2.5 space-y-1">
          {regionalNote && hasResult && (
            <p className={`flex items-center gap-1.5 text-xs ${sk.muted}`}>
              <PenLine className="w-3 h-3" aria-hidden />
              {regionalNote}
            </p>
          )}
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
