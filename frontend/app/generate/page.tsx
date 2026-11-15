// app/generate/page.tsx
// Studio SUCVAR v3.1 — "Dark Architecture".
// v3.1: style dropdown z-index fix, project name field, post-checkout plan sync,
//       paid tiers (pro / agency) treated as unlimited.
// v3.2: validare cote + fotografie, estimare de cost în timp real, salvare/restaurare robustă.
// v4.0: „Descrie ce îți dorești” — descriere liberă + inspirații, structura camerei, opțiuni avansate opționale
//       (stil / paletă / lumină / m², implicit „Auto”); se generează cu o fotografie + text SAU stil.
"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  ImagePlus,
  Lock,
  RotateCcw,
  Wand2,
} from 'lucide-react';
import Navbar from '@/app/components/layout/Navbar';
import {
  DEFAULT_SCOPE,
  MAX_FOCUS_CHIPS,
  SIZE_PRESET_IDS,
  SPACE_MODES,
  VISUAL_STYLES,
  calculateEngineering,
  detectSizePreset,
  estimateCost,
  generateSpecItems,
  getSizePreset,
  getSpace,
  getStyle,
} from '@/app/data/catalog';
import { AI_LIMITS, DEFAULT_AI_SETTINGS, PLAN_LIMITS } from '@/app/lib/studio/aiConfig';
import { getAccessToken, getSessionEmail } from '@/app/lib/supabase/auth';
import { getProjectById, saveProjectToDb } from '@/app/lib/supabase/projects';
import { buildBom } from '@/app/lib/procurement';
import { getMonthlyUsage, recordGeneration, resolvePlan } from '@/app/lib/plan/client';
import { usePlan } from '@/app/lib/plan/usePlan';
import { getSkin, EYEBROW } from '@/app/lib/theme/skin';
import { usePrefs } from '@/app/lib/theme/usePrefs';
import { STORAGE_KEYS, readStorage, removeStorage, writeStorage } from '@/app/lib/storage';
import {
  ACCEPTED_PHOTO_TYPES,
  LOADING_STEPS_RO,
  LOADING_STEPS_EN,
  MIN_PHOTO_SIDE,
  MAX_PHOTO_BYTES,
  type NumberField,
} from '@/app/lib/studio/constants';
import { PhotoError, resizePhoto, toPermanentDataUrl } from '@/app/lib/studio/images';
import {
  DIMENSION_LIMITS,
  getHeightLimits,
  sanitizeDimensions,
  validateDimensions,
} from '@/app/lib/studio/validation';
import DimensionsPanel from '@/app/components/studio/DimensionsPanel';
import SpaceScenarioPanel from '@/app/components/studio/SpaceScenarioPanel';
import VisionPanel from '@/app/components/studio/VisionPanel';
import VisionSummary from '@/app/components/studio/VisionSummary';
import {
  AUTO,
  inferSpaceFromText,
  inferStyleFromText,
  type DesignBriefMeta,
  type LightingId,
  type PaletteId,
  type VisionResponse,
} from '@/app/lib/studio/vision';
import type { BomItem, BomResult } from '@/app/lib/procurement';
import TelemetryBar from '@/app/components/studio/TelemetryBar';
import StudioViewport from '@/app/components/studio/StudioViewport';
import CostBreakdown from '@/app/components/studio/CostBreakdown';
import ProcurementPanel from '@/app/components/studio/ProcurementPanel';
import EngineeringPanel from '@/app/components/studio/EngineeringPanel';
import ManufacturerSpecs from '@/app/components/studio/ManufacturerSpecs';
import PrintBlueprint from '@/app/components/studio/PrintBlueprint';
import ShareControl from '@/app/components/portal/ShareControl';
import {
  AiSettings,
  DesignMode,
  RoomDimensions,
  SavedProject,
  ScopeLevel,
  SizePresetId,
} from '@/app/types';
import { apiFetch, readJson } from '@/app/lib/api-client';
import { tr, trList } from '@/app/lib/i18n';

// Cotele inițiale ale unui spațiu: dimensiunile lui implicite realiste + setările care
// se păstrează la schimbarea spațiului (buget, intensitate AI, nivel de intervenție).
function dimensionsForSpace(
  mode: DesignMode,
  spaceId: string,
  keep: Pick<RoomDimensions, 'budget' | 'aiStrength' | 'scope'>,
): RoomDimensions {
  const space = getSpace(mode, spaceId);
  const d = space.defaults;
  return {
    width: d.width,
    length: d.length,
    height: d.height,
    doorsCount: d.doorsCount,
    windowsCount: d.windowsCount,
    layoutPreset: space.layouts[0].id,
    focusIds: [],
    ...keep,
  };
}

// ── Pagina principală ────────────────────────────────────────────────────────
export default function StudioPage() {
  // Setări pagină
  const { lang, isDark } = usePrefs();

  // ── Stare: setările proiectului (alegerile utilizatorului din coloana stângă) ──
  const [projectName, setProjectName] = useState('');
  const [mode, setMode] = useState<DesignMode>('interiors');
  const [selectedSpace, setSelectedSpace] = useState(SPACE_MODES.interiors.spaces[0].id);
  // Stilul ales explicit sau AUTO (dedus din descriere; implicit)
  const [styleChoice, setStyleChoice] = useState<string>(AUTO);
  // „Descrie ce îți dorești” + opțiunile opționale
  const [customPrompt, setCustomPrompt] = useState('');
  const [preserveStructure, setPreserveStructure] = useState(true);
  const [palette, setPalette] = useState<PaletteId | null>(null);
  const [lighting, setLighting] = useState<LightingId | null>(null);
  // false = camera n-a fost aleasă manual: o deducem din descriere la generare („bucătărie”, „dormitor”…)
  const [spaceTouched, setSpaceTouched] = useState(false);
  const [isProjectDetailsOpen, setIsProjectDetailsOpen] = useState(false);
  // Brief-ul rezolvat de server la ultima randare (rezumatul de lângă rezultat)
  const [vision, setVision] = useState<VisionResponse | null>(null);
  // Ultima listă de achiziții calculată de API (cu materialele din descriere), etichetată cu intrarea ei
  const serverBomRef = useRef<{ key: string; items: BomItem[] } | null>(null);
  const [roomDimensions, setRoomDimensions] = useState<RoomDimensions>(() =>
    dimensionsForSpace('interiors', SPACE_MODES.interiors.spaces[0].id, {
      budget: 'standard',
      aiStrength: 75,
      scope: DEFAULT_SCOPE,
    }),
  );
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  // ── Stare: rezultatul generării și mesajele de interfață ──
  // (loading / eroare / salvare sunt stări separate, ca fiecare acțiune să aibă feedback clar)
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isDemoResult, setIsDemoResult] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [excludedItemIds, setExcludedItemIds] = useState<string[]>([]);
  const [issueDate, setIssueDate] = useState('');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [providerNote, setProviderNote] = useState<string | null>(null);
  const [gateCode, setGateCode] = useState<'LIMIT_REACHED' | 'AUTH_REQUIRED' | null>(null);
  const [isSaving, setIsSaving] = useState(false); // blochează dublu-click pe „Salvează"
  const [isPhotoLoading, setIsPhotoLoading] = useState(false); // citire + redimensionare foto
  // Proiectul salvat/deschis care poate primi un Link client (portalul public /p/[id])
  const [shareProjectId, setShareProjectId] = useState<string | null>(null);
  // Proiectul salvat ultima dată: dacă a rămas doar local, „Link client” oferă salvarea în cloud dintr-un click
  const [shareInCloud, setShareInCloud] = useState(true);
  const lastSavedProjectRef = useRef<SavedProject | null>(null);

  // Plan de abonament (starter = gratuit / pro / agency) + consum lunar de generări
  const plan = usePlan();
  const refreshPlanRef = useRef(plan.refresh);
  useEffect(() => {
    refreshPlanRef.current = plan.refresh;
  }, [plan.refresh]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const specSectionRef = useRef<HTMLElement>(null);
  const loadingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Numărul „generației" curente: crește când se schimbă fotografia sau spațiul, ca un
  // răspuns întârziat al serverului să nu suprascrie setările mai noi.
  const runIdRef = useRef(0);
  // Id-ul proiectului deschis din Arhivă; la salvare îl actualizăm în loc să creăm un duplicat.
  const loadedProjectIdRef = useRef<string | null>(null);

  // ── Efecte inițiale ────────────────────────────────────────────────────────
  // Restaurarea din localStorage (proiect deschis din Arhivă / stil preferat) nu poate
  // rula la SSR, deci se face o singură dată după montare.

  // Aplică un proiect salvat în toate câmpurile Studio-ului. Datele vechi sau corupte
  // sunt corectate (mod/spațiu/stil necunoscute → prima variantă; cote → limitate).
  const applyProject = (restored: SavedProject) => {
    const restoredMode: DesignMode = restored.mode in SPACE_MODES ? restored.mode : 'interiors';
    const restoredSpace = getSpace(restoredMode, restored.spaceType);
    runIdRef.current += 1;
    loadedProjectIdRef.current = restored.id;
    setShareProjectId(restored.id);
    setMode(restoredMode);
    setSelectedSpace(restoredSpace.id);
    const brief = restored.brief;
    setStyleChoice(brief?.styleAuto ? AUTO : getStyle(restored.styleId).id);
    setCustomPrompt(brief?.customPrompt ?? '');
    setPreserveStructure(brief?.preserveStructure ?? true);
    setPalette(brief?.palette ?? null);
    setLighting(brief?.lighting ?? null);
    setSpaceTouched(true); // camera proiectului salvat nu se mai deduce din text
    const restoredDims = sanitizeDimensions(restored.dimensions, restoredMode, restoredSpace.id);
    setRoomDimensions(restoredDims);
    setVision(
      brief
        ? {
            customPrompt: brief.customPrompt,
            styleId: getStyle(restored.styleId).id,
            styleInferred: brief.styleAuto,
            palette: brief.palette,
            lighting: brief.lighting,
            spaceType: restoredSpace.id,
            spaceInferred: false,
            areaSqm: Math.round(restoredDims.width * restoredDims.length * 10) / 10,
            preserveStructure: brief.preserveStructure,
            materials: [],
          }
        : null,
    );
    setOriginalImage(restored.originalImage);
    setGeneratedImage(restored.generatedImage);
    setExcludedItemIds([]);
    setProjectName(restored.title ?? '');
    setIssueDate(new Date(restored.createdAt).toLocaleDateString('fr-FR'));
  };

  useEffect(() => {
    const restore = async () => {
      // „Deschide în Studio" din Arhivă (/login) lasă aici id-ul proiectului
      // (sau, în versiunile vechi, întregul proiect ca JSON).
      const activeRaw = readStorage(STORAGE_KEYS.activeProject);
      if (activeRaw) {
        removeStorage(STORAGE_KEYS.activeProject);
        let project: SavedProject | null = null;
        try {
          if (activeRaw.trim().startsWith('{')) {
            project = JSON.parse(activeRaw) as SavedProject;
          } else {
            const email = (await getSessionEmail()) ?? readStorage(STORAGE_KEYS.userEmail);
            project = email ? await getProjectById(email, activeRaw) : null;
          }
        } catch {
          project = null;
        }
        if (project) {
          applyProject(project);
          return; // stilul preferat nu trebuie să suprascrie stilul proiectului
        }
        setErrorMessage(
          tr(lang, 'Proiectul nu a putut fi încărcat (a fost șters sau datele lui sunt invalide).', 'The project could not be loaded (it was deleted or its data is invalid).'),
        );
      }

      const savedStyle = readStorage(STORAGE_KEYS.preferredStyle);
      if (savedStyle && VISUAL_STYLES.some((s) => s.id === savedStyle)) {
        setStyleChoice(savedStyle); // ales pe pagina principală sau anterior în Studio
      }
    };
    void restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rulează o singură dată, la montare
  }, []);


  useEffect(() => () => { if (loadingTimerRef.current) clearInterval(loadingTimerRef.current); }, []);

  // ── Calcule derivate ──────────────────────────────────────────────────────
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);

  // Stilul efectiv (cost, listă, PDF): cel ales, altfel cel dedus din descriere (aceeași regulă ca API-ul)
  const selectedStyleId = styleChoice !== AUTO ? styleChoice : (inferStyleFromText(customPrompt) ?? VISUAL_STYLES[0].id);
  const trimmedPrompt = customPrompt.trim();
  // Se poate genera cu o fotografie + descriere SAU stil ales
  const hasIntent = trimmedPrompt.length > 0 || styleChoice !== AUTO;
  const procurementInput = useMemo(
    () => ({ mode, spaceType: selectedSpace, styleId: selectedStyleId, dimensions: roomDimensions, customPrompt: trimmedPrompt || undefined }),
    [mode, selectedSpace, selectedStyleId, roomDimensions, trimmedPrompt],
  );

  const currentMode = SPACE_MODES[mode];
  const currentStyle = getStyle(selectedStyleId);
  const currentSpace = getSpace(mode, selectedSpace);

  // Presetări de mărime ale spațiului curent (Compact / Standard / Spacious)
  const presetLabels: Record<SizePresetId, { ro: string; en: string }> = {
    compact: { ro: 'Compact', en: 'Compact' },
    standard: { ro: 'Standard', en: 'Standard' },
    spacious: { ro: 'Spacious / Open', en: 'Spacious / Open' },
  };
  const sizePresets = SIZE_PRESET_IDS.map((id) => {
    const p = getSizePreset(currentSpace, id);
    return { id, label: t(presetLabels[id].ro, presetLabels[id].en), size: `${p.width} × ${p.length} m` };
  });
  const activePreset = detectSizePreset(currentSpace, roomDimensions.width, roomDimensions.length);
  // Glisoarele merg până la ~1.5× presetarea „Spacious” (valori mai mari se pot tasta)
  const sliderMax = {
    width: Math.ceil(currentSpace.sizePresets.spacious.width * 1.5),
    length: Math.ceil(currentSpace.sizePresets.spacious.length * 1.5),
  };

  // Cantitățile (arii, materiale, iluminat) se recalculează live la fiecare schimbare a cotelor
  const calculatedMaterials = useMemo(
    () => calculateEngineering(roomDimensions, mode, selectedSpace),
    [roomDimensions, mode, selectedSpace],
  );

  // Estimarea de cost depinde de cantități, de buget și de stilul ales
  const costEstimate = useMemo(
    () => estimateCost(roomDimensions, mode, selectedSpace, selectedStyleId, calculatedMaterials),
    [roomDimensions, mode, selectedSpace, selectedStyleId, calculatedMaterials],
  );

  // Mesaje de validare pentru cote (lista goală = cotele sunt valide)
  const dimensionIssues = useMemo(
    () => validateDimensions(roomDimensions, mode, lang),
    [roomDimensions, mode, lang],
  );

  const specItems = useMemo(
    () => generateSpecItems(mode, selectedSpace, roomDimensions, calculatedMaterials),
    [mode, selectedSpace, roomDimensions, calculatedMaterials],
  );

  const selectedItems = specItems.filter((i) => !excludedItemIds.includes(i.id));

  const spaceLabel = tr(lang, currentSpace.labelRo, currentSpace.labelEn);
  const styleName = tr(lang, currentStyle.nameRo, currentStyle.nameEn);
  const modeLabel = tr(lang, currentMode.labelRo, currentMode.labelEn);
  const loadingSteps = trList(lang, LOADING_STEPS_RO, LOADING_STEPS_EN);

  // Numele proiectului: ce a scris utilizatorul, altfel un default inteligent
  const defaultProjectName = t(`Proiect Rezidențial - ${styleName}`, `Residential Project - ${styleName}`,
            `Projet résidentiel — ${styleName}`);
  const resolvedProjectName = projectName.trim() || defaultProjectName;

  const specRows = [
    { label: t('Suprafață pardoseală', 'Floor area'), value: `${calculatedMaterials.floorArea} m²` },
    { label: t('Volum', 'Volume'), value: `${calculatedMaterials.volume} m³` },
    { label: t('Arie netă pereți', 'Net wall area'), value: `${calculatedMaterials.netWallArea} m²` },
    { label: t('Pardoseală +10%', 'Flooring +10%'), value: `${calculatedMaterials.flooringWithWaste} m²` },
    { label: t('Vopsea (2 straturi)', 'Paint (2 coats)'), value: `${calculatedMaterials.paintLiters} L` },
    { label: t('Plintă', 'Baseboard'), value: `${calculatedMaterials.baseboardMeters} ml` },
    { label: t('Gips-carton (plăci)', 'Plasterboard (sheets)'), value: `${calculatedMaterials.plasterboardSheets} ${t('buc.', 'pcs')}` },
    { label: t('Corpuri de iluminat', 'Light fixtures'), value: `${calculatedMaterials.lightFixtures} ${t('buc.', 'pcs')}` },
  ];

  // ── Clase ──────────────────────────────────────────────────────────────────
  const eyebrow = `${EYEBROW} ${sk.dim}`;
  const fieldCls = `w-full h-10 px-3 rounded-sm border text-xs font-mono outline-none transition-colors ${sk.input}`;
  const textareaCls = `w-full px-3 py-2 rounded-md border text-xs font-mono outline-none transition-colors resize-y min-h-[72px] ${sk.input}`;

  // ── Handlers ───────────────────────────────────────────────────────────────

  // Schimbarea modului / spațiului resetează configurația și rezultatul anterior,
  // iar cotele sunt aduse în limitele noului mod (ex: înălțimea unei camere ≤ 6 m).
  const applySpaceSelection = (modeId: DesignMode, spaceId: string) => {
    const nextSpace = getSpace(modeId, spaceId);
    runIdRef.current += 1;
    setMode(modeId);
    setSelectedSpace(nextSpace.id);
    // Un spațiu nou pornește de la cotele lui implicite; scenariile alese nu se mai potrivesc și se șterg
    setRoomDimensions((p) =>
      sanitizeDimensions(
        dimensionsForSpace(modeId, nextSpace.id, { budget: p.budget, aiStrength: p.aiStrength, scope: p.scope }),
        modeId,
        nextSpace.id,
      ),
    );
    setExcludedItemIds([]);
    setGeneratedImage(null);
    setProviderNote(null);
    setSaveMessage(null);
    setErrorMessage(null);
  };

  const handleModeChange = (m: DesignMode) => {
    setSpaceTouched(true);
    applySpaceSelection(m, SPACE_MODES[m].spaces[0].id);
  };

  const handleSpaceChange = (id: string) => {
    setSpaceTouched(true);
    applySpaceSelection(mode, id);
  };

  // Suprafața din opțiunile avansate: o cameră 4:5 cu aria cerută (cotele exacte rămân editabile)
  const handleAreaChange = (area: number) => {
    const width = Math.round(Math.sqrt(area * 0.8) * 10) / 10;
    const length = Math.round((area / width) * 10) / 10;
    setRoomDimensions((p) => ({ ...p, width, length }));
  };

  // Pornire rapidă: fotografia demo din /showcase trece prin același flux ca o încărcare
  const handleDemoPhoto = async () => {
    setErrorMessage(null);
    setIsPhotoLoading(true);
    try {
      const blob = await (await fetch('/showcase/room-before.jpg')).blob();
      const resized = await resizePhoto(new File([blob], 'demo-room.jpg', { type: blob.type || 'image/jpeg' }));
      runIdRef.current += 1;
      loadedProjectIdRef.current = null;
      setShareProjectId(null);
      setOriginalImage(resized);
      setGeneratedImage(null);
      setIsDemoResult(false);
      setProviderNote(null);
      setSaveMessage(null);
      setVision(null);
    } catch {
      setErrorMessage(t('Camera demo nu a putut fi încărcată.', 'The demo room could not be loaded.'));
    } finally {
      setIsPhotoLoading(false);
    }
  };

  // Presetare de mărime: setează lățime, lungime, înălțime și ferestre dintr-un click
  const handleSizePreset = (id: SizePresetId) => {
    const p = getSizePreset(currentSpace, id);
    setRoomDimensions((prev) => ({
      ...prev,
      width: p.width,
      length: p.length,
      height: p.height,
      windowsCount: p.windowsCount,
    }));
  };

  // Scenariile (chips) se bifează / debifează; maximum MAX_FOCUS_CHIPS simultan
  const handleToggleFocus = (id: string) =>
    setRoomDimensions((p) => {
      if (p.focusIds.includes(id)) return { ...p, focusIds: p.focusIds.filter((x) => x !== id) };
      if (p.focusIds.length >= MAX_FOCUS_CHIPS) return p;
      return { ...p, focusIds: [...p.focusIds, id] };
    });

  const handleScopeChange = (scope: ScopeLevel) => setRoomDimensions((p) => ({ ...p, scope }));

  const handleStyleSelect = (id: string) => {
    setStyleChoice(id);
    if (id === AUTO) removeStorage(STORAGE_KEYS.preferredStyle);
    else writeStorage(STORAGE_KEYS.preferredStyle, id);
  };

  // Cotele numerice: valorile negative / invalide devin 0, uși și ferestre sunt întregi,
  // iar plafonul maxim împiedică valori absurde. Minimul se verifică la validare, ca
  // utilizatorul să poată șterge și rescrie liber numărul în câmp.
  const handleNumberChange = (field: NumberField, e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = Number(e.target.value);
    let value = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    if (field === 'doorsCount' || field === 'windowsCount') {
      value = Math.min(DIMENSION_LIMITS[field].max, Math.floor(value));
    } else if (field === 'width' || field === 'length') {
      value = Math.min(DIMENSION_LIMITS[field].max, value);
    } else if (field === 'height') {
      value = Math.min(getHeightLimits(mode).max, value);
    }
    setRoomDimensions((p) => ({ ...p, [field]: value }));
  };

  const updateAi = <K extends keyof AiSettings>(key: K, value: AiSettings[K]) =>
    setAiSettings((p) => ({ ...p, [key]: value }));

  const handleSeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (v === '') { updateAi('seed', null); return; }
    const n = Math.floor(Number(v));
    if (Number.isFinite(n) && n >= 0) updateAi('seed', Math.min(AI_LIMITS.seedMax, n));
  };

  const handleItemToggle = (id: string) =>
    setExcludedItemIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  // Încărcarea fotografiei: validăm formatul / dimensiunea, o redimensionăm și
  // resetăm rezultatul anterior (el aparținea altei fotografii).
  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = ''; // permite alegerea aceluiași fișier de două ori la rând
    if (!file) return;

    setErrorMessage(null);
    setIsPhotoLoading(true);
    try {
      const resized = await resizePhoto(file);
      runIdRef.current += 1;
      loadedProjectIdRef.current = null;
      setShareProjectId(null);
      setOriginalImage(resized);
      setGeneratedImage(null);
      setIsDemoResult(false);
      setProviderNote(null);
      setSaveMessage(null);
      setVision(null);
    } catch (err) {
      const code = err instanceof PhotoError ? err.code : 'decode';
      const messages: Record<string, string> = {
        type: t('Format neacceptat. Folosește o fotografie JPEG, PNG sau WebP.', 'Unsupported format. Use a JPEG, PNG or WebP photo.'),
        size: t(`Fotografia depășește ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`, `The photo is larger than ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`,
            `La photo dépasse ${MAX_PHOTO_BYTES / 1024 / 1024} Mo.`),
        small: t(`Fotografia este prea mică (minim ${MIN_PHOTO_SIDE} px pe latura scurtă).`, `The photo is too small (at least ${MIN_PHOTO_SIDE} px on the short side).`,
            `La photo est trop petite (au moins ${MIN_PHOTO_SIDE} px sur le petit côté).`),
        huge: t('Fotografia este prea detaliată pentru a fi trimisă. Încearcă una mai simplă.', 'The photo is too detailed to upload. Try a simpler one.'),
        decode: t('Fotografia nu a putut fi citită.', 'The photo could not be read.'),
      };
      setErrorMessage(messages[code] ?? messages.decode);
    } finally {
      setIsPhotoLoading(false);
    }
  };

  const startLoadingAnimation = () => {
    stopLoadingAnimation(); // nu lăsăm niciodată două cronometre active
    setLoadingStep(0);
    loadingTimerRef.current = setInterval(
      () => setLoadingStep((s) => (s + 1) % loadingSteps.length),
      1500,
    );
  };

  const stopLoadingAnimation = () => {
    if (loadingTimerRef.current) {
      clearInterval(loadingTimerRef.current);
      loadingTimerRef.current = null;
    }
  };

  // Generarea: verifică planul și cotele, apelează /api/generate (cu timeout) și
  // tratează fiecare tip de eroare (limită, autentificare, rețea, răspuns invalid).
  const handleGenerate = async () => {
    if (!originalImage || isLoading || isPhotoLoading) return;
    if (!hasIntent) {
      setErrorMessage(t('Descrie ce îți dorești sau alege un stil din opțiunile avansate.', 'Describe your vision or pick a style in the advanced options.'));
      return;
    }
    if (dimensionIssues.length > 0) {
      setErrorMessage(dimensionIssues[0]);
      return;
    }

    // Verificare plan (re-citită la fiecare click): „starter" are maximum
    // PLAN_LIMITS.starterMonthlyGenerations generări AI pe lună. „pro" / „agency" = nelimitat.
    const currentPlan = await resolvePlan();
    const isStarter = currentPlan.tier === 'starter';
    if (isStarter) {
      const usedNow = await getMonthlyUsage(currentPlan.email);
      if (usedNow >= PLAN_LIMITS.starterMonthlyGenerations) {
        await plan.refresh();
        setErrorMessage(
          t(
            `Ai folosit cele ${PLAN_LIMITS.starterMonthlyGenerations} generări gratuite din această lună. Treci pe Professional pentru generări nelimitate.`,
            `You have used your ${PLAN_LIMITS.starterMonthlyGenerations} free generations this month. Upgrade to Professional for unlimited generations.`,
            `Vous avez utilisé vos ${PLAN_LIMITS.starterMonthlyGenerations} générations gratuites ce mois-ci. Passez à Professional pour des générations illimitées.`,
          ),
        );
        return;
      }
    }

    setIsLoading(true);
    setErrorMessage(null);
    setGateCode(null);
    setSaveMessage(null);
    setProviderNote(null);

    // Camera neatinsă manual: o deducem din descriere (ex. „bucătărie japandi”) înainte de randare
    let requestSpace = selectedSpace;
    let requestDims = roomDimensions;
    const inferredSpace = spaceTouched ? null : inferSpaceFromText(mode, trimmedPrompt);
    if (inferredSpace && inferredSpace !== selectedSpace) {
      requestSpace = getSpace(mode, inferredSpace).id;
      requestDims = sanitizeDimensions(
        dimensionsForSpace(mode, requestSpace, { budget: roomDimensions.budget, aiStrength: roomDimensions.aiStrength, scope: roomDimensions.scope }),
        mode,
        requestSpace,
      );
      applySpaceSelection(mode, requestSpace);
    }
    startLoadingAnimation();

    const runId = runIdRef.current;
    // API-ul are un buget de 80 s pentru modelul AI (Ai:GenerationBudgetSeconds) și răspunde 504 AI_TIMEOUT
    // fără să contorizeze generarea. Browserul așteaptă mai mult (120 s), ca să nu renunțe la o randare
    // pe care serverul o finalizează și o taxează.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000);

    try {
      const accessToken = await getAccessToken();
      const res = await apiFetch('/api/generate', {
        signal: controller.signal,
        method: 'POST',
        token: accessToken,
        json: {
          image: originalImage,
          mode,
          spaceType: requestSpace,
          roomType: requestSpace,
          // Stil omis = „Auto”: serverul îl deduce din descriere
          ...(styleChoice !== AUTO ? { styleId: styleChoice, style: styleChoice } : {}),
          customPrompt: trimmedPrompt || undefined,
          palette: palette ?? undefined,
          lighting: lighting ?? undefined,
          areaSqm: Math.round(requestDims.width * requestDims.length * 10) / 10,
          preserveStructure,
          dimensions: requestDims,
          ai: aiSettings,
        },
      });
      const data = await readJson<{ result?: unknown; isDemo?: boolean; warning?: string; vision?: VisionResponse }>(res);
      if (!res.ok) {
        const code = typeof data.code === 'string' ? data.code : '';
        if (code === 'LIMIT_REACHED') {
          setGateCode('LIMIT_REACHED');
          void plan.refresh();
          throw new Error(
            t(
              `Ai folosit cele ${PLAN_LIMITS.starterMonthlyGenerations} generări gratuite din această lună. Treci pe Professional pentru generări nelimitate.`,
              `You have used your ${PLAN_LIMITS.starterMonthlyGenerations} free generations this month. Upgrade to Professional for unlimited generations.`,
            `Vous avez utilisé vos ${PLAN_LIMITS.starterMonthlyGenerations} générations gratuites ce mois-ci. Passez à Professional pour des générations illimitées.`,
            ),
          );
        }
        if (code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID') {
          setGateCode('AUTH_REQUIRED');
          throw new Error(
            t(
              'Autentifică-te cu un cont real pentru a genera randări (profilurile Demo nu pot genera pe server).',
              'Sign in with a real account to generate renders (Demo profiles cannot generate on the server).',
            ),
          );
        }
        throw new Error(data.error ?? 'Generation failed');
      }

      const result: unknown = data.result;
      if (typeof result !== 'string' || !(result.startsWith('data:image/') || result.startsWith('http'))) {
        throw new Error(t('Serverul a returnat un răspuns invalid. Încearcă din nou.', 'The server returned an invalid response. Please try again.'));
      }

      // Generarea a fost facturată/numărată pe server, deci o înregistrăm și local
      if (isStarter) {
        recordGeneration(currentPlan.email);
      }

      // Dacă între timp s-au schimbat spațiul sau fotografia, rezultatul nu mai corespunde
      if (runId !== runIdRef.current) {
        setErrorMessage(t('Setările s-au schimbat în timpul generării, iar rezultatul a fost ignorat. Generează din nou.', 'Settings changed during generation, so the result was discarded. Generate again.'));
        return;
      }

      loadedProjectIdRef.current = null; // o randare nouă = un proiect nou la salvare
      setShareProjectId(null);
      setGeneratedImage(result);
      setIsDemoResult(Boolean(data.isDemo));
      setProviderNote(typeof data.warning === 'string' ? data.warning : null);
      setVision(data.vision && typeof data.vision === 'object' ? data.vision : null);
      setIssueDate(new Date().toLocaleDateString('fr-FR'));

      setTimeout(() => specSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setErrorMessage(t('Generarea durează prea mult. Încearcă din nou în câteva momente.', 'Generation is taking too long. Please try again in a moment.'));
      } else if (err instanceof TypeError) {
        setErrorMessage(t('Conexiunea cu serverul a eșuat. Verifică internetul și încearcă din nou.', 'Could not reach the server. Check your connection and try again.'));
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'Error');
      }
    } finally {
      clearTimeout(timeoutId);
      stopLoadingAnimation();
      setIsLoading(false);
    }
  };

  // Salvarea proiectului: cere cont, convertește randarea într-un Base64 permanent
  // (URL-urile temporare expiră), apoi o trimite în Supabase cu rezervă locală.
  const handleSaveProject = async () => {
    if (!originalImage || !generatedImage || isSaving) return;
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const sessionEmail = await getSessionEmail();
      const userEmail = sessionEmail ?? readStorage(STORAGE_KEYS.userEmail);
      if (!userEmail) {
        setSaveMessage(t('Autentifică-te pentru a salva proiectul.', 'Sign in to save the project.'));
        return;
      }

      // Serverul întoarce deja un Data URL JPEG permanent; aici e doar o plasă de siguranță
      // pentru URL-uri temporare (pentru Data URL-uri nu face nimic).
      const permanentGeneratedImage = await toPermanentDataUrl(generatedImage);

      // Nu salvăm niciodată un URL http(s) temporar: expiră și imaginea devine neagră a doua zi.
      if (!permanentGeneratedImage.startsWith('data:image/')) {
        setSaveMessage(
          t(
            'Imaginea generată a expirat sau nu poate fi descărcată. Generează din nou, apoi salvează.',
            'The generated image expired or cannot be downloaded. Generate again, then save.',
          ),
        );
        return;
      }

      // Dacă proiectul a fost deschis din Arhivă și nu s-a regenerat, îl actualizăm (același id)
      const isUpdate = loadedProjectIdRef.current !== null;
      const brief: DesignBriefMeta | undefined =
        trimmedPrompt || palette || lighting || !preserveStructure || styleChoice === AUTO
          ? { customPrompt: trimmedPrompt, preserveStructure, palette, lighting, styleAuto: styleChoice === AUTO }
          : undefined;
      // Lista calculată de API pentru exact aceste setări (include materialele din descriere); altfel calculul local
      const serverBom = serverBomRef.current?.key === JSON.stringify(procurementInput) ? serverBomRef.current.items : null;
      const project: SavedProject = {
        id: loadedProjectIdRef.current ?? crypto.randomUUID(),
        userEmail: userEmail.toLowerCase(),
        title: resolvedProjectName, // numele proiectului (utilizator sau default)
        mode,
        spaceType: selectedSpace,
        styleId: selectedStyleId,
        dimensions: roomDimensions,
        originalImage,
        generatedImage: permanentGeneratedImage,
        totalBudget: costEstimate.total, // estimarea de cost orientativă, în €
        createdAt: new Date().toISOString(),
        // Lista de materiale & linkuri (aceeași funcție ca /api/analyze-materials) — Arhiva o afișează direct
        procurementItems: serverBom ?? buildBom({ mode, spaceType: selectedSpace, styleId: selectedStyleId, dimensions: roomDimensions }).items,
        brief,
      };
      const result = await saveProjectToDb(project);
      loadedProjectIdRef.current = project.id; // salvările următoare actualizează, nu duplică
      lastSavedProjectRef.current = project;
      if (result.savedToCloud || result.savedLocally) {
        // Proiect doar local → ShareControl afișează „Salvează în cloud pentru a partaja”
        setShareProjectId(project.id);
        setShareInCloud(result.savedToCloud);
      }

      if (result.savedToCloud) {
        setSaveMessage(
          isUpdate
            ? t('Proiect actualizat în Supabase Cloud!', 'Project updated in Supabase Cloud!')
            : t('Proiect salvat în Supabase Cloud!', 'Project saved to Supabase Cloud!'),
        );
      } else if (result.savedLocally) {
        setSaveMessage(
          t(`Salvat local${result.errorMessage ? ` (${result.errorMessage})` : ''}.`,
            `Saved locally${result.errorMessage ? ` (${result.errorMessage})` : ''}.`,
            `Enregistré localement${result.errorMessage ? ` (${result.errorMessage})` : ''}.`),
        );
      } else {
        setSaveMessage(
          t(
            `Proiectul NU a putut fi salvat${result.errorMessage ? `: ${result.errorMessage}` : ''}. Memoria browserului este plină.`,
            `The project could NOT be saved${result.errorMessage ? `: ${result.errorMessage}` : ''}. Browser storage is full.`,
            `Le projet n’a PAS pu être enregistré${result.errorMessage ? ` : ${result.errorMessage}` : ''}. Le stockage du navigateur est plein.`,
          ),
        );
      }
    } catch (err) {
      setSaveMessage(
        t(
          `Salvarea a eșuat: ${err instanceof Error ? err.message : 'eroare necunoscută'}.`,
          `Saving failed: ${err instanceof Error ? err.message : 'unknown error'}.`,
            `Échec de l’enregistrement : ${err instanceof Error ? err.message : 'erreur inconnue'}.`,
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportPdf = () => window.print();

  // ── Render ────────────────────────────────────────────────────────────────
  const statusLabel = isLoading
    ? t('Se generează randarea…', 'Rendering your design…')
    : generatedImage
      ? t('Randare finalizată', 'Render complete')
      : t('Studio pregătit', 'Studio ready');

  return (
    <div className={`min-h-screen font-sans pb-24 transition-colors print:bg-white print:text-black print:pb-0 ${sk.page}`}>
      <Navbar />

      {/* ═══════════════ WORKSPACE ═══════════════════════════════════════════ */}
      <div className="print:hidden">
        <TelemetryBar
          lang={lang}
          isDark={isDark}
          isLoading={isLoading}
          statusLabel={statusLabel}
          modeLabel={modeLabel}
          spaceLabel={spaceLabel}
          plan={plan}
        />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-8 grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* ─── COLOANA STÂNGĂ: setări proiect ───────────────────────────
              relative z-20 = propriul stacking context, deasupra coloanei din dreapta
              (viewport / slider), ca popover-ul de stil să nu mai apară în spatele pozei. */}
          <div className="lg:col-span-5 space-y-6 relative z-20">
            <div>
              <p className={eyebrow}>Studio / {t('Proiect nou', 'New project')}</p>
              <h1 className={`text-2xl font-semibold tracking-tight mt-2 ${sk.strong}`}>
                {t('Proiect nou', 'New project')}
              </h1>
            </div>

            {/* 01 · Fotografie */}
            <section className={`border rounded-md ${sk.card}`}>
              <div className={`px-4 h-9 flex items-center border-b ${sk.line} ${eyebrow}`}>
                01 · {t('Fotografie', 'Photo')}
              </div>
              <div className="p-4 space-y-4">
                <input ref={fileInputRef} type="file" accept={ACCEPTED_PHOTO_TYPES.join(',')} onChange={handlePhotoChange} className="hidden" />
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
                    onClick={() => void handleDemoPhoto()}
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
                    <span className={`tabular-nums ${sk.strong}`}>{roomDimensions.aiStrength}%</span>
                  </span>
                  <input
                    type="range" min={40} max={100}
                    value={roomDimensions.aiStrength}
                    onChange={(e) => handleNumberChange('aiStrength', e)}
                    className="w-full accent-[var(--foreground)] touch-manipulation touch-pan-y"
                  />
                </label>

              </div>
            </section>

            {/* 02 · Ce vrei să obții? (descriere liberă + inspirații + opțiuni avansate opționale) */}
            <VisionPanel
              lang={lang}
              isDark={isDark}
              customPrompt={customPrompt}
              onCustomPromptChange={setCustomPrompt}
              preserveStructure={preserveStructure}
              onPreserveStructureChange={setPreserveStructure}
              styleChoice={styleChoice}
              onStyleChange={handleStyleSelect}
              autoStyleName={styleChoice === AUTO && inferStyleFromText(customPrompt) ? styleName : null}
              palette={palette}
              onPaletteChange={setPalette}
              lighting={lighting}
              onLightingChange={setLighting}
              areaSqm={calculatedMaterials.floorArea}
              onAreaChange={handleAreaChange}
              disabled={isLoading}
            />

            {/* Detalii proiect (opțional): spațiu, scenarii, cote exacte, buget — închise implicit */}
            <div className={`border rounded-md ${sk.card}`}>
              <button
                type="button"
                onClick={() => setIsProjectDetailsOpen((o) => !o)}
                aria-expanded={isProjectDetailsOpen}
                className={`w-full min-h-11 px-4 py-2 flex items-center justify-between gap-3 text-left cursor-pointer touch-manipulation transition-colors ${EYEBROW} ${sk.rowHover}`}
              >
                <span>
                  {t('Spațiu, cote & buget — opțional', 'Space, dimensions & budget — optional')}
                  <span className={`block normal-case tracking-normal font-normal text-[11px] mt-0.5 ${sk.muted}`}>
                    {modeLabel} · {spaceLabel}{!spaceTouched && trimmedPrompt ? ` (${t('auto din descriere', 'auto from description')})` : ''} · {calculatedMaterials.floorArea} m² · ≈ {costEstimate.total.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €
                  </span>
                </span>
                <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${isProjectDetailsOpen ? 'rotate-180' : ''}`} />
              </button>
              {isProjectDetailsOpen && (
                <div className={`p-3 sm:p-4 space-y-4 border-t ${sk.line}`}>
                  <SpaceScenarioPanel
                    lang={lang}
                    isDark={isDark}
                    projectName={projectName}
                    defaultProjectName={defaultProjectName}
                    mode={mode}
                    spaceId={selectedSpace}
                    layoutId={roomDimensions.layoutPreset}
                    focusIds={roomDimensions.focusIds}
                    scope={roomDimensions.scope}
                    onProjectNameChange={setProjectName}
                    onModeChange={handleModeChange}
                    onSpaceChange={handleSpaceChange}
                    onLayoutChange={(layoutPreset) => setRoomDimensions((p) => ({ ...p, layoutPreset }))}
                    onToggleFocus={handleToggleFocus}
                    onScopeChange={handleScopeChange}
                  />

                  <DimensionsPanel
                    lang={lang}
                    isDark={isDark}
                    roomDimensions={roomDimensions}
                    floorArea={calculatedMaterials.floorArea}
                    issues={dimensionIssues}
                    onNumberChange={handleNumberChange}
                    onBudgetChange={(budget) => setRoomDimensions((p) => ({ ...p, budget }))}
                    presets={sizePresets}
                    activePreset={activePreset}
                    onPresetSelect={handleSizePreset}
                    sliderMax={sliderMax}
                    costTotal={costEstimate.total}
                    costMin={costEstimate.min}
                    costMax={costEstimate.max}
                  />
                </div>
              )}
            </div>

            {/* 03 · Generare */}
            <section className={`border rounded-md ${sk.card}`}>
              <div className={`px-4 h-9 flex items-center border-b ${sk.line} ${eyebrow}`}>
                03 · {t('Generare', 'Generate')}
              </div>
              <div className="p-4 space-y-4">
                {/* Setări avansate AI */}
                <div className={`border rounded-sm ${sk.line}`}>
                  <button
                    type="button"
                    onClick={() => setIsAdvancedOpen((p) => !p)}
                    aria-expanded={isAdvancedOpen}
                    className={`w-full h-10 px-3 flex items-center justify-between cursor-pointer touch-manipulation transition-colors ${EYEBROW} ${sk.rowHover}`}
                  >
                    <span>{t('Setări AI pentru experți', 'Expert AI settings')}</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isAdvancedOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {isAdvancedOpen && (
                    <div className={`p-4 space-y-5 border-t ${sk.line}`}>
                      <label className="block space-y-1.5">
                        <span className={eyebrow}>{t('Prompt suplimentar (în engleză)', 'Extra prompt')}</span>
                        <textarea
                          value={aiSettings.extraPrompt}
                          maxLength={AI_LIMITS.extraPromptMaxLength}
                          placeholder={t('ex: large window with sheer curtains', 'e.g. large window with sheer curtains')}
                          onChange={(e) => updateAi('extraPrompt', e.target.value)}
                          className={textareaCls}
                        />
                      </label>
                      <label className="block space-y-1.5">
                        <span className={eyebrow}>{t('De evitat în randare', 'Negative prompt')}</span>
                        <textarea value={aiSettings.negativePrompt} maxLength={AI_LIMITS.negativePromptMaxLength} onChange={(e) => updateAi('negativePrompt', e.target.value)} className={textareaCls} />
                      </label>
                      <label className="block space-y-2">
                        <span className={`flex justify-between ${eyebrow}`}>
                          <span>{t('Pași de inferență', 'Inference steps')}</span>
                          <span className={`tabular-nums ${sk.strong}`}>{aiSettings.inferenceSteps}</span>
                        </span>
                        <input type="range" min={AI_LIMITS.inferenceSteps.min} max={AI_LIMITS.inferenceSteps.max} step={AI_LIMITS.inferenceSteps.step} value={aiSettings.inferenceSteps} onChange={(e) => updateAi('inferenceSteps', Number(e.target.value))} className="w-full accent-[var(--foreground)] touch-manipulation touch-pan-y" />
                      </label>
                      <label className="block space-y-2">
                        <span className={`flex justify-between ${eyebrow}`}>
                          <span>{t('Scală de ghidaj (CFG)', 'Guidance scale (CFG)')}</span>
                          <span className={`tabular-nums ${sk.strong}`}>{aiSettings.guidanceScale}</span>
                        </span>
                        <input type="range" min={AI_LIMITS.guidanceScale.min} max={AI_LIMITS.guidanceScale.max} step={AI_LIMITS.guidanceScale.step} value={aiSettings.guidanceScale} onChange={(e) => updateAi('guidanceScale', Number(e.target.value))} className="w-full accent-[var(--foreground)] touch-manipulation touch-pan-y" />
                      </label>
                      <label className="block space-y-1.5">
                        <span className={eyebrow}>Seed ({t('gol = aleatoriu', 'empty = random')})</span>
                        <input type="number" inputMode="numeric" min={0} step={1} value={aiSettings.seed ?? ''} onChange={handleSeedChange} className={fieldCls} />
                      </label>
                      <button type="button" onClick={() => setAiSettings(DEFAULT_AI_SETTINGS)} className={`inline-flex items-center gap-2 h-8 px-3 rounded-sm cursor-pointer touch-manipulation transition-colors ${EYEBROW} ${sk.btnGhost}`}>
                        <RotateCcw className="w-3 h-3" />
                        {t('Resetează valorile', 'Reset to defaults')}
                      </button>
                    </div>
                  )}
                </div>

                {/* Limita planului gratuit */}
                {plan.limitReached && (
                  <div role="alert" className={`rounded-sm border p-4 space-y-3 ${isDark ? 'border-amber-400/30 bg-amber-400/[0.04]' : 'border-amber-600/30 bg-amber-500/[0.06]'}`}>
                    <div className="flex items-start gap-3">
                      <Lock className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${isDark ? 'text-amber-400' : 'text-amber-700'}`} />
                      <div className="space-y-1">
                        <p className={`${EYEBROW} ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>
                          {t('Ai atins limita lunară de generări', 'Monthly generation limit reached')}
                        </p>
                        <p className={`text-xs leading-relaxed ${sk.muted}`}>
                          {t(
                            `Planul Studio (gratuit) include ${plan.limit} proiecte pe lună, iar le-ai folosit pe toate (${plan.used}/${plan.limit}). Treci pe Professional pentru generări nelimitate sau revino luna viitoare.`,
                            `The Studio (free) plan includes ${plan.limit} projects per month and you have used them all (${plan.used}/${plan.limit}). Upgrade to Professional for unlimited generations or come back next month.`,
            `L’offre Studio (gratuite) inclut ${plan.limit} projets par mois et vous les avez tous utilisés (${plan.used}/${plan.limit}). Passez à Professional pour des générations illimitées ou revenez le mois prochain.`,
                          )}
                        </p>
                      </div>
                    </div>
                    <Link
                      href="/#planuri"
                      className={`inline-flex items-center h-9 px-4 rounded-sm touch-manipulation ${EYEBROW} font-semibold ${sk.btn}`}
                    >
                      {t('Vezi planurile', 'View plans')}
                    </Link>
                  </div>
                )}

                {/* Buton Generează */}
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={!originalImage || !hasIntent || isLoading || isPhotoLoading || plan.limitReached || dimensionIssues.length > 0}
                  className={`w-full h-12 sm:h-11 rounded-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer touch-manipulation ${EYEBROW} ${sk.btn}`}
                >
                  {isLoading
                    ? <span className="flex items-center justify-center gap-2.5">
                        <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                        {loadingSteps[loadingStep]}
                      </span>
                    : t('Generează Design', 'Generate Design')}
                </button>

                {!isLoading && (!originalImage || !hasIntent) && (
                  <p className={`text-[11px] ${sk.muted}`}>
                    {!originalImage
                      ? t('Încarcă o fotografie a camerei pentru a începe.', 'Upload a photo of the room to start.')
                      : t('Scrie ce îți dorești sau alege un stil în „Opțiuni avansate”.', 'Describe your vision or pick a style in “Advanced options”.')}
                  </p>
                )}

                {errorMessage && <p role="alert" className="text-xs text-red-500 font-mono">{errorMessage}</p>}
                {gateCode && (
                  <Link
                    href={gateCode === 'LIMIT_REACHED' ? '/#planuri' : '/login'}
                    className={`inline-flex items-center h-9 px-4 rounded-sm touch-manipulation ${EYEBROW} font-semibold ${sk.btn}`}
                  >
                    {gateCode === 'LIMIT_REACHED' ? t('Vezi planurile', 'View plans') : t('Autentifică-te', 'Sign in')}
                  </Link>
                )}
              </div>
            </section>
          </div>

          {/* ─── COLOANA DREAPTĂ: rezultat + deviz tehnic ──────────────────
              Desktop: panou lipit sub bara de navigare (lg:sticky lg:top-24) — randarea rămâne vizibilă
              cât timp derulezi setările din stânga; panourile de sub ea se derulează în interiorul coloanei. */}
          <div className="lg:col-span-7 space-y-6 relative z-0 lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1 lg:pb-6">

            <StudioViewport
              lang={lang}
              isDark={isDark}
              originalImage={originalImage}
              generatedImage={generatedImage}
              issueDate={issueDate}
              isDemoResult={isDemoResult}
              providerNote={providerNote}
              isLoading={isLoading}
              loadingLabel={loadingSteps[loadingStep]}
            />

            {vision && generatedImage && !isLoading && (
              <VisionSummary lang={lang} isDark={isDark} vision={vision} costTotal={costEstimate.total} />
            )}

            <EngineeringPanel lang={lang} isDark={isDark} isLoading={isLoading} specRows={specRows} />

            <CostBreakdown lang={lang} isDark={isDark} cost={costEstimate} styleName={styleName} />

            <ProcurementPanel
              lang={lang}
              isDark={isDark}
              input={procurementInput}
              renderKey={generatedImage && !isLoading ? `${generatedImage.length}:${generatedImage.slice(-48)}` : null}
              projectName={resolvedProjectName}
              getProjectId={() => loadedProjectIdRef.current}
              onBom={(key: string, bom: BomResult) => {
                serverBomRef.current = { key, items: bom.items };
              }}
            />

            {generatedImage && (
              <ManufacturerSpecs
                ref={specSectionRef}
                lang={lang}
                isDark={isDark}
                specItems={specItems}
                selectedItems={selectedItems}
                excludedItemIds={excludedItemIds}
                saveMessage={saveMessage}
                isSaving={isSaving}
                onToggleItem={handleItemToggle}
                onExportPdf={handleExportPdf}
                onSave={handleSaveProject}
              />
            )}

            {/* 06 · Link client: publică proiectul salvat în portalul de aprobare /p/[id] */}
            {shareProjectId && (
              <section className={`border rounded-md ${sk.card}`}>
                <div className={`px-4 h-9 flex items-center justify-between border-b ${sk.line} ${eyebrow}`}>
                  <span>06 · {t('Prezentare client', 'Client presentation')}</span>
                  <span className="font-mono normal-case tracking-normal tabular-nums">/p/{shareProjectId.slice(0, 8)}…</span>
                </div>
                <ShareControl
                  key={`${shareProjectId}:${shareInCloud}`}
                  projectId={shareProjectId}
                  isDark={isDark}
                  lang={lang}
                  showStatus
                  className="p-4"
                  inCloud={shareInCloud}
                  onSaveToCloud={async () => {
                    const project = lastSavedProjectRef.current;
                    if (!project) return false;
                    const saved = (await saveProjectToDb(project)).savedToCloud;
                    if (saved) setSaveMessage(t('Proiect salvat în Supabase Cloud!', 'Project saved to Supabase Cloud!'));
                    return saved;
                  }}
                />
              </section>
            )}
          </div>
        </div>
      </div>

      {/* ═══════════════ PRINT ONLY: Blueprint & Material Passport ═══════════ */}
      <PrintBlueprint
        lang={lang}
        issueDate={issueDate}
        projectName={resolvedProjectName}
        modeLabel={modeLabel}
        spaceLabel={spaceLabel}
        styleName={styleName}
        roomDimensions={roomDimensions}
        generatedImage={generatedImage}
        specRows={specRows}
        selectedItems={selectedItems}
        cost={costEstimate}
      />
    </div>
  );
}