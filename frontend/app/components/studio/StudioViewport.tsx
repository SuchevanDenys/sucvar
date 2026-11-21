// app/components/studio/StudioViewport.tsx
// Canvasul Studio-ului (zona 3 din 3): fotografia sursă sau comparația înainte / după, ÎNTREAGĂ (object-contain,
// cadru adaptat raportului real al imaginii), starea de randare (GenerationVeil), previzualizare pe tot ecranul.
// Toate acțiunile secundare stau într-o singură bară flotantă (pastile icon + etichetă scurtă; doar icon pe ecrane
// mici) + un meniu „Mai multe” — butoanele nu se mai împrăștie pe rânduri separate:
//   „Compară cu originalul” · „Inspector obiecte” · „Afișează repere MEP & colțuri” · „Variantă nouă” · „Editează acest rezultat” · „Descarcă”
//   meniu: „Ecran complet” · „Schimbă fotografia” · „Ajustează selecția” (doar în „Editează o zonă”).
// Modul de lucru se alege în panoul din stânga; în „Editează o zonă” fotografia devine canvasul măștii (MaskEditor),
// singurul loc unde apare bara pensulei (Pensulă / Radieră / Mărime / Anulează / Resetează).
// Sus: comutatorul celor două surse — „1. Fotografie cameră” (încărcare / demo) și „2. Proiect scanat 3D (LiDAR)”
// (perspectiva interioară a scanării: insignă cu cotele, unghiul camerei 3D, alt fișier LiDAR). Ambele surse trec prin
// același canvas: Redesign, Optimizare spațiu, Editează o zonă și „Editează acest rezultat”.
"use client";

import React, { useEffect, useRef, useState } from 'react';
import {
  Box, Camera, Columns2, Crosshair, Download, Eye, EyeOff, FileBox, ImagePlus, Lock, Maximize2, MoreHorizontal, PenLine, RefreshCw, RotateCcw, RotateCw,
  ScanLine, ScanSearch, Smartphone, Sparkles, SwitchCamera, Upload, Wand2,
} from 'lucide-react';
import BeforeAfterSlider from '@/app/components/ui/BeforeAfterSlider';
import ImageLightbox from '@/app/components/ui/ImageLightbox';
import GenerationVeil from '@/app/components/studio/GenerationVeil';
import MaskEditor from '@/app/components/studio/MaskEditor';
import ObjectInspector from '@/app/components/studio/ObjectInspector';
import FixtureOverlay from '@/app/components/studio/FixtureOverlay';
import type { DetectedItem } from '@/app/lib/studio/detectedItems';
import { fixtureSummary, type DetectedFixture } from '@/app/lib/studio/fixtures';
import type { MaskStroke } from '@/app/lib/studio/mask';
import { getSkin } from '@/app/lib/theme/skin';
import type { Language } from '@/app/types';
import { tr } from '@/app/lib/i18n';
import { cameraPresetLabel, meshPresetLabel, type MeshViewPreset } from '@/app/lib/studio/scanRender';

/** Sursa Studio-ului: fotografia camerei sau perspectiva interioară a unei scanări 3D LiDAR. */
export type StudioSource = 'photo' | 'scan';
/** Acțiunile de unghi din Studio: presetările sau rotirea manuală (±22,5°) a privirii („overview” doar pe plasa reală). */
export type ScanAngleAction = 'overview' | 'entry' | 'window' | 'left' | 'right';

export interface StudioScanInfo {
  /** „Sursă 3D LiDAR · 4,85 × 3,90 × 2,65 m · 1 ușă · 2 ferestre”. */
  badge: string;
  preset: MeshViewPreset;
  /** Plasa reală texturată (WebGL): presetările „Vedere ansamblu” / „Unghi interior 1 / 2”. */
  realMesh?: boolean;
  /** Unghiul nou se randează (plasa reală, asincron). */
  busy?: boolean;
}

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
  /** Reperele structurale și MEP detectate înainte de randare (doar pentru randarea afișată; [] = fără comutator). */
  detectedFixtures?: readonly DetectedFixture[];
  /** Fotografia inițială (pentru „Compară cu originalul” când imaginea de lucru e deja o randare). */
  rootImage?: string | null;
  /** Structura e blocată (pereți, uși, ferestre): pastila „Pereți, uși și ferestre blocate” lângă starea canvasului. */
  structureLocked?: boolean;
  /** Comutatorul de sursă (absent = fără comutator). */
  source?: StudioSource;
  onSourceChange?: (source: StudioSource) => void;
  /** Motivul pentru care „Proiect scanat 3D” nu e disponibil (ex. exterioare); null = disponibil. */
  scanUnavailable?: string | null;
  /** Scanarea activă (sursa „Proiect scanat 3D”); null = nicio scanare încă. */
  scanInfo?: StudioScanInfo | null;
  onScanAngle?: (action: ScanAngleAction) => void;
  /** Deschide fereastra „Scanare LiDAR” (import / alt fișier / unghiul tău). */
  onImportScan?: () => void;
  /** Puntea live iPhone RoomPlan (fereastra LiDAR deschisă direct pe codul de asociere). */
  onIphoneScan?: () => void;
  /** Scanarea demo direct ca sursă 3D. */
  onDemoScan?: () => void;
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
  onUseResultAsSource, onNewVariant, detectedItems = [], detectedFixtures = [], rootImage = null, structureLocked = false,
  source = 'photo', onSourceChange, scanUnavailable = null, scanInfo = null, onScanAngle, onImportScan, onIphoneScan, onDemoScan,
}: StudioViewportProps) {
  const scanMode = source === 'scan';
  const [anglesOpen, setAnglesOpen] = useState(false);
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
  // „Afișează repere MEP & colțuri”: opțional, oprit implicit (randarea rămâne curată)
  const [fixturesOn, setFixturesOn] = useState(false);
  const canShowFixtures = hasResult && !isLoading && detectedFixtures.length > 0;
  const showFixtures = canShowFixtures && fixturesOn && !showEditor;
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
    if (canShowFixtures) {
      const sum = fixtureSummary(detectedFixtures);
      inline.push({
        id: 'fixtures',
        icon: Crosshair,
        label: t('Afișează repere MEP & colțuri', 'Show MEP & corner markers', 'Afficher repères MEP & angles'),
        pressed: showFixtures,
        disabled: showEditor,
        title: t(
          `${sum.mep} instalații · ${sum.openings} goluri · ${sum.corners} colțuri detectate înainte de randare${sum.shielded ? ` · ${sum.shielded} prize / întrerupătoare protejate la nivel de pixel` : ''}`,
          `${sum.mep} MEP fixtures · ${sum.openings} openings · ${sum.corners} corners detected before rendering${sum.shielded ? ` · ${sum.shielded} outlets / switches pixel-protected` : ''}`,
          `${sum.mep} installations · ${sum.openings} ouvertures · ${sum.corners} angles détectés avant le rendu${sum.shielded ? ` · ${sum.shielded} prises / interrupteurs protégés au pixel près` : ''}`,
        ),
        onClick: () => setFixturesOn((v) => !v),
      });
    }
    if (onNewVariant) inline.push({ id: 'variant', icon: RefreshCw, label: t('Variantă nouă', 'New variant', 'Nouvelle variante'), onClick: onNewVariant });
    if (onUseResultAsSource) inline.push({ id: 'edit', icon: PenLine, label: t('Editează acest rezultat', 'Edit this result', 'Modifier ce résultat'), primary: true, onClick: onUseResultAsSource });
    inline.push({ id: 'download', icon: Download, label: t('Descarcă', 'Download', 'Télécharger'), onClick: download });
    if (editArea && !showEditor) overflow.push({ id: 'adjust', icon: PenLine, label: t('Ajustează selecția', 'Adjust selection', 'Ajuster la sélection'), onClick: () => setEditorFor(generatedImage) });
  }
  if (originalImage && !isLoading) {
    overflow.push({ id: 'full', icon: Maximize2, label: t('Ecran complet', 'Full screen'), onClick: () => setLightbox(true) });
    if (onPickFile && !scanMode) overflow.push({ id: 'photo', icon: Upload, label: t('Schimbă fotografia', 'Change photo'), onClick: onPickFile });
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
    : hasResult ? t('Randare finalizată', 'Render complete') : originalImage ? (editArea ? t('Pictează zona de modificat', 'Paint the area to change', 'Peignez la zone à modifier') : scanMode ? t('Perspectivă 3D încărcată', '3D perspective loaded', 'Perspective 3D chargée') : t('Fotografie încărcată', 'Photo loaded')) : t('Canvas', 'Canvas');

  // Comutatorul de sursă: segmentat, arhitectural (bordo = activ), dezactivat cât timp se randează
  const segBtn = (on: boolean) =>
    `flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-full text-[12.5px] font-medium whitespace-nowrap cursor-pointer touch-manipulation transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
      on ? (isDark ? 'bg-[#C94A6A] text-white' : 'bg-[#5C1628] text-white') : sk.segOff
    }`;
  const switcher = onSourceChange ? (
    <div role="tablist" aria-label={t('Sursa proiectului', 'Project source', 'Source du projet')} className={`mb-2.5 flex gap-1 rounded-full border p-1 ${sk.line} ${isDark ? 'bg-[#110D0F]' : 'bg-[#FAF8F6]'}`}>
      <button type="button" role="tab" aria-selected={!scanMode} disabled={isLoading} onClick={() => onSourceChange('photo')} className={segBtn(!scanMode)}>
        <Camera className="w-4 h-4 shrink-0" aria-hidden />
        <span className="truncate">1. {t('Fotografie cameră', 'Room photo', 'Photo de la pièce')}</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={scanMode}
        disabled={isLoading || Boolean(scanUnavailable)}
        title={scanUnavailable ?? undefined}
        onClick={() => onSourceChange('scan')}
        className={segBtn(scanMode)}
      >
        <ScanLine className="w-4 h-4 shrink-0" aria-hidden />
        <span className="truncate">2. {t('Proiect scanat 3D (LiDAR)', '3D scanned project (LiDAR)', 'Projet scanné 3D (LiDAR)')}</span>
      </button>
    </div>
  ) : null;

  const scanBusy = isLoading || Boolean(scanInfo?.busy);
  const presetLabel = (p: MeshViewPreset) => (scanInfo?.realMesh ? meshPresetLabel(p, t) : p === 'overview' ? meshPresetLabel(p, t) : cameraPresetLabel(p, t));
  const smallBtn = `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium whitespace-nowrap cursor-pointer touch-manipulation transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${sk.line} ${sk.segOff}`;
  const scanStrip = scanMode && scanInfo ? (
    <div className="mb-2.5 space-y-2 px-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border px-2.5 h-7 text-[12px] font-medium ${sk.brassBadge}`}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${sk.brassDot}`} aria-hidden />
          <span className="truncate tabular-nums">{scanInfo.badge}</span>
        </span>
        <span className={`hidden sm:inline text-[11px] ${sk.dim}`}>{presetLabel(scanInfo.preset)}</span>
        {scanInfo.busy && <span role="status" aria-label={t('Se randează unghiul', 'Rendering the angle', 'Rendu de l’angle')} className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#A67C52] border-t-transparent" />}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {onScanAngle && (
            <button type="button" aria-expanded={anglesOpen} disabled={scanBusy} onClick={() => setAnglesOpen((o) => !o)} className={smallBtn}>
              <SwitchCamera className="w-3.5 h-3.5" aria-hidden />
              {t('Schimbă unghiul camerei 3D', 'Change 3D camera angle', 'Changer l’angle de la caméra 3D')}
            </button>
          )}
          {onImportScan && (
            <button type="button" disabled={isLoading} onClick={onImportScan} className={smallBtn}>
              <FileBox className="w-3.5 h-3.5" aria-hidden />
              {t('Încarcă alt fișier LiDAR', 'Load another LiDAR file', 'Charger un autre fichier LiDAR')}
            </button>
          )}
        </span>
      </div>
      {anglesOpen && onScanAngle && (
        <div role="group" aria-label={t('Unghiul camerei 3D', '3D camera angle', 'Angle de la caméra 3D')} className={`flex flex-wrap items-center gap-1 rounded-2xl sm:rounded-full border p-1 ${sk.line}`}>
          {(scanInfo.realMesh ? (['overview', 'entry', 'window'] as const) : (['entry', 'window'] as const)).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={scanInfo.preset === p}
              disabled={scanBusy}
              onClick={() => onScanAngle(p)}
              className={`inline-flex h-8 items-center rounded-full px-3 text-[12px] font-medium whitespace-nowrap cursor-pointer touch-manipulation disabled:opacity-40 ${scanInfo.preset === p ? sk.segOn : sk.segOff}`}
            >
              {presetLabel(p)}
            </button>
          ))}
          <span aria-hidden className={`mx-1 hidden sm:inline-block h-4 w-px ${isDark ? 'bg-[#2E2427]' : 'bg-[#E8E2E0]'}`} />
          <span className={`px-1 text-[11px] ${sk.dim}`}>{t('Rotește privirea', 'Turn the view', 'Tourner la vue')}</span>
          <button type="button" disabled={scanBusy} onClick={() => onScanAngle('left')} aria-label={t('Rotește spre stânga', 'Turn left', 'Tourner à gauche')} title={t('Rotește spre stânga', 'Turn left', 'Tourner à gauche')} className={`inline-flex h-8 w-8 items-center justify-center rounded-full cursor-pointer touch-manipulation disabled:opacity-40 ${scanInfo.preset === 'custom' ? sk.segOn : sk.segOff}`}>
            <RotateCcw className="w-3.5 h-3.5" aria-hidden />
          </button>
          <button type="button" disabled={scanBusy} onClick={() => onScanAngle('right')} aria-label={t('Rotește spre dreapta', 'Turn right', 'Tourner à droite')} title={t('Rotește spre dreapta', 'Turn right', 'Tourner à droite')} className={`inline-flex h-8 w-8 items-center justify-center rounded-full cursor-pointer touch-manipulation disabled:opacity-40 ${scanInfo.preset === 'custom' ? sk.segOn : sk.segOff}`}>
            <RotateCw className="w-3.5 h-3.5" aria-hidden />
          </button>
          <span className={`basis-full px-2 pb-0.5 text-[11px] ${sk.dim}`}>
            {t('Un unghi nou înlocuiește imaginea de lucru (randările acestei surse se resetează).', 'A new angle replaces the working image (this source’s renders are reset).', 'Un nouvel angle remplace l’image de travail (les rendus de cette source sont réinitialisés).')}
          </span>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className={`relative border rounded-xl p-2 sm:p-3 ${sk.card}`}>
      {switcher}
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
              <div ref={menuRef} className="relative shrink-0">{/* meniul (z-[60]) stă peste hotspot-urile (z-[35]) și fișa (z-50) Inspectorului */}
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
                  <div role="menu" className={`absolute right-0 top-full z-[60] mt-2 min-w-48 rounded-xl border p-1 ${sk.popover}`}>
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

      {scanStrip}

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
        <FixtureOverlay lang={lang} imageSrc={generatedImage as string} fixtures={detectedFixtures} enabled={showFixtures}>
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
        </FixtureOverlay>
      ) : originalImage ? (
        <div {...dropProps} className={`relative flex items-center justify-center rounded-lg overflow-hidden border ${backdrop} ${dragOver ? 'dropzone-active' : sk.line}`}>
          <ObjectInspector lang={lang} isDark={isDark} imageSrc={originalImage} items={detectedItems} enabled={inspectWorking}>
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
            <img
              src={originalImage}
              alt={scanMode ? t('Perspectiva interioară a scanării 3D', 'Interior perspective of the 3D scan', 'Perspective intérieure du scan 3D') : t('Fotografia sursă', 'Source photo')}
              className={`block w-full h-auto max-h-[72vh] object-contain transition-[filter,opacity] duration-700 ${isLoading ? 'opacity-90 saturate-[0.85]' : ''}`}
            />
          </ObjectInspector>
          {isLoading && <GenerationVeil lang={lang} regional={editArea} />}
        </div>
      ) : scanMode ? (
        <div className={`w-full aspect-[4/3] max-h-[72vh] rounded-lg border border-dashed flex flex-col items-center justify-center gap-4 px-6 text-center ${sk.grid} ${sk.line}`}>
          <span className={`flex h-14 w-14 items-center justify-center rounded-full border ${sk.line} ${isDark ? 'bg-[#1A1416]' : 'bg-white'}`}>
            <Box className={`w-6 h-6 ${sk.strong}`} aria-hidden />
          </span>
          <span>
            <span className={`block text-[16px] font-semibold tracking-tight ${sk.strong}`}>
              {t('Generează direct din scanarea 3D a camerei', 'Generate straight from the 3D room scan', 'Générez directement depuis le scan 3D de la pièce')}
            </span>
            <span className={`block mt-1.5 max-w-md text-[13px] ${sk.muted}`}>
              {t(
                '.zip Scaniverse (obj + jpg) · .obj · RoomPlan .json · .usdz — camera reală scanată, cu textura și cotele ei exacte, devine geometria randării fotorealiste.',
                '.zip Scaniverse (obj + jpg) · .obj · RoomPlan .json · .usdz — the real scanned room, with its texture and exact dimensions, becomes the geometry of the photorealistic render.',
                '.zip Scaniverse (obj + jpg) · .obj · RoomPlan .json · .usdz — la pièce réelle scannée, avec sa texture et ses cotes exactes, devient la géométrie du rendu photoréaliste.',
              )}
            </span>
          </span>
          <span className="flex flex-wrap items-center justify-center gap-2">
            {onImportScan && (
              <button type="button" onClick={onImportScan} disabled={isLoading} className={`inline-flex items-center gap-1.5 h-10 px-4 rounded-full text-[13px] font-medium cursor-pointer touch-manipulation disabled:opacity-40 ${sk.btn}`}>
                <ScanLine className="w-4 h-4" aria-hidden />
                {t('Importă scanare LiDAR', 'Import LiDAR scan', 'Importer un scan LiDAR')}
              </button>
            )}
            {onIphoneScan && (
              <button type="button" onClick={onIphoneScan} disabled={isLoading} className={`inline-flex items-center gap-1.5 h-10 px-4 rounded-full text-[13px] font-medium cursor-pointer touch-manipulation disabled:opacity-40 ${sk.btnGhost}`}>
                <Smartphone className="w-4 h-4" aria-hidden />
                {t('Scanează live cu iPhone', 'Scan live with iPhone', 'Scanner en direct avec l’iPhone')}
              </button>
            )}
            {onDemoScan && (
              <button type="button" onClick={onDemoScan} disabled={isLoading} className={`inline-flex items-center gap-1.5 h-10 px-4 rounded-full text-[13px] font-medium cursor-pointer touch-manipulation disabled:opacity-40 ${sk.btnGhost}`}>
                <Sparkles className="w-4 h-4" aria-hidden />
                {t('Scanare demo (Living 4,85 × 3,90 × 2,65 m)', 'Demo scan (Living 4.85 × 3.90 × 2.65 m)', 'Scan démo (Séjour 4,85 × 3,90 × 2,65 m)')}
              </button>
            )}
          </span>
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
