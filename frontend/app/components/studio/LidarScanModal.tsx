// app/components/studio/LidarScanModal.tsx
// „Scanare LiDAR & Măsurare Cameră” — fereastra comună Studio (03 Dimensiuni & Ergonomie) și Deviz B2B.
//   Tab 1 · Import scanare 3D (.obj / .usdz / .usda / .json RoomPlan) + scanarea demo → vizualizator wireframe.
//   Tab 2 · Calibrare din fotografie / cameră live (4 colțuri de podea + referință verticală).
//   Dreapta: rezumatul cotelor + „Aplică dimensiunile în Studio & B2B” (părintele decide ce actualizează).
"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Camera, Check, FileBox, Info, ScanLine, Sparkles, TriangleAlert, Upload, X } from 'lucide-react';
import { LOCALES, tr } from '@/app/lib/i18n';
import { EYEBROW, getSkin } from '@/app/lib/theme/skin';
import type { Language } from '@/app/types';
import {
  ACCEPTED_SCAN_EXTENSIONS,
  STANDARD_DOOR_AREA,
  STANDARD_WINDOW_AREA,
  ScanParseError,
  loadDemoScan,
  measurementFromScan,
  parseScanFile,
  type LengthUnit,
  type RoomMeasurement,
  type RoomScan,
  type ScanNote,
  type UpAxis,
} from '@/app/lib/studio/lidarParser';
import type { CalibrationOutcome } from '@/app/lib/studio/perspective';
import LidarWireframeCanvas from './LidarWireframeCanvas';
import PhotoCalibrator from './PhotoCalibrator';

export interface CurrentRoom {
  length: number;
  width: number;
  height: number;
  doorsCount: number;
  windowsCount: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  lang: Language;
  isDark: boolean;
  /** Cotele curente (pentru comparație și ca rezervă pentru înălțime la calibrarea foto). */
  current: CurrentRoom;
  /** Fotografia activă din Studio, propusă la calibrare. */
  studioPhoto?: string | null;
  onApply: (m: RoomMeasurement) => void;
  /** Text suplimentar sub butonul de aplicare (ex. ce se recalculează în B2B). */
  applyNote?: string;
}

const MAX_SCAN_BYTES = 250 * 1024 * 1024;

export default function LidarScanModal({ open, onClose, lang, isDark, current, studioPhoto, onApply, applyNote }: Props) {
  const sk = getSkin(isDark);
  const t = useCallback((ro: string, en: string, fr?: string) => tr(lang, ro, en, fr), [lang]);
  const [tab, setTab] = useState<'scan' | 'photo'>('scan');
  const [scan, setScan] = useState<RoomScan | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [override, setOverride] = useState<{ upAxis?: UpAxis; unit?: LengthUnit }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [photo, setPhoto] = useState<CalibrationOutcome | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Părintele poate trimite un `onClose` nou la fiecare randare: îl citim dintr-un ref, ca efectul de mai jos
  // (focus + blocarea derulării) să ruleze doar la deschidere / închidere, nu la fiecare randare a Studio-ului.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Esc, blocarea derulării, focus pe „Închide” și restaurarea focusului la închidere
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      focused?.focus?.();
    };
  }, [open]);

  const errorText = useCallback((e: unknown): string => {
    if (!(e instanceof ScanParseError)) {
      return t('Fișierul nu a putut fi citit.', 'The file could not be read.', 'Impossible de lire le fichier.');
    }
    switch (e.code) {
      case 'empty': return t('Fișierul este gol.', 'The file is empty.', 'Le fichier est vide.');
      case 'unsupported': return t('Format nesuportat. Folosește .obj, .usdz, .usda sau .json (RoomPlan).', 'Unsupported format. Use .obj, .usdz, .usda or .json (RoomPlan).', 'Format non pris en charge. Utilisez .obj, .usdz, .usda ou .json (RoomPlan).');
      case 'no-vertices': return t('Nu am găsit geometrie (vârfuri) în fișier.', 'No geometry (vertices) found in the file.', 'Aucune géométrie (sommets) trouvée.');
      case 'invalid-json': return t('JSON invalid — verifică exportul RoomPlan.', 'Invalid JSON — check the RoomPlan export.', 'JSON invalide — vérifiez l’export RoomPlan.');
      case 'no-room': return t('JSON-ul nu conține pereți RoomPlan (`walls`) sau `dimensions` cu lungime / lățime / înălțime.', 'The JSON has no RoomPlan walls or length / width / height dimensions.', 'Le JSON ne contient ni murs RoomPlan ni dimensions.');
      case 'zip-invalid': return t('Arhiva USDZ este coruptă sau într-un format ZIP necunoscut.', 'The USDZ archive is corrupt or uses an unknown ZIP format.', 'L’archive USDZ est corrompue ou dans un format ZIP inconnu.');
      case 'usdz-empty': return t('Pachetul USDZ nu conține un strat USD.', 'The USDZ package has no USD layer.', 'Le paquet USDZ ne contient aucune couche USD.');
      case 'usdz-binary': {
        const found = e.detail ? ` (${t('detectat', 'detected', 'détecté')}: ${e.detail})` : '';
        return t(
          `Acest USDZ conține un crate binar (.usdc) fără limite ASCII explicite${found}. Pentru cote exacte exportă din aceeași scanare ca .json RoomPlan sau .obj (Polycam / Scaniverse / 3D Scanner App: Export → OBJ).`,
          `This USDZ holds a binary crate (.usdc) without explicit ASCII bounds${found}. For exact dimensions export the same scan as RoomPlan .json or .obj (Polycam / Scaniverse / 3D Scanner App: Export → OBJ).`,
          `Ce USDZ contient un crate binaire (.usdc) sans limites ASCII explicites${found}. Pour des cotes exactes, exportez en .json RoomPlan ou .obj.`,
        );
      }
    }
  }, [t]);

  const runParse = useCallback(async (f: File, opts: { upAxis?: UpAxis; unit?: LengthUnit }) => {
    setBusy(true);
    setError(null);
    try {
      setScan(await parseScanFile(f, opts));
    } catch (e) {
      setScan(null);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [errorText]);

  const acceptFile = (f: File | undefined) => {
    if (!f) return;
    const name = f.name.toLowerCase();
    if (!ACCEPTED_SCAN_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      setError(errorText(new ScanParseError('unsupported')));
      return;
    }
    if (f.size > MAX_SCAN_BYTES) {
      setError(t('Fișierul depășește 250 MB. Exportă scanarea cu o rezoluție mai mică.', 'The file exceeds 250 MB. Export the scan at a lower resolution.', 'Le fichier dépasse 250 Mo.'));
      return;
    }
    setFile(f);
    setOverride({});
    void runParse(f, {});
  };

  const loadDemo = () => {
    setFile(null);
    setOverride({});
    setError(null);
    setScan(loadDemoScan());
  };

  const reparse = (next: { upAxis?: UpAxis; unit?: LengthUnit }) => {
    setOverride(next);
    if (file) void runParse(file, next);
  };

  const onPhotoResult = useCallback((r: CalibrationOutcome | null) => setPhoto(r), []);

  if (!open) return null;

  // ── Măsurătoarea activă ──
  let measurement: RoomMeasurement | null = null;
  let heightFromStudio = false;
  if (tab === 'scan' && scan) measurement = measurementFromScan(scan);
  if (tab === 'photo' && photo?.ok) {
    const H = photo.heightM ?? current.height;
    heightFromStudio = photo.heightM === null;
    const area = photo.lengthM * photo.widthM;
    const gross = 2 * (photo.lengthM + photo.widthM) * H;
    measurement = {
      lengthM: photo.lengthM,
      widthM: photo.widthM,
      heightM: Math.round(H * 100) / 100,
      areaSqm: Math.round(area * 100) / 100,
      volumeM3: Math.round(area * H * 100) / 100,
      wallAreaSqm: Math.round(Math.max(0, gross - current.doorsCount * STANDARD_DOOR_AREA - current.windowsCount * STANDARD_WINDOW_AREA) * 100) / 100,
      source: 'photo',
    };
  }

  const num = (n: number, d = 2) => n.toLocaleString(LOCALES[lang], { minimumFractionDigits: d, maximumFractionDigits: d });
  const eyebrow = `${EYEBROW} ${sk.dim}`;
  const tabBtn = (on: boolean) =>
    `flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-full text-[13px] font-medium cursor-pointer touch-manipulation transition-colors ${on ? (isDark ? 'bg-[#C94A6A] text-white' : 'bg-[#5C1628] text-white') : sk.segOff}`;
  const chip = `inline-flex items-center gap-1 rounded-full border px-2.5 h-6 text-[11px] font-mono tabular-nums ${sk.line} ${sk.muted}`;

  const noteText = (n: ScanNote): string => {
    switch (n.code) {
      case 'unit-detected': return t(`Unitate detectată automat: ${n.value}`, `Unit auto-detected: ${n.value}`, `Unité détectée : ${n.value}`);
      case 'unit-explicit': return t(`Unitate din fișier: ${n.value}`, `Unit from file: ${n.value}`, `Unité du fichier : ${n.value}`);
      case 'up-z': return t('Axa verticală: Z (convertită în Y-sus)', 'Up axis: Z (converted to Y-up)', 'Axe vertical : Z (converti en Y)');
      case 'up-fallback': return t('Axa verticală Y (convenția iOS / ARKit); comută pe Z dacă exportul vine din CAD / Blender.', 'Up axis Y (iOS / ARKit convention); switch to Z if the export comes from CAD / Blender.', 'Axe vertical Y (convention iOS / ARKit) ; passez en Z pour un export CAO / Blender.');
      case 'trimmed-outliers': return t('Zgomotul de la margini (0,2 %) a fost ignorat la cote.', 'Edge noise (0.2 %) ignored for the dimensions.', 'Bruit de bord (0,2 %) ignoré.');
      case 'rotated': return t(`Scanare rotită ${n.value}° — aliniată automat la pereți`, `Scan rotated ${n.value}° — auto-aligned to the walls`, `Scan pivoté de ${n.value}° — aligné sur les murs`);
      case 'floor-from-mesh': return t('Suprafața podelei calculată din fețele orizontale ale plasei', 'Floor area computed from the mesh’s horizontal faces', 'Surface du sol calculée depuis les faces horizontales');
      case 'floor-from-polygon': return t('Suprafața podelei din conturul real (poligon)', 'Floor area from the real outline (polygon)', 'Surface du sol depuis le contour réel');
      case 'openings-standard': return t('Golurile scăzute cu dimensiuni standard (ușă 1,89 m², fereastră 2,10 m²)', 'Openings deducted at standard sizes (door 1.89 m², window 2.10 m²)', 'Ouvertures déduites aux tailles standard');
      case 'edges-sampled': return t(`Wireframe eșantionat din ${n.value} muchii pentru 60 FPS`, `Wireframe sampled from ${n.value} edges for 60 FPS`, `Wireframe échantillonné (${n.value} arêtes)`);
      case 'implausible-size': return t('Atenție: dimensiunile nu par ale unei camere — verifică unitatea / axa.', 'Warning: the size does not look like a room — check unit / axis.', 'Attention : dimensions peu plausibles — vérifiez unité / axe.');
      case 'usda-entry': return t(`Citit din stratul ASCII ${n.value}`, `Read from ASCII layer ${n.value}`, `Lu depuis la couche ASCII ${n.value}`);
      case 'json-entry': return t(`Citit din JSON-ul RoomPlan inclus (${n.value})`, `Read from the bundled RoomPlan JSON (${n.value})`, `Lu depuis le JSON RoomPlan inclus (${n.value})`);
    }
  };

  const sourceLabel = (s: RoomScan['source']) =>
    ({ obj: 'Wavefront OBJ', usdz: 'USDZ · USD', roomplan: 'Apple RoomPlan JSON', dimensions: 'JSON', demo: t('Demo RoomPlan', 'RoomPlan demo', 'Démo RoomPlan') })[s];

  const rows: { label: string; value: string; was?: string }[] = measurement
    ? [
        { label: t('Lungime', 'Length', 'Longueur'), value: `${num(measurement.lengthM)} m`, was: `${num(current.length)} m` },
        { label: t('Lățime', 'Width', 'Largeur'), value: `${num(measurement.widthM)} m`, was: `${num(current.width)} m` },
        { label: t('Înălțime', 'Height', 'Hauteur'), value: `${num(measurement.heightM)} m`, was: `${num(current.height)} m` },
        { label: t('Suprafață utilă', 'Floor area', 'Surface utile'), value: `${num(measurement.areaSqm)} m²` },
        { label: t('Volum', 'Volume', 'Volume'), value: `${num(measurement.volumeM3)} m³` },
        { label: t('Suprafață pereți (netă)', 'Wall area (net)', 'Surface des murs (nette)'), value: `${num(measurement.wallAreaSqm)} m²` },
        ...(measurement.doors !== undefined ? [{ label: t('Uși', 'Doors', 'Portes'), value: String(measurement.doors), was: String(current.doorsCount) }] : []),
        ...(measurement.windows !== undefined ? [{ label: t('Ferestre', 'Windows', 'Fenêtres'), value: String(measurement.windows), was: String(current.windowsCount) }] : []),
      ]
    : [];

  const canvasLabels = {
    length: 'L',
    width: 'l',
    height: 'H',
    hint: t('Trage pentru rotire, rotița sau ciupirea pentru zoom.', 'Drag to orbit, scroll or pinch to zoom.', 'Glisser pour pivoter, molette ou pincement pour zoomer.'),
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center overflow-y-auto bg-[#110D0F]/60 backdrop-blur-sm p-4 print:hidden"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lidar-modal-title"
        className={`relative w-full max-w-[1120px] rounded-2xl border ${sk.card} ${isDark ? 'text-[#F5F2EF]' : 'text-[#1B1416]'} shadow-[0_32px_80px_-32px_rgba(17,13,15,0.55)]`}
      >
        {/* Antet */}
        <div className={`flex items-start justify-between gap-4 px-5 sm:px-6 pt-5 pb-4 border-b ${sk.line}`}>
          <div className="min-w-0">
            <p className={`${eyebrow} flex items-center gap-1.5`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${sk.brassDot}`} aria-hidden />
              LiDAR · RoomPlan · {t('Fotogrammetrie', 'Photogrammetry', 'Photogrammétrie')}
            </p>
            <h2 id="lidar-modal-title" className={`mt-1 text-[19px] sm:text-[21px] font-semibold tracking-tight ${sk.strong}`}>
              {t('Scanare LiDAR & Măsurare Cameră', 'LiDAR Scan & Room Measurement', 'Scan LiDAR & Mesure de la pièce')}
            </h2>
            <p className={`mt-0.5 text-[13px] ${sk.muted}`}>
              {t(
                'Importă o scanare 3D de pe iPhone / iPad Pro sau calibrează cotele dintr-o fotografie.',
                'Import a 3D scan from iPhone / iPad Pro or calibrate dimensions from a photo.',
                'Importez un scan 3D d’iPhone / iPad Pro ou calibrez les cotes depuis une photo.',
              )}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('Închide', 'Close', 'Fermer')}
            className={`shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full cursor-pointer ${sk.btnGhost}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* Stânga: fluxurile de măsurare */}
          <div className={`p-5 sm:p-6 space-y-4 min-w-0 lg:border-r ${sk.line}`}>
            <div role="tablist" className={`flex gap-1 rounded-full border p-1 ${sk.line}`}>
              <button type="button" role="tab" aria-selected={tab === 'scan'} onClick={() => setTab('scan')} className={tabBtn(tab === 'scan')}>
                <ScanLine className="w-4 h-4" aria-hidden />
                <span className="truncate">{t('Import scanare LiDAR 3D', 'Import 3D LiDAR scan', 'Importer un scan LiDAR 3D')}</span>
              </button>
              <button type="button" role="tab" aria-selected={tab === 'photo'} onClick={() => setTab('photo')} className={tabBtn(tab === 'photo')}>
                <Camera className="w-4 h-4" aria-hidden />
                <span className="truncate">{t('Calibrare din fotografie', 'Calibrate from photo', 'Calibrer depuis une photo')}</span>
              </button>
            </div>

            {tab === 'scan' ? (
              <div className="space-y-4" role="tabpanel">
                {/* Zona de încărcare */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    acceptFile(e.dataTransfer.files?.[0]);
                  }}
                  className={`rounded-xl border border-dashed px-4 py-5 transition-colors ${
                    dragOver ? (isDark ? 'border-[#C94A6A] bg-[#C94A6A]/10' : 'border-[#5C1628] bg-[#5C1628]/[0.05]') : `${sk.line} ${isDark ? 'bg-[#110D0F]' : 'bg-[#FAF8F6]'}`
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className={`hidden sm:flex shrink-0 w-11 h-11 items-center justify-center rounded-full ${isDark ? 'bg-[#C94A6A]/15 text-[#E07F98]' : 'bg-[#5C1628]/[0.07] text-[#5C1628]'}`}>
                      <FileBox className="w-5 h-5" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[14px] font-medium ${sk.strong}`}>
                        {t('Trage aici scanarea camerei', 'Drop the room scan here', 'Déposez le scan de la pièce ici')}
                      </p>
                      <p className={`text-[12px] ${sk.muted}`}>
                        .obj · .usdz · .usda · .json (Apple RoomPlan) — Polycam, Scaniverse, 3D Scanner App, RoomPlan
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => inputRef.current?.click()}
                      disabled={busy}
                      className={`inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-full text-[13px] font-medium cursor-pointer disabled:opacity-50 ${sk.btnGhost}`}
                    >
                      <Upload className="w-4 h-4" aria-hidden /> {t('Alege fișier', 'Choose file', 'Choisir un fichier')}
                    </button>
                    <input
                      ref={inputRef}
                      type="file"
                      accept=".obj,.usdz,.usda,.json,model/obj,model/vnd.usdz+zip,application/json"
                      className="hidden"
                      onChange={(e) => {
                        acceptFile(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                  </div>
                  <div className={`mt-4 pt-4 border-t ${sk.line} flex flex-wrap items-center gap-3`}>
                    <button
                      type="button"
                      onClick={loadDemo}
                      className={`inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-[13px] font-medium cursor-pointer ${sk.btn}`}
                    >
                      <Sparkles className="w-4 h-4" aria-hidden />
                      {t('Încarcă scanare LiDAR demo (Living 4,85 × 3,90 × 2,65 m)', 'Load demo LiDAR scan (Living 4.85 × 3.90 × 2.65 m)', 'Charger le scan LiDAR démo (Séjour 4,85 × 3,90 × 2,65 m)')}
                    </button>
                    <span className={`text-[12px] ${sk.dim}`}>
                      {t('5 pereți · 1 ușă · 2 ferestre · format RoomPlan', '5 walls · 1 door · 2 windows · RoomPlan format', '5 murs · 1 porte · 2 fenêtres · format RoomPlan')}
                    </span>
                  </div>
                </div>

                {busy && (
                  <p role="status" className={`text-[13px] ${sk.muted}`}>
                    {t('Se citește geometria scanării…', 'Reading the scan geometry…', 'Lecture de la géométrie…')}
                  </p>
                )}
                {error && (
                  <div role="alert" className={`flex gap-2 rounded-lg border px-3 py-2.5 text-[13px] ${isDark ? 'border-[#C94A6A]/40 bg-[#C94A6A]/10 text-[#F2D7DE]' : 'border-[#5C1628]/25 bg-[#5C1628]/[0.04] text-[#5C1628]'}`}>
                    <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
                    <span>{error}</span>
                  </div>
                )}

                {scan && (
                  <>
                    <LidarWireframeCanvas scan={scan} isDark={isDark} labels={canvasLabels} className={`h-[300px] sm:h-[380px] border ${sk.line}`} />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={chip}><Box className="w-3 h-3" aria-hidden /> {sourceLabel(scan.source)}</span>
                      {scan.fileName && scan.source !== 'demo' && <span className={`${chip} max-w-[220px] truncate`}>{scan.fileName}</span>}
                      <span className={chip}>{t('unitate', 'unit', 'unité')} {scan.unit}</span>
                      <span className={chip}>{t('axă', 'up', 'axe')} {scan.upAxis.toUpperCase()}</span>
                      {scan.vertexCount > 0 && <span className={chip}>{scan.vertexCount.toLocaleString(LOCALES[lang])} {t('vârfuri', 'vertices', 'sommets')}</span>}
                      {scan.faceCount > 0 && <span className={chip}>{scan.faceCount.toLocaleString(LOCALES[lang])} {t('fețe', 'faces', 'faces')}</span>}
                      {scan.wallCount > 0 && <span className={chip}>{scan.wallCount} {t('pereți', 'walls', 'murs')}</span>}
                      <span className={chip}>{scan.doorCount} {t('uși', 'doors', 'portes')}</span>
                      <span className={chip}>{scan.windowCount} {t('ferestre', 'windows', 'fenêtres')}</span>
                      {scan.openingCount > 0 && <span className={chip}>{scan.openingCount} {t('goluri', 'openings', 'ouvertures')}</span>}
                    </div>

                    {/* Corecții manuale pentru fișierele de plasă (OBJ / USD) */}
                    {file && (scan.source === 'obj' || scan.source === 'usdz') && (
                      <div className="flex flex-wrap items-center gap-3 text-[12px]">
                        <span className={sk.muted}>{t('Axă verticală', 'Up axis', 'Axe vertical')}</span>
                        <div className={`inline-flex rounded-full border p-0.5 ${sk.line}`}>
                          {(['y', 'z'] as UpAxis[]).map((a) => (
                            <button
                              key={a}
                              type="button"
                              aria-pressed={scan.upAxis === a}
                              onClick={() => reparse({ ...override, upAxis: a })}
                              className={`h-7 px-3 rounded-full font-mono cursor-pointer ${scan.upAxis === a ? sk.segOn : sk.segOff}`}
                            >
                              {a.toUpperCase()}
                            </button>
                          ))}
                        </div>
                        <label className="inline-flex items-center gap-2">
                          <span className={sk.muted}>{t('Unitate', 'Unit', 'Unité')}</span>
                          <select
                            value={override.unit ?? 'auto'}
                            onChange={(e) => reparse({ ...override, unit: e.target.value === 'auto' ? undefined : (e.target.value as LengthUnit) })}
                            className={`h-7 rounded-md border px-2 font-mono ${sk.input}`}
                          >
                            <option value="auto" className={sk.option}>auto</option>
                            {(['m', 'cm', 'mm', 'in'] as LengthUnit[]).map((u) => (
                              <option key={u} value={u} className={sk.option}>{u}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )}

                    {scan.notes.length > 0 && (
                      <ul className={`space-y-1 text-[12px] ${sk.muted}`}>
                        {scan.notes.map((n, i) => (
                          <li key={`${n.code}-${i}`} className="flex gap-1.5">
                            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-70" aria-hidden />
                            <span>{noteText(n)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}

                {!scan && !busy && (
                  <details className={`text-[12px] ${sk.muted}`}>
                    <summary className="cursor-pointer select-none">{t('Cum export o scanare de pe iPhone?', 'How do I export a scan from iPhone?', 'Comment exporter un scan depuis l’iPhone ?')}</summary>
                    <ul className="mt-2 list-disc pl-5 space-y-1">
                      <li>{t('iPhone 12 Pro+ / iPad Pro cu LiDAR: scanează camera în Polycam, Scaniverse sau 3D Scanner App → Export → OBJ.', 'iPhone 12 Pro+ / iPad Pro with LiDAR: scan in Polycam, Scaniverse or 3D Scanner App → Export → OBJ.', 'iPhone 12 Pro+ / iPad Pro avec LiDAR : scannez dans Polycam, Scaniverse ou 3D Scanner App → Export → OBJ.')}</li>
                      <li>{t('Aplicații RoomPlan (ex. „Room Scan”): exportă JSON-ul CapturedRoom pentru pereți, uși și ferestre exacte.', 'RoomPlan apps: export the CapturedRoom JSON for exact walls, doors and windows.', 'Apps RoomPlan : exportez le JSON CapturedRoom pour murs, portes et fenêtres exacts.')}</li>
                      <li>{t('USDZ: acceptat; dacă pachetul are doar un crate binar, îți spunem explicit și îți sugerăm exportul OBJ / JSON.', 'USDZ: supported; if the package only has a binary crate we tell you and suggest the OBJ / JSON export.', 'USDZ : pris en charge ; si le paquet n’a qu’un crate binaire, nous le signalons.')}</li>
                    </ul>
                  </details>
                )}
              </div>
            ) : (
              <div role="tabpanel">
                <PhotoCalibrator lang={lang} isDark={isDark} studioPhoto={studioPhoto} onResult={onPhotoResult} />
              </div>
            )}
          </div>

          {/* Dreapta: rezumat + aplicare */}
          <aside className={`p-5 sm:p-6 border-t lg:border-t-0 ${sk.line} ${isDark ? 'bg-[#110D0F]/40' : 'bg-[#FAF8F6]'} rounded-b-2xl lg:rounded-bl-none lg:rounded-r-2xl flex flex-col gap-4`}>
            <div className="flex items-center justify-between">
              <p className={eyebrow}>{t('Cote extrase', 'Extracted dimensions', 'Cotes extraites')}</p>
              {tab === 'photo' && photo?.ok && (
                <span className={`rounded-full border px-2 h-6 inline-flex items-center text-[11px] ${photo.quality === 'good' ? sk.chipOn : photo.quality === 'fair' ? sk.brassBadge : 'border-red-400/50 text-red-500'}`}>
                  {photo.quality === 'good' ? t('Precizie bună', 'Good accuracy', 'Bonne précision') : photo.quality === 'fair' ? t('Precizie medie', 'Fair accuracy', 'Précision moyenne') : t('Verifică pinii', 'Check the pins', 'Vérifiez les repères')}
                </span>
              )}
            </div>

            {measurement ? (
              <dl className={`rounded-xl border divide-y ${sk.line} ${sk.divide} ${isDark ? 'bg-[#1A1416]' : 'bg-white'}`}>
                {rows.map((r) => (
                  <div key={r.label} className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
                    <dt className={`text-[12px] ${sk.muted}`}>{r.label}</dt>
                    <dd className="text-right">
                      <span className={`font-mono text-[15px] font-medium tabular-nums ${sk.strong}`}>{r.value}</span>
                      {r.was !== undefined && r.was !== r.value && (
                        <span className={`block text-[10px] font-mono tabular-nums ${sk.dim}`}>{t('acum', 'now', 'actuel')} {r.was}</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <div className={`rounded-xl border border-dashed px-4 py-8 text-center text-[13px] ${sk.line} ${sk.muted}`}>
                {tab === 'scan'
                  ? t('Importă o scanare sau încarcă demo-ul pentru a vedea cotele.', 'Import a scan or load the demo to see the dimensions.', 'Importez un scan ou chargez la démo.')
                  : photo && !photo.ok
                    ? photo.error === 'reference-invalid'
                      ? t('Referința nu stă pe podea sau e inversată: baza jos, vârful sus.', 'The reference is off the floor or upside down: base low, top high.', 'Référence hors du sol ou inversée.')
                      : photo.error === 'behind-horizon'
                        ? t('Un colț de podea este deasupra liniei orizontului — mută pinii pe podea.', 'A floor corner is above the horizon — move the pins onto the floor.', 'Un coin est au-dessus de l’horizon.')
                        : t('Pinii podelei formează un patrulater degenerat.', 'The floor pins form a degenerate quadrilateral.', 'Les repères du sol forment un quadrilatère dégénéré.')
                    : t('Alege o fotografie și așază pinii pentru calibrare.', 'Pick a photo and place the pins to calibrate.', 'Choisissez une photo et placez les repères.')}
              </div>
            )}

            {tab === 'photo' && photo?.ok && (
              <p className={`text-[11px] leading-relaxed ${sk.dim}`}>
                {t(`Focală ${photo.focalSource === 'vanishing' ? 'din punctele de fugă' : 'estimată (telefon ~26 mm)'}: ${photo.focalPx} px · abatere unghiuri ${num(photo.angleErrorDeg, 1)}°.`, `Focal length ${photo.focalSource === 'vanishing' ? 'from vanishing points' : 'estimated (phone ~26 mm)'}: ${photo.focalPx} px · angle deviation ${num(photo.angleErrorDeg, 1)}°.`, `Focale ${photo.focalSource === 'vanishing' ? 'des points de fuite' : 'estimée (~26 mm)'} : ${photo.focalPx} px · écart d’angle ${num(photo.angleErrorDeg, 1)}°.`)}
                {heightFromStudio && ` ${t('Înălțimea este păstrată din Studio (fără pin de tavan).', 'Height kept from the Studio (no ceiling pin).', 'Hauteur conservée du Studio.')}`}
              </p>
            )}

            <div className="mt-auto space-y-2">
              <button
                type="button"
                disabled={!measurement}
                onClick={() => {
                  if (!measurement) return;
                  onApply(measurement);
                  onClose();
                }}
                className={`w-full inline-flex items-center justify-center gap-2 h-11 px-3 rounded-full text-[13px] font-medium whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${sk.btn}`}
              >
                <Check className="w-4 h-4" aria-hidden />
                {t('Aplică dimensiunile în Studio & B2B', 'Apply dimensions to Studio & B2B', 'Appliquer les cotes au Studio & B2B')}
              </button>
              <p className={`text-[11px] leading-relaxed ${sk.dim}`}>
                {applyNote ??
                  t(
                    'Actualizează lungimea, lățimea, înălțimea, analiza ergonomică, costul pe m² și suprafața din devizul B2B al proiectului.',
                    'Updates length, width, height, the ergonomic analysis, per-m² cost and the area in the project’s B2B quote.',
                    'Met à jour longueur, largeur, hauteur, l’analyse ergonomique, le coût au m² et la surface du devis B2B.',
                  )}
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
