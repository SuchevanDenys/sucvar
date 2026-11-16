// app/generate/page.tsx
// Studio SUCVAR — orchestratorul paginii /generate.
//
// Pagina deține starea proiectului (fotografie, brief, cote, rezultat) și fluxurile asincrone
// (generare, salvare, restaurare din Arhivă). Secțiunile vizuale sunt componente fără stare proprie
// din `components/studio/*`; calculele pure sunt în `lib/studio/*` și `data/catalog.ts`.
//
// Invariante:
//   • `runIdRef` crește la fiecare schimbare de fotografie / spațiu: un răspuns de la /api/generate care
//     sosește după o astfel de schimbare este ignorat (nu suprascrie setări mai noi).
//   • `loadedProjectIdRef` ≠ null ⇒ salvarea actualizează proiectul deschis din Arhivă (același id);
//     o randare nouă îl resetează, deci produce un proiect nou.
//   • Verificarea planului de aici este doar UX; limita reală este impusă de API (403 LIMIT_REACHED).
"use client";

import { formatLei } from '@/app/lib/format';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, SlidersHorizontal, Sparkles } from 'lucide-react';
import Navbar from '@/app/components/layout/Navbar';
import {
  DEFAULT_SCOPE,
  MAX_FOCUS_CHIPS,
  SIZE_PRESET_IDS,
  SPACE_MODES,
  VISUAL_STYLES,
  calculateEngineering,
  estimateCost,
  generateSpecItems,
  getSizePreset,
  getSpace,
  getStyle,
} from '@/app/data/catalog';
import { AI_STRENGTH, DEFAULT_AI_SETTINGS, PLAN_LIMITS } from '@/app/lib/studio/aiConfig';
import { getAccessToken, getSessionEmail } from '@/app/lib/supabase/auth';
import { getProjectById, saveProjectToDb } from '@/app/lib/supabase/projects';
import { buildBom } from '@/app/lib/procurement';
import { getMonthlyUsage, recordGeneration, resolvePlan } from '@/app/lib/plan/client';
import { usePlan } from '@/app/lib/plan/usePlan';
import { getSkin, EYEBROW } from '@/app/lib/theme/skin';
import { usePrefs } from '@/app/lib/theme/usePrefs';
import { STORAGE_KEYS, readStorage, removeStorage, writeStorage } from '@/app/lib/storage';
import { ACCEPTED_PHOTO_TYPES, LOADING_STEPS_RO, LOADING_STEPS_EN, type NumberField } from '@/app/lib/studio/constants';
import { PhotoError, resizePhoto, toPermanentDataUrl } from '@/app/lib/studio/images';
import {
  DIMENSION_LIMITS,
  getHeightLimits,
  sanitizeDimensions,
  validateDimensions,
} from '@/app/lib/studio/validation';
import {
  buildSpecRows,
  dimensionsForSpace,
  photoErrorMessage,
  roundedArea,
  starterLimitMessage,
} from '@/app/lib/studio/studioHelpers';
import { useLoadingTicker } from '@/app/lib/studio/useLoadingTicker';
import DimensionsPanel from '@/app/components/studio/DimensionsPanel';
import ExpertAiSettings from '@/app/components/studio/ExpertAiSettings';
import RoomStylePicker from '@/app/components/studio/RoomStylePicker';
import RoomSizeCard, { INTERIOR_SIZE_PRESETS, type RoomSizePreset } from '@/app/components/studio/RoomSizeCard';
import SourcePhotoCard from '@/app/components/studio/SourcePhotoCard';
import { StudioCard } from '@/app/components/studio/StudioCard';
import PlanLimitNotice from '@/app/components/studio/PlanLimitNotice';
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
  type PromptInsight,
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
import type { AiSettings, DesignMode, RoomDimensions, SavedProject, ScopeLevel } from '@/app/types';
import { apiFetch, readJson } from '@/app/lib/api-client';
import { LOCALES, tr, trList } from '@/app/lib/i18n';

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
      aiStrength: AI_STRENGTH.recommended, // 72 %: zona optimă cu structura păstrată
      scope: DEFAULT_SCOPE,
    }),
  );
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  // „Prompt optimizat AI": ultimul prompt compilat (previzualizare sau randare) + cheia intrării care l-a produs
  const [promptInsight, setPromptInsight] = useState<(PromptInsight & { key: string }) | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // ── Stare: rezultatul generării și mesajele de interfață ──
  // (loading / eroare / salvare sunt stări separate, ca fiecare acțiune să aibă feedback clar)
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isDemoResult, setIsDemoResult] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
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

  const specSectionRef = useRef<HTMLElement>(null);
  // Input de fișier al canvas-ului (click pe zona goală din stânga)
  const canvasFileRef = useRef<HTMLInputElement>(null);
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
            areaSqm: roundedArea(restoredDims),
            preserveStructure: brief.preserveStructure,
            materials: [],
          }
        : null,
    );
    setOriginalImage(restored.originalImage);
    setGeneratedImage(restored.generatedImage);
    setExcludedItemIds([]);
    setProjectName(restored.title ?? '');
    setIssueDate(new Date(restored.createdAt).toLocaleDateString(LOCALES[lang]));
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

  // Presetări de mărime: interioare = apartamente tipice din România (12 / 20 / 32 m²);
  // exterior / grădină = presetările spațiului din catalog.
  const sizePresets: RoomSizePreset[] = mode === 'interiors'
    ? INTERIOR_SIZE_PRESETS.map((p) => ({ id: p.id, label: t(p.ro, p.en), length: p.length, width: p.width, height: p.height }))
    : SIZE_PRESET_IDS.map((id) => {
        const p = getSizePreset(currentSpace, id);
        const labels = { compact: t('Compact', 'Compact'), standard: 'Standard', spacious: t('Spațios', 'Spacious') };
        return { id, label: labels[id], length: p.length, width: p.width, height: p.height };
      });

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
  const loadingTicker = useLoadingTicker(loadingSteps.length);

  // Numele proiectului: ce a scris utilizatorul, altfel un default inteligent
  const defaultProjectName = t(`Proiect Rezidențial - ${styleName}`, `Residential Project - ${styleName}`,
            `Projet résidentiel — ${styleName}`);
  const resolvedProjectName = projectName.trim() || defaultProjectName;

  const specRows = buildSpecRows(calculatedMaterials, t);

  // ── Clase ──────────────────────────────────────────────────────────────────
  const eyebrow = `${EYEBROW} ${sk.dim}`;

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

  // Presetare de mărime: lungime × lățime × înălțime dintr-un click (cererea AI și costul se actualizează imediat)
  const handleSizePreset = (preset: RoomSizePreset) =>
    setRoomDimensions((prev) => ({ ...prev, length: preset.length, width: preset.width, height: preset.height }));

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

  const handleItemToggle = (id: string) =>
    setExcludedItemIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  // Încărcarea fotografiei (click, cameră sau drag-and-drop): validăm formatul / dimensiunea, o redimensionăm
  // și resetăm rezultatul anterior (el aparținea altei fotografii).
  const handlePhotoFile = async (file: File) => {
    if (isLoading || isPhotoLoading) return;
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
      setErrorMessage(photoErrorMessage(err instanceof PhotoError ? err.code : 'decode', t));
    } finally {
      setIsPhotoLoading(false);
    }
  };

  // Brief-ul trimis la /api/generate și /api/prompt-preview (aceleași câmpuri: previzualizarea = randarea)
  const buildBriefPayload = (space: string, dims: RoomDimensions) => ({
    mode,
    spaceType: space,
    roomType: space,
    // Stil omis = „Auto”: serverul îl deduce din descriere
    ...(styleChoice !== AUTO ? { styleId: styleChoice, style: styleChoice } : {}),
    customPrompt: trimmedPrompt || undefined,
    palette: palette ?? undefined,
    lighting: lighting ?? undefined,
    areaSqm: roundedArea(dims),
    preserveStructure,
    dimensions: dims,
    ai: aiSettings,
  });
  const previewSpace = (!spaceTouched && inferSpaceFromText(mode, trimmedPrompt)) || selectedSpace;
  const briefKey = JSON.stringify(buildBriefPayload(previewSpace, roomDimensions));

  // „Prompt optimizat AI": compilează promptul pe server fără fotografie și fără a consuma o generare
  const handlePreviewPrompt = async () => {
    if (!hasIntent || isPreviewLoading) return;
    setIsPreviewLoading(true);
    setPreviewError(null);
    const key = briefKey;
    try {
      const res = await apiFetch('/api/prompt-preview', {
        method: 'POST',
        token: await getAccessToken(),
        json: buildBriefPayload(previewSpace, roomDimensions),
      });
      const data = await readJson<{
        prompt?: string; negativePrompt?: string; promptEngine?: string; enhancerAvailable?: boolean;
        estimatedTokens?: number; maxTokens?: number; parameters?: PromptInsight['parameters']; vision?: VisionResponse;
      }>(res);
      if (!res.ok || typeof data.prompt !== 'string') {
        throw new Error(res.status === 401
          ? t('Autentifică-te pentru a previzualiza promptul.', 'Sign in to preview the prompt.')
          : (data.error ?? t('Previzualizarea a eșuat.', 'Preview failed.')));
      }
      setPromptInsight({
        key,
        source: 'preview',
        prompt: data.prompt,
        negativePrompt: data.negativePrompt ?? '',
        engine: data.promptEngine ?? 'deterministic',
        parameters: data.parameters,
        userSpecs: data.vision?.userSpecs ?? [],
        estimatedTokens: data.estimatedTokens,
        maxTokens: data.maxTokens,
        enhancerAvailable: data.enhancerAvailable,
      });
    } catch (err) {
      setPreviewError(err instanceof TypeError
        ? t('Conexiunea cu serverul a eșuat.', 'Could not reach the server.')
        : err instanceof Error ? err.message : 'Error');
    } finally {
      setIsPreviewLoading(false);
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
    // PLAN_LIMITS.starterMonthlyGenerations generări AI pe lună (vezi starterLimitMessage). „pro" / „agency" = nelimitat.
    const currentPlan = await resolvePlan();
    const isStarter = currentPlan.tier === 'starter';
    if (isStarter) {
      const usedNow = await getMonthlyUsage(currentPlan.email);
      if (usedNow >= PLAN_LIMITS.starterMonthlyGenerations) {
        await plan.refresh();
        setErrorMessage(starterLimitMessage(t));
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
    loadingTicker.start();

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
        json: { image: originalImage, ...buildBriefPayload(requestSpace, requestDims) },
      });
      const data = await readJson<{
        result?: unknown; isDemo?: boolean; warning?: string; vision?: VisionResponse;
        promptUsed?: string; negativePromptUsed?: string; promptEngine?: string; parameters?: PromptInsight['parameters'];
      }>(res);
      if (!res.ok) {
        const code = typeof data.code === 'string' ? data.code : '';
        if (code === 'LIMIT_REACHED') {
          setGateCode('LIMIT_REACHED');
          void plan.refresh();
          throw new Error(starterLimitMessage(t));
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
      if (typeof data.promptUsed === 'string') {
        setPromptInsight({
          key: JSON.stringify(buildBriefPayload(requestSpace, requestDims)),
          source: 'render',
          prompt: data.promptUsed,
          negativePrompt: data.negativePromptUsed ?? '',
          engine: data.promptEngine ?? 'deterministic',
          parameters: data.parameters,
          userSpecs: data.vision?.userSpecs ?? [],
        });
      }
      setIssueDate(new Date().toLocaleDateString(LOCALES[lang]));

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
      loadingTicker.stop();
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
        totalBudget: costEstimate.total, // estimarea de cost orientativă, stocată în € (afișată în lei)
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

  // Cota de generări afișată sub butonul principal
  const quotaLine = plan.isLoading
    ? null
    : plan.isPro
      ? t(`Generări nelimitate · ${plan.tier === 'agency' ? 'Business' : 'Professional'}`, `Unlimited generations · ${plan.tier === 'agency' ? 'Business' : 'Professional'}`)
      : t(
          `${Math.max(0, plan.limit - plan.used)} din ${plan.limit} generări gratuite rămase luna aceasta`,
          `${Math.max(0, plan.limit - plan.used)} of ${plan.limit} free generations left this month`,
        );
  const generateDisabled = !originalImage || !hasIntent || isLoading || isPhotoLoading || plan.limitReached || dimensionIssues.length > 0;
  const generateHint = !isLoading && (!originalImage || !hasIntent)
    ? !originalImage
      ? t('Încarcă o fotografie a camerei pentru a începe.', 'Upload a photo of the room to start.')
      : t('Descrie ce îți dorești, adaugă un material sau alege un stil.', 'Describe your vision, add a material or pick a style.')
    : null;
  const generateLabel = (
    isLoading
      ? <span className="flex items-center justify-center gap-2.5">
          <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
          {loadingSteps[loadingTicker.step]}
        </span>
      : <span className="flex items-center justify-center gap-2">
          <Sparkles className="w-4 h-4" aria-hidden />
          {generatedImage ? t('Generează din nou', 'Generate again') : t('Generează designul', 'Generate design')}
        </span>
  );

  return (
    <div className={`min-h-screen font-sans pb-36 lg:pb-24 transition-colors print:bg-white print:text-[#1B1416] print:pb-0 ${sk.page}`}>
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

        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 pt-6 sm:pt-8">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className={eyebrow}>Studio AI</p>
              <h1 className={`text-2xl sm:text-[28px] font-semibold tracking-tight mt-1.5 ${sk.strong}`}>
                {projectName.trim() || t('Proiect nou', 'New project')}
              </h1>
            </div>
            <p className={`text-[13px] ${sk.muted}`}>
              {modeLabel} · {spaceLabel} · {styleChoice === AUTO ? `${t('Stil auto', 'Auto style')}${inferStyleFromText(customPrompt) ? ` (${styleName})` : ''}` : styleName}
            </p>
          </div>

          <input
            ref={canvasFileRef}
            type="file"
            accept={ACCEPTED_PHOTO_TYPES.join(',')}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void handlePhotoFile(file);
            }}
          />

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px] gap-6 lg:gap-8 items-start">

            {/* ─── CANVAS + REZULTATE (stânga pe desktop, primul pe mobil) ───── */}
            <div className="min-w-0 space-y-6">
              <div>
                <StudioViewport
                  lang={lang}
                  isDark={isDark}
                  originalImage={originalImage}
                  generatedImage={generatedImage}
                  issueDate={issueDate}
                  isDemoResult={isDemoResult}
                  providerNote={providerNote}
                  isLoading={isLoading}
                  loadingLabel={loadingSteps[loadingTicker.step]}
                  loadingStep={loadingTicker.step}
                  loadingSteps={loadingSteps.length}
                  onFile={(file) => void handlePhotoFile(file)}
                  onPickFile={() => canvasFileRef.current?.click()}
                />
              </div>
            </div>

            {/* ─── PANOU DE CONTROL (dreapta pe desktop; lipit sub navigare, cu derulare proprie) ── */}
            <div className="min-w-0 space-y-4 lg:row-span-2 lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1 lg:pb-4 studio-scroll">
              <SourcePhotoCard
                lang={lang}
                isDark={isDark}
                originalImage={originalImage}
                isPhotoLoading={isPhotoLoading}
                isLoading={isLoading}
                aiStrength={roomDimensions.aiStrength}
                onFile={(file) => void handlePhotoFile(file)}
                onDemoPhoto={() => void handleDemoPhoto()}
                onStrengthChange={(e) => handleNumberChange('aiStrength', e)}
              />

              <RoomStylePicker
                lang={lang}
                isDark={isDark}
                mode={mode}
                spaceId={selectedSpace}
                spaceAuto={!spaceTouched}
                styleChoice={styleChoice}
                autoStyleName={styleChoice === AUTO && inferStyleFromText(customPrompt) ? styleName : null}
                onModeChange={handleModeChange}
                onSpaceChange={handleSpaceChange}
                onStyleChange={handleStyleSelect}
                disabled={isLoading}
              />

              {/* Dimensiuni spațiu: mereu vizibile (cererea AI + costul / lista de materiale folosesc aceleași cote) */}
              <RoomSizeCard
                lang={lang}
                isDark={isDark}
                roomDimensions={roomDimensions}
                presets={sizePresets}
                onPresetSelect={handleSizePreset}
                onNumberChange={handleNumberChange}
                issues={dimensionIssues}
                disabled={isLoading}
              />

              <VisionPanel
                lang={lang}
                isDark={isDark}
                customPrompt={customPrompt}
                onCustomPromptChange={setCustomPrompt}
                preserveStructure={preserveStructure}
                onPreserveStructureChange={setPreserveStructure}
                palette={palette}
                onPaletteChange={setPalette}
                lighting={lighting}
                onLightingChange={setLighting}
                disabled={isLoading}
              />

              {/* 04 · Generare */}
              <StudioCard isDark={isDark} step="04" title={t('Generează', 'Generate')}>
                {plan.limitReached && <PlanLimitNotice lang={lang} isDark={isDark} used={plan.used} limit={plan.limit} />}

                <div className="space-y-2.5">
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={generateDisabled}
                    aria-busy={isLoading}
                    className={`w-full h-12 rounded-lg text-[14px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer touch-manipulation ${sk.btn}`}
                  >
                    {generateLabel}
                  </button>
                  <div className={`flex items-center justify-between gap-3 text-[12px] ${sk.muted}`}>
                    <span>{quotaLine}</span>
                    <span className="tabular-nums">≈ {formatLei(costEstimate.total, { maximumFractionDigits: 0 })}</span>
                  </div>
                  {!plan.isLoading && !plan.isPro && plan.limit > 0 && (
                    <div className="flex gap-1" aria-hidden>
                      {Array.from({ length: plan.limit }).map((_, i) => (
                        <span key={i} className={`h-1 flex-1 rounded-full ${i < plan.used ? (isDark ? 'bg-[#C94A6A]/25' : 'bg-[#5C1628]/15') : (isDark ? 'bg-[#C94A6A]' : 'bg-[#5C1628]')}`} />
                      ))}
                    </div>
                  )}
                </div>

                {generateHint && <p className={`text-[12px] ${sk.muted}`}>{generateHint}</p>}
                {errorMessage && <p role="alert" className="text-xs text-red-500 font-mono">{errorMessage}</p>}
                {gateCode && (
                  <Link
                    href={gateCode === 'LIMIT_REACHED' ? '/#planuri' : '/login'}
                    className={`inline-flex items-center h-9 px-4 rounded-md touch-manipulation text-[13px] font-semibold ${sk.btn}`}
                  >
                    {gateCode === 'LIMIT_REACHED' ? t('Vezi planurile', 'View plans') : t('Autentifică-te', 'Sign in')}
                  </Link>
                )}
              </StudioCard>

              {/* Setări avansate (secundare): proiect, configurație, scenarii, cote, buget, parametri AI */}
              <section className={`border rounded-xl ${sk.card}`}>
                <button
                  type="button"
                  onClick={() => setIsProjectDetailsOpen((o) => !o)}
                  aria-expanded={isProjectDetailsOpen}
                  className={`w-full min-h-14 px-5 py-3 flex items-center justify-between gap-3 text-left rounded-xl cursor-pointer touch-manipulation transition-colors ${sk.rowHover}`}
                >
                  <span className="flex items-start gap-3 min-w-0">
                    <SlidersHorizontal className={`w-4 h-4 mt-0.5 shrink-0 ${sk.muted}`} aria-hidden />
                    <span className="min-w-0">
                      <span className={`block text-[14px] font-semibold ${sk.strong}`}>{t('Setări avansate', 'Advanced settings')}</span>
                      <span className={`block text-[12px] mt-0.5 truncate ${sk.muted}`}>
                        {t('Scenarii, goluri, buget, parametri AI', 'Scenarios, openings, budget, AI parameters')}
                      </span>
                    </span>
                  </span>
                  <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${isProjectDetailsOpen ? 'rotate-180' : ''}`} />
                </button>
                {isProjectDetailsOpen && (
                  <div className={`px-5 pb-5 pt-4 space-y-5 border-t ${sk.line}`}>
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
                      showSpacePicker={false}
                      framed={false}
                    />

                    <DimensionsPanel
                      lang={lang}
                      isDark={isDark}
                      roomDimensions={roomDimensions}
                      onNumberChange={handleNumberChange}
                      onBudgetChange={(budget) => setRoomDimensions((p) => ({ ...p, budget }))}
                      costTotal={costEstimate.total}
                      costMin={costEstimate.min}
                      costMax={costEstimate.max}
                    />

                    <ExpertAiSettings
                      lang={lang}
                      isDark={isDark}
                      settings={aiSettings}
                      onChange={setAiSettings}
                      insight={promptInsight}
                      stale={promptInsight !== null && promptInsight.key !== briefKey}
                      onPreview={() => void handlePreviewPrompt()}
                      previewLoading={isPreviewLoading}
                      previewError={previewError}
                      canPreview={hasIntent}
                    />
                  </div>
                )}
              </section>
            </div>

            {/* ─── REZULTATE & DEVIZ (sub canvas pe desktop, după controale pe mobil) ── */}
            <div className="min-w-0 space-y-6">
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

              {/* Link client: publică proiectul salvat în portalul de aprobare /p/[id] */}
              {shareProjectId && (
                <section className={`border rounded-xl ${sk.card}`}>
                  <div className={`px-5 h-11 flex items-center justify-between border-b ${sk.line}`}>
                    <span className={`text-[14px] font-semibold ${sk.strong}`}>{t('Prezentare client', 'Client presentation')}</span>
                    <span className={`font-mono text-[11px] tabular-nums ${sk.muted}`}>/p/{shareProjectId.slice(0, 8)}…</span>
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

        {/* Mobil: butonul principal rămâne la îndemână deasupra barei de navigare */}
        {originalImage && (
          <div className={`lg:hidden fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] md:bottom-0 z-40 border-t px-4 py-3 backdrop-blur-xl ${sk.header}`}>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generateDisabled}
              aria-busy={isLoading}
              className={`w-full h-11 rounded-lg text-[14px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer touch-manipulation ${sk.btn}`}
            >
              {generateLabel}
            </button>
            {quotaLine && <p className={`mt-1.5 text-center text-[11px] ${sk.muted}`}>{quotaLine}</p>}
          </div>
        )}
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
