// app/components/studio/StudioViewport.tsx
// Canvasul Studio-ului (zona 3 din 3): fotografia sursă sau comparația înainte / după, ÎNTREAGĂ (object-contain,
// cadru adaptat raportului real al imaginii), starea de randare (GenerationVeil), previzualizare pe tot ecranul.
// Toate acțiunile secundare stau într-o singură bară flotantă (pastile icon + etichetă scurtă; doar icon pe ecrane
// mici) + un meniu „Mai multe” — butoanele nu se mai împrăștie pe rânduri separate:
//   „Compară cu originalul” · „Inspector obiecte” · „Variantă nouă” · „Editează acest rezultat” · „Descarcă”
//   meniu: „Ecran complet” · „Schimbă fotografia” · „Ajustează selecția” (doar în „Editează o zonă”).
// Modul de lucru se alege în panoul din stânga; în „Editează o zonă” fotografia devine canvasul măștii (MaskEditor),
// singurul loc unde apare bara pensulei (Pensulă / Radieră / Mărime / Anulează / Resetează).
"use client";

import React, { useEffect, useRef, useState } from 'react';
import {
  Columns2, Download, Eye, EyeOff, ImagePlus, Lock, Maximize2, MoreHorizontal, PenLine, RefreshCw, ScanSearch, Upload, Wand2,
} from 'lucide-react';
import BeforeAfterSlider from '@/app/components/ui/BeforeAfterSlider';
import ImageLightbox from '@/app/components/ui/ImageLightbox';
import GenerationVeil from '@/app/components/studio/GenerationVeil';
import MaskEditor from '@/app/components/studio/MaskEditor';
import ObjectInspector from '@/app/components/studio/ObjectInspector';
import type { DetectedItem } from '@/app/lib/studio/detectedItems';
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
  /** Fotografia se citește / redimensionează. */
  isPhotoLoading?: boolean;
  /** Drag-and-drop direct pe canvas (același flux ca alegerea unui fișier). */
  onFile?: (file: File) => void;
  onPickFile?: () => void;
  /** „Nu ai o fotografie?” — camera demo. */
  onDemoPhoto?: () => void;
  /** „Editează o zonă” (inpainting) activ: fotografia se poate picta cu masca selecției. */
  editArea?: boolean;
  maskStrokes?: MaskStroke[];
  onMaskStrokesChange?: (strokes: MaskStroke[]) => void;
  onImageSize?: (size: { width: number; height: number }) => void;
  /** Rezumatul ultimei editări de zonă (ex. „prim-plan, centru · 14 % din cadru”). */
  regionalNote?: string | null;
  /** „Editează acest rezultat”: randarea devine imaginea de lucru și se deschide pensula de mască. */
  onUseResultAsSource?: () => void;
  /** „Variantă nouă” cu aceleași setări (și aceeași sămânță, dacă e fixată). */
  onNewVariant?: () => void;
  /** Obiectele detectate pe randare („Inspector obiecte”). */
  detectedItems?: readonly DetectedItem[];
  /** Fotografia inițială (pentru „Compară cu originalul” când imaginea de lucru e deja o randare). */
  rootImage?: string | null;
  /** Structura e blocată (pereți, uși, ferestre): pastila „Pereți, uși și ferestre blocate” lângă starea canvasului. */
  structureLocked?: boolean;
}

interface ToolAction {
  id: string;
  icon: typeof Eye;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  primary?: boolean;
  disabled?: boolean;
  title?: string;
  suffix?: string;
}

export default function StudioViewport({
  lang, isDark, originalImage, generatedImage, issueDate, isDemoResult, providerNote, isLoading, isPhotoLoading = false,
  onFile, onPickFile, onDemoPhoto, editArea = false, maskStrokes = [], onMaskStrokesChange, onImageSize, regionalNote,
  onUseResultAsSource, onNewVariant, detectedItems = [], rootImage = null, structureLocked = false,
}: StudioViewportProps) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const [lightbox, setLightbox] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const hasResult = Boolean(originalImage && generatedImage);
  // După o randare, „Ajustează selecția” redeschide editorul pentru ACEST rezultat (o randare nouă îl închide singură)
  const [editorFor, setEditorFor] = useState<string | null>(null);
  const showEditor = Boolean(editArea && originalImage && onMaskStrokesChange && !isLoading && (!hasResult || editorFor === generatedImage));
  // Inspectorul e activ implicit pe randări și se oprește singur cât timp se pictează masca
  const [inspectorOn, setInspectorOn] = useState(true);
  const canInspect = hasResult && !isLoading && detectedItems.length > 0;
  const inspecting = canInspect && inspectorOn && !showEditor;
  // Pas anterior din istoric (imaginea de lucru, fără randare nouă): obiectele lui rămân inspectabile
  const inspectWorking = !hasResult && !isLoading && !showEditor && inspectorOn && Boolean(originalImage) && detectedItems.length > 0;
  // „Compară cu originalul”: imaginea „înainte” devine fotografia inițială în loc de imaginea de lucru
  const [compareRoot, setCompareRoot] = useState(false);
  const canCompareRoot = Boolean(rootImage && originalImage && rootImage !== originalImage);
  const beforeImage = compareRoot && canCompareRoot ? (rootImage as string) : originalImage;
  const backdrop = isDark ? 'bg-[#110D0F]' : 'bg-[#F5F2EF]';

  // Meniul „Mai multe” se închide la click în afară sau la Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const download = () => {
    const src = generatedImage ?? originalImage;
    if (!src) return;
    const a = document.createElement('a');
    a.href = src;
    a.download = generatedImage ? 'sucvar-randare.jpg' : 'sucvar-original.jpg';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

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

  // ── Bara de acțiuni: principale (pastile) + secundare (meniu) ──
  const inline: ToolAction[] = [];
  const overflow: ToolAction[] = [];
  if (hasResult && !isLoading) {
    if (canCompareRoot) inline.push({ id: 'compare', icon: Columns2, label: t('Compară cu originalul', 'Compare with original', 'Comparer à l’original'), pressed: compareRoot, onClick: () => setCompareRoot((v) => !v) });
    if (canInspect) {
      inline.push({
        id: 'inspect',
        icon: inspecting ? ScanSearch : inspectorOn ? EyeOff : Eye,
        label: t('Inspector obiecte', 'Object inspector', 'Inspecteur d’objets'),
        pressed: inspecting,
        disabled: showEditor,
        title: showEditor ? t('Pus pe pauză cât timp pictezi masca', 'Paused while you paint the mask', 'En pause pendant que vous peignez le masque') : undefined,
        suffix: showEditor && inspectorOn ? t('pauză', 'paused', 'pause') : undefined,
        onClick: () => setInspectorOn((v) => !v),
      });
    }
    if (onNewVariant) inline.push({ id: 'variant', icon: RefreshCw, label: t('Variantă nouă', 'New variant', 'Nouvelle variante'), onClick: onNewVariant });
    if (onUseResultAsSource) inline.push({ id: 'edit', icon: PenLine, label: t('Editează acest rezultat', 'Edit this result', 'Modifier ce résultat'), primary: true, onClick: onUseResultAsSource });
    inline.push({ id: 'download', icon: Download, label: t('Descarcă', 'Download', 'Télécharger'), onClick: download });
    if (editArea && !showEditor) overflow.push({ id: 'adjust', icon: PenLine, label: t('Ajustează selecția', 'Adjust selection', 'Ajuster la sélection'), onClick: () => setEditorFor(generatedImage) });
  }
  if (originalImage && !isLoading) {
    overflow.push({ id: 'full', icon: Maximize2, label: t('Ecran complet', 'Full screen'), onClick: () => setLightbox(true) });
    if (onPickFile) overflow.push({ id: 'photo', icon: Upload, label: t('Schimbă fotografia', 'Change photo'), onClick: onPickFile });
  }
  // Fără randare: puținele acțiuni stau direct în bară (un meniu cu două opțiuni ar fi un click în plus)
  const pills = inline.length > 0 ? inline : overflow;
  const menu = inline.length > 0 ? overflow : [];

  const bar = isDark
    ? 'bg-[#1A1416]/85 border-[#2E2427] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset,0_12px_32px_-18px_rgba(0,0,0,0.8)]'
    : 'bg-white/85 border-[#E8E2E0] shadow-[0_1px_0_rgba(255,255,255,0.7)_inset,0_12px_32px_-20px_rgba(92,22,40,0.35)]';
  const pill = (a: ToolAction) =>
    `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 sm:px-3 text-[12px] font-medium whitespace-nowrap cursor-pointer touch-manipulation transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      a.primary
        ? isDark ? 'bg-[#C94A6A] text-white hover:bg-[#D65D7B]' : 'bg-[#5C1628] text-white hover:bg-[#450E1D]'
        : a.pressed
          ? 'bg-[#A67C52]/12 text-[#A67C52] ring-1 ring-inset ring-[#A67C52]/45'
          : `${sk.segOff}`
    }`;

  const statusLabel = isLoading
    ? t('Randare în curs', 'Rendering')
    : hasResult ? t('Randare finalizată', 'Render complete') : originalImage ? (editArea ? t('Pictează zona de modificat', 'Paint the area to change', 'Peignez la zone à modifier') : t('Fotografie încărcată', 'Photo loaded')) : t('Canvas', 'Canvas');

  return (
    <div className={`relative border rounded-xl p-2 sm:p-3 ${sk.card}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1 pb-2.5">
        <span className={`flex items-center gap-2 text-[12px] ${sk.muted}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${isLoading ? 'bg-amber-500 animate-pulse' : hasResult ? 'bg-emerald-500' : isDark ? 'bg-[#62535A]' : 'bg-[#A99EA1]'}`} />
          {statusLabel}
          {issueDate && <span className="hidden sm:inline font-mono tabular-nums opacity-80">· {issueDate}</span>}
          {structureLocked && originalImage && (
            <span
              className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap ${sk.chipOn}`}
              title={t(
                'Ușile, golurile și ferestrele rămân exact în poziția din fotografie. Poți debloca structura din „Mai multe opțiuni”.',
                'Doors, doorways and windows stay exactly where the photo shows them. You can unlock the structure in “More options”.',
                'Portes, passages et fenêtres restent exactement à leur place sur la photo. Vous pouvez déverrouiller la structure dans « Plus d’options ».',
              )}
            >
              <Lock className="h-3 w-3" aria-hidden />
              {t('Pereți, uși și ferestre blocate', 'Walls, doors & windows locked', 'Murs, portes et fenêtres verrouillés')}
            </span>
          )}
        </span>

        {pills.length > 0 && (
          <div
            role="toolbar"
            aria-label={t('Acțiuni canvas', 'Canvas actions', 'Actions du canevas')}
            className={`flex max-w-full items-center gap-0.5 rounded-full border p-1 backdrop-blur-md backdrop-saturate-150 ${bar}`}
          >
            <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto studio-scroll">
              {pills.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={a.onClick}
                  disabled={a.disabled}
                  aria-pressed={a.pressed}
                  aria-label={a.label}
                  title={a.title ?? a.label}
                  className={pill(a)}
                >
                  <a.icon className="w-3.5 h-3.5" aria-hidden />
                  <span className={a.primary ? 'hidden sm:inline' : 'hidden xl:inline'}>{a.label}</span>
                  {a.suffix && <span className="hidden xl:inline opacity-70">· {a.suffix}</span>}
                </button>
              ))}
            </div>
            {menu.length > 0 && (
              <div ref={menuRef} className="relative shrink-0">
                <span aria-hidden className={`mx-0.5 inline-block h-4 w-px align-middle ${isDark ? 'bg-[#2E2427]' : 'bg-[#E8E2E0]'}`} />
                <button
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label={t('Mai multe acțiuni', 'More actions', 'Plus d’actions')}
                  title={t('Mai multe', 'More', 'Plus')}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full cursor-pointer touch-manipulation transition-colors ${menuOpen ? sk.segOn : sk.segOff}`}
                >
                  <MoreHorizontal className="w-4 h-4" aria-hidden />
                </button>
                {menuOpen && (
                  <div role="menu" className={`absolute right-0 top-full z-30 mt-2 min-w-48 rounded-xl border p-1 ${sk.popover}`}>
                    {menu.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        role="menuitem"
                        onClick={() => { setMenuOpen(false); a.onClick(); }}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] cursor-pointer touch-manipulation ${sk.rowHover}`}
                      >
                        <a.icon className={`w-3.5 h-3.5 ${sk.muted}`} aria-hidden />
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

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
        <ObjectInspector lang={lang} isDark={isDark} imageSrc={generatedImage as string} items={detectedItems} enabled={inspecting}>
          <BeforeAfterSlider
            beforeImg={beforeImage as string}
            afterImg={generatedImage as string}
            beforeLabel={compareRoot && canCompareRoot ? t('Original', 'Original', 'Original') : t('Înainte', 'Before')}
            afterLabel={t('Proiect SUCVAR', 'SUCVAR design')}
            onExpand={() => setLightbox(true)}
            expandLabel={t('Ecran complet', 'Full screen')}
            className="max-h-[72vh]"
          />
        </ObjectInspector>
      ) : originalImage ? (
        <div {...dropProps} className={`relative flex items-center justify-center rounded-lg overflow-hidden border ${backdrop} ${dragOver ? 'dropzone-active' : sk.line}`}>
          <ObjectInspector lang={lang} isDark={isDark} imageSrc={originalImage} items={detectedItems} enabled={inspectWorking}>
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
            <img
              src={originalImage}
              alt={t('Fotografia sursă', 'Source photo')}
              className={`block w-full h-auto max-h-[72vh] object-contain transition-[filter,opacity] duration-700 ${isLoading ? 'opacity-90 saturate-[0.85]' : ''}`}
            />
          </ObjectInspector>
          {isLoading && <GenerationVeil lang={lang} regional={editArea} />}
        </div>
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            {...dropProps}
            onClick={onPickFile}
            disabled={!onPickFile || isPhotoLoading}
            aria-busy={isPhotoLoading}
            className={`w-full aspect-[4/3] max-h-[72vh] rounded-lg border border-dashed flex flex-col items-center justify-center gap-4 px-6 text-center cursor-pointer touch-manipulation transition-colors disabled:cursor-wait ${sk.grid} ${dragOver ? 'dropzone-active' : `${sk.line} ${sk.rowHover}`}`}
          >
            {isPhotoLoading ? (
              <>
                <span className="inline-block w-6 h-6 rounded-full border-2 border-current border-t-transparent animate-spin" />
                <span className={`text-[13px] ${sk.muted}`}>{t('Se procesează fotografia…', 'Processing photo…')}</span>
              </>
            ) : (
              <>
                <span className={`flex h-14 w-14 items-center justify-center rounded-full border ${sk.line} ${isDark ? 'bg-[#1A1416]' : 'bg-white'}`}>
                  <ImagePlus className={`w-6 h-6 ${sk.strong}`} />
                </span>
                <span>
                  <span className={`block text-[16px] font-semibold tracking-tight ${sk.strong}`}>
                    {t('Începe cu o fotografie a spațiului', 'Start with a photo of the space')}
                  </span>
                  <span className={`block mt-1.5 text-[13px] ${sk.muted}`}>
                    {t('Trage imaginea aici sau apasă pentru a alege — JPG, PNG, WebP. Rezultatul apare pe acest canvas, întreg.', 'Drop the image here or tap to choose — JPG, PNG, WebP. The result appears on this canvas, uncropped.', 'Déposez l’image ici ou touchez pour choisir — JPG, PNG, WebP. Le résultat apparaît ici, sans recadrage.')}
                  </span>
                </span>
              </>
            )}
          </button>
          {onDemoPhoto && !isPhotoLoading && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={onDemoPhoto}
                disabled={isLoading}
                className={`inline-flex items-center gap-1.5 text-[12px] font-medium underline-offset-4 hover:underline cursor-pointer touch-manipulation disabled:opacity-40 ${sk.muted}`}
              >
                <Wand2 className="w-3.5 h-3.5" aria-hidden />
                {t('Nu ai o fotografie? Încearcă o cameră demo', 'No photo? Try a demo room')}
              </button>
            </div>
          )}
        </div>
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
