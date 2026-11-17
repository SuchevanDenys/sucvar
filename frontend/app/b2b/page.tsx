// app/b2b/page.tsx — v4.2 Enterprise contractor workspace.
//   • Gate: unauthenticated / starter / pro → "Enterprise Restricted Module".
//     `agency` (profiles.subscription_tier) or an admin email → full dashboard.
//   • Access: useEnterpriseAccess() — 'agency' is a distinct tier; admins: profiles.role = 'admin' (GET /api/profile).
//   • Domain data + pure helpers live in app/lib/b2b/estimate.ts.
//   • Labor matrix (4 trades × regional hourly rates), crew scheduling, contingency + margin sliders.
//   • Itemised lines (templates from v3), CSV export, Factur-X (CII / EN 16931) XML export, print/PDF.
//   • Portofoliu: proiectele salvate ale contului → date client + deviz per proiect (lib/b2b/portfolio.ts),
//     cantități de material calculate din cotele proiectului, ofertă tipărită cu Înainte/După.
//   • Acces: DOAR 'agency' (sau admin cu sesiune reală) — poarta e UX; datele proiectelor sunt oricum
//     filtrate pe email-ul contului în `fetchProjectsFromDb` (și prin RLS în Supabase).
// SSR safety: no Date / Math.random during render (useClientDate for the print header).
"use client";

import { fetchProfile } from '@/app/lib/profile/client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileCode,
  FileSpreadsheet,
  FolderOpen,
  Plus,
  Printer,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import Navbar from '@/app/components/layout/Navbar';
import { useEnterpriseAccess } from '@/app/lib/plan/useEnterpriseAccess';
import { usePlan } from '@/app/lib/plan/usePlan';
import { SubscriptionBadge } from '@/app/components/ui/SubscriptionCard';
import { usePrefs } from '@/app/lib/theme/usePrefs';
import { useClientDate } from '@/app/lib/useStoredValue';
import {
  TRADES,
  REGIONS,
  FINISH_LEVELS,
  TEMPLATES,
  SECTION_PRESETS,
  activeItems,
  defaultItemsFor,
  defaultSections,
  insertSection,
  newSectionId,
  normalizeSections,
  removedDefaultSections,
  withSectionsFor,
  round2,
  lei,
  ronInput,
  eurFromRonInput,
  clampNum,
  uid,
  download,
  type TradeId,
  type RegionId,
  type Template,
  type LineItem,
  type InvoiceLine,
  type Category,
  type EstimateSection,
  DEFAULT_REGION,
  DEFAULT_VAT,
} from '@/app/lib/b2b/estimate';
import EnterpriseGate from '@/app/components/b2b/EnterpriseGate';
import PricingConsole from '@/app/components/b2b/PricingConsole';
import PrintDeviz, { type PrintProject } from '@/app/components/b2b/PrintDeviz';
import { buildCsv, buildFacturX } from '@/app/lib/b2b/exports';
import { fetchProjectsFromDb, saveProjectToDb } from '@/app/lib/supabase/projects';
import { SPACE_MODES, getSpace, getStyle, calculateEngineering } from '@/app/data/catalog';
import type { SavedProject } from '@/app/types';
import { EMPTY_CLIENT, loadSeller, loadWorkspace, projectArea, saveSeller, saveWorkspace, savedWorkspaceIds, seedMaterials, seedScope, type ClientMeta, hasSellerData } from '@/app/lib/b2b/portfolio';
import { fetchCompany, pushCompany } from '@/app/lib/b2b/company';
import { fetchCloudWorkspaces, mergeCloudIntoLocal, pushWorkspace, workspaceToPayload } from '@/app/lib/b2b/cloud';
import { getSkin, EYEBROW } from '@/app/lib/theme/skin';
import { LiveDot } from '@/app/components/ui/Editorial';
import ShareControl from '@/app/components/portal/ShareControl';
import ClientStatusBadge from '@/app/components/portal/ClientStatusBadge';
import { fetchSharing } from '@/app/lib/portal/client';
import type { ProjectSharing } from '@/app/lib/database.types';
import { tr } from '@/app/lib/i18n';
import { formatLei } from '@/app/lib/format';

// Șablonul de coloane al articolelor de deviz — comun antetului și rândurilor, ca titlurile să stea aliniate.
// Mobil (< sm): descrierea pe un rând, apoi U.M. · cantitate · preț · ștergere, apoi totalul.
const LINE_GRID = 'grid grid-cols-12 gap-2 px-5';
const COL = {
  desc: 'col-span-12 sm:col-span-5',
  unit: 'col-span-3 sm:col-span-1',
  qty: 'col-span-3 sm:col-span-2',
  price: 'col-span-4 sm:col-span-2',
  total: 'col-span-12 sm:col-span-1',
  del: 'col-span-2 sm:col-span-1 sm:order-last',
} as const;
const COL_HEAD = 'text-[11px] font-medium uppercase tracking-wider';

export default function B2BPage() {
  const { isDark, lang } = usePrefs();
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const eyebrow = `${EYEBROW} ${sk.dim}`;

  const access = useEnterpriseAccess();
  const subscription = usePlan(); // ciclu + zile rămase pentru badge-ul de abonament
  const email = access.email; // inclusiv profilurile demo (sesiune reală sau demo)

  // ── Portofoliu: proiecte salvate ale contului ───────────────────────────
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null); // emailul pentru care s-au încărcat proiectele
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());
  // Portal client (/p/[id]): link public + răspunsul clientului, per proiect. null = necunoscut (fără sesiune / eroare)
  const [sharing, setSharingMap] = useState<Record<string, ProjectSharing> | null>(null);

  // ── Workspace state ─────────────────────────────────────────────────────
  const [projectName, setProjectName] = useState('');
  const [area, setArea] = useState(68.4);
  const [region, setRegion] = useState<RegionId>(DEFAULT_REGION);
  const [level, setLevel] = useState('standard');
  const [crew, setCrew] = useState(3);
  const [rateOverride, setRateOverride] = useState<Partial<Record<TradeId, number>>>({});
  const [scope, setScope] = useState<Partial<Record<TradeId, number>>>({});
  const [contingency, setContingency] = useState(5);
  const [margin, setMargin] = useState(15);
  const [vat, setVat] = useState(DEFAULT_VAT);
  const [items, setItems] = useState<LineItem[]>([]);
  // Secțiunile devizului (ordinea cardurilor); implicitele eliminate pot fi restaurate, cele noi sunt personalizate
  const [sections, setSections] = useState<EstimateSection[]>(defaultSections);
  const [laborOff, setLaborOff] = useState(false); // secțiunea „Manoperă" eliminată din deviz
  const [newSectionOpen, setNewSectionOpen] = useState(false);
  const [newSectionDraft, setNewSectionDraft] = useState('');
  // Liniile unei secțiuni implicite eliminate în sesiunea curentă: restaurarea le readuce (altfel: liniile implicite)
  const removedStash = useRef<Record<string, LineItem[]>>({});
  const [seller, setSeller] = useState(loadSeller);
  const [client, setClient] = useState<ClientMeta>(EMPTY_CLIENT);
  const [invoiceNo, setInvoiceNo] = useState('');
  // Starea sincronizării cu cloud-ul: idle (nimic de arătat) · saving · synced · offline · error
  const [cloudState, setCloudState] = useState<'idle' | 'saving' | 'synced' | 'offline' | 'error'>('idle');
  const printDate = useClientDate(); // client-only date for the printed header

  // Încarcă proiectele DOAR după ce accesul enterprise este confirmat.
  const canLoad = access.isEnterprise && !!email;
  const projectsLoading = canLoad && loadedFor !== email;
  useEffect(() => {
    if (!canLoad || !email) return;
    let alive = true;
    // Proiectele și devizele din cloud se încarcă în paralel; devizele cloud mai noi se oglindesc
    // în localStorage ÎNAINTE de `savedWorkspaceIds`, deci `selectProject` le găsește local.
    // Dacă cloud-ul e indisponibil (offline / neautentificat), rămâne varianta locală.
    Promise.all([fetchProjectsFromDb(email), fetchCloudWorkspaces(), fetchSharing()])
      .then(([list, cloud, share]) => {
        if (!alive) return;
        setSharingMap(share.ok ? share.data : null);
        if (cloud.status === 'ok') {
          mergeCloudIntoLocal(cloud.data);
          setCloudState('synced');
        } else if (cloud.status === 'offline' || cloud.status === 'error') {
          setCloudState(cloud.status);
        }
        setProjects(list);
        setSavedIds(savedWorkspaceIds());
      })
      .catch(() => undefined)
      .finally(() => alive && setLoadedFor(email));
    return () => {
      alive = false;
    };
  }, [canLoad, email]);

  // Datele firmei (furnizor): cloud = sursa de adevăr (company_profiles), localStorage = cache.
  // La încărcare: profilul din cloud câștigă; dacă nu există încă, datele locale vechi sunt urcate o dată.
  const [sellerError, setSellerError] = useState<string | null>(null);
  const sellerFromCloud = useRef(false); // nu retrimitem în cloud exact ce tocmai am primit din cloud
  useEffect(() => {
    if (!canLoad) return;
    let alive = true;
    fetchCompany().then((r) => {
      if (!alive || r.status !== 'ok') return;
      if (r.data) {
        sellerFromCloud.current = true;
        setSeller(r.data);
      } else if (hasSellerData(loadSeller())) {
        void pushCompany(loadSeller());
      }
    });
    return () => {
      alive = false;
    };
  }, [canLoad]);

  // TVA implicită din profil (/account: 21 % sau 11 %) pentru devizele noi; un deviz salvat își păstrează cota.
  const vatFromProfile = useRef(false);
  useEffect(() => {
    if (!canLoad || vatFromProfile.current) return;
    let alive = true;
    fetchProfile().then((r) => {
      if (!alive || r.status !== 'ok') return;
      vatFromProfile.current = true;
      const rate = r.data.defaults?.vatRate;
      if (Number.isFinite(rate)) setVat((current) => (current === DEFAULT_VAT ? rate : current));
    });
    return () => {
      alive = false;
    };
  }, [canLoad]);

  useEffect(() => {
    saveSeller(seller);
    if (!canLoad) return;
    if (sellerFromCloud.current) {
      sellerFromCloud.current = false;
      return;
    }
    const timer = setTimeout(() => {
      pushCompany(seller).then((r) => setSellerError(r.status === 'invalid' ? r.message ?? 'Date invalide.' : null));
    }, 1200);
    return () => clearTimeout(timer);
  }, [seller, canLoad]);

  // Salvare automată a devizului pentru proiectul selectat (client + parametri + linii).
  // Local: imediat (cache offline). Cloud: cu întârziere de 1,5 s (debounce), ca să nu trimitem
  // câte un PUT la fiecare tastă; `net`/`gross` sunt calculate mai jos, din aceeași stare.
  const cloudSeq = useRef(0); // ignoră răspunsurile unui PUT depășit de o modificare mai nouă
  const totalsRef = useRef({ net: 0, gross: 0 });
  useEffect(() => {
    if (!selectedId) return;
    const ws = {
      client, docNo: invoiceNo, area, region, level, crew, rateOverride, scope,
      contingency, margin, vat, items, sections, laborOff, updatedAt: new Date().toISOString(),
    };
    saveWorkspace(selectedId, ws);
    if (!canLoad) return;
    const seq = ++cloudSeq.current;
    const timer = setTimeout(() => {
      setCloudState('saving');
      pushWorkspace(workspaceToPayload(selectedId, ws, totalsRef.current.net, totalsRef.current.gross)).then((r) => {
        if (seq !== cloudSeq.current) return;
        setCloudState(r.status === 'ok' ? 'synced' : r.status === 'local' ? 'idle' : r.status);
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [canLoad, selectedId, client, invoiceNo, area, region, level, crew, rateOverride, scope, contingency, margin, vat, items, sections, laborOff]);

  // ── Calculations ────────────────────────────────────────────────────────
  const regionData = REGIONS.find((r) => r.id === region) ?? REGIONS[0];
  const levelK = FINISH_LEVELS.find((l) => l.id === level)?.k ?? 1;

  const labor = useMemo(() => {
    return TRADES.map((tr) => {
      const m2 = scope[tr.id] ?? area;
      const hours = m2 * tr.hoursPerM2 * levelK;
      const rate = rateOverride[tr.id] ?? regionData.rates[tr.id];
      return { ...tr, m2, hours, rate, cost: hours * rate };
    });
  }, [area, scope, levelK, rateOverride, regionData]);

  // O secțiune eliminată nu mai contează nicăieri: Manopera → 0, liniile fără secțiune activă → excluse.
  const laborTotal = laborOff ? 0 : labor.reduce((s, l) => s + l.cost, 0);
  const laborHours = laborOff ? 0 : labor.reduce((s, l) => s + l.hours, 0);
  const lines = useMemo(() => activeItems(items, sections), [items, sections]);
  const itemsTotal = lines.reduce((s, i) => s + i.qty * i.price, 0);
  const totalByCat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of lines) m[i.cat] = (m[i.cat] ?? 0) + i.qty * i.price;
    return m;
  }, [lines]);
  const removedDefaults = removedDefaultSections(sections);

  const base = laborTotal + itemsTotal;
  const contingencyAmt = base * (contingency / 100);
  const subtotal = base + contingencyAmt;
  const marginAmt = subtotal * (margin / 100);
  const net = subtotal + marginAmt;
  const vatAmt = net * (vat / 100);
  const gross = net + vatAmt;
  const uplift = base > 0 ? net / base : 1;
  // Totalurile curente pentru PUT-ul din cloud (actualizate după randare, citite de efectul de salvare)
  useEffect(() => {
    totalsRef.current = { net: round2(net), gross: round2(gross) };
  }, [net, gross]);
  const workDays = crew > 0 ? Math.ceil(laborHours / (crew * 8)) : 0;

  const selectedProject = projects.find((p) => p.id === selectedId) ?? null;
  const printProject: PrintProject | null = selectedProject && {
    title: selectedProject.title,
    modeLabel: t(SPACE_MODES[selectedProject.mode].labelRo, SPACE_MODES[selectedProject.mode].labelEn),
    spaceLabel: (() => { const sp = getSpace(selectedProject.mode, selectedProject.spaceType); return t(sp.labelRo, sp.labelEn); })(),
    styleName: (() => { const st = getStyle(selectedProject.styleId); return t(st.nameRo, st.nameEn); })(),
    dims: `${selectedProject.dimensions.width} × ${selectedProject.dimensions.length} × ${selectedProject.dimensions.height} m`,
    createdAt: selectedProject.createdAt,
    originalImage: selectedProject.originalImage,
    generatedImage: selectedProject.generatedImage,
  };

  // ── Invoice lines (contingency + margin spread pro-rata over every line) ──
  // Grupate pe secțiuni, în ordinea editorului; secțiunile eliminate sau fără linii nu apar.
  const buildInvoiceLines = (): InvoiceLine[] => {
    const out: InvoiceLine[] = [];
    const laborLabel = tr(lang, 'Manoperă', 'Labour');
    if (!laborOff) {
      for (const l of labor) {
        if (l.cost <= 0 || l.hours <= 0) continue;
        const total = round2(l.cost * uplift);
        out.push({ name: `${laborLabel} – ${tr(lang, l.ro, l.en)}`, unit: 'h', qty: round2(l.hours), unitPrice: round2(total / l.hours), total, section: laborLabel });
      }
    }
    for (const sec of sections) {
      const section = tr(lang, sec.ro, sec.en);
      for (const i of lines) {
        if (i.cat !== sec.id) continue;
        const cost = i.qty * i.price;
        if (cost <= 0 || i.qty <= 0) continue;
        const total = round2(cost * uplift);
        out.push({ name: (tr(lang, i.ro, i.en)) || (tr(lang, 'Articol', 'Item')), unit: i.unit, qty: i.qty, unitPrice: round2(total / i.qty), total, section });
      }
    }
    return out;
  };

  // ── Handlers ────────────────────────────────────────────────────────────
  const blankLine = (cat: string): LineItem => ({ id: uid(), cat, ro: '', en: '', unit: 'buc.', qty: 1, price: 0 });
  const addFromTemplate = (tpl: Template) => {
    const line: LineItem = { id: uid(), cat: tpl.cat, ro: tpl.ro, en: tpl.en, unit: tpl.unit, qty: tpl.qty, price: 0 };
    setSections((p) => withSectionsFor(p, [line])); // șablon dintr-o secțiune eliminată → secțiunea revine
    setItems((p) => [...p, line]);
  };
  const addBlank = (cat: string) => setItems((p) => [...p, blankLine(cat)]);

  // ── Secțiuni ────────────────────────────────────────────────────────────
  const removeSection = (sec: EstimateSection) => {
    const rows = items.filter((i) => i.cat === sec.id);
    // O secțiune personalizată nu are bară de restaurare: confirmăm doar dacă are conținut real.
    if (sec.custom && rows.some((i) => i.ro.trim() || i.en.trim() || i.price > 0)
      && !window.confirm(t(`Elimini secțiunea „${sec.ro || sec.en}" și liniile ei?`, `Remove the “${sec.en || sec.ro}” section and its lines?`, `Supprimer la section « ${sec.en || sec.ro} » et ses lignes ?`))) return;
    if (!sec.custom && rows.length > 0) removedStash.current[sec.id] = rows;
    setSections((p) => p.filter((s) => s.id !== sec.id));
    setItems((p) => p.filter((i) => i.cat !== sec.id));
  };
  const restoreSection = (cat: Category) => {
    const stashed = removedStash.current[cat.id];
    delete removedStash.current[cat.id];
    setSections((p) => insertSection(p, { id: cat.id, ro: cat.ro, en: cat.en }));
    setItems((p) => [...p.filter((i) => i.cat !== cat.id), ...(stashed?.length ? stashed : defaultItemsFor(cat.id))]);
  };
  const renameSection = (id: string, title: string) =>
    setSections((p) => p.map((s) => (s.id === id ? { ...s, ro: title, en: title } : s)));
  const closeNewSection = () => { setNewSectionOpen(false); setNewSectionDraft(''); };
  const createSection = (title: string, preset?: { ro: string; en: string }) => {
    const name = title.trim();
    if (!name) return;
    const id = newSectionId();
    setSections((p) => [...p, { id, ro: preset?.ro ?? name, en: preset?.en ?? name, custom: true }]);
    setItems((p) => [...p, blankLine(id)]); // pornește cu o linie gata de completat
    closeNewSection();
  };
  const sectionTitles = new Set(sections.flatMap((s) => [s.ro, s.en]).map((x) => x.trim().toLowerCase()));
  const presets = SECTION_PRESETS.filter((p) => !sectionTitles.has(p.ro.toLowerCase()) && !sectionTitles.has(p.en.toLowerCase()));
  const updateItem = (id: string, patch: Partial<LineItem>) =>
    setItems((p) => p.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const removeItem = (id: string) => setItems((p) => p.filter((i) => i.id !== id));
  const resetAll = () => {
    setItems([]); setSections(defaultSections()); setLaborOff(false); removedStash.current = {}; closeNewSection();
    setProjectName(''); setRateOverride({}); setScope({});
    setContingency(5); setMargin(15); setArea(68.4); setCrew(3);
    setClient(EMPTY_CLIENT); setInvoiceNo(''); setSelectedId(null);
  };

  // Alege un proiect din portofoliu: reia devizul salvat sau îl pornește din cotele proiectului.
  const selectProject = (p: SavedProject) => {
    const ws = loadWorkspace(p.id);
    removedStash.current = {};
    setSelectedId(p.id);
    setProjectName(p.title);
    if (ws) {
      setClient({ ...EMPTY_CLIENT, ...ws.client }); setInvoiceNo(ws.docNo); setArea(ws.area);
      setRegion(ws.region); setLevel(ws.level); setCrew(ws.crew); setRateOverride(ws.rateOverride);
      setScope(ws.scope); setContingency(ws.contingency); setMargin(ws.margin); setVat(ws.vat); setItems(ws.items);
      setSections(normalizeSections(ws.sections, ws.items)); setLaborOff(!!ws.laborOff);
    } else {
      const seed = seedMaterials(p);
      setClient(EMPTY_CLIENT); setInvoiceNo(''); setArea(+projectArea(p).toFixed(1) || 1);
      setRateOverride({}); setScope(seedScope(p)); setItems(seed);
      setSections(withSectionsFor(defaultSections(), seed)); setLaborOff(false);
    }
    setSavedIds((prev) => new Set(prev).add(p.id));
  };

  // Recalculează materialele din cotele proiectului (suprascrie liniile curente).
  const reseedFromProject = () => {
    if (!selectedProject) return;
    setArea(+projectArea(selectedProject).toFixed(1) || 1);
    setScope(seedScope(selectedProject));
    const seed = seedMaterials(selectedProject);
    removedStash.current = {};
    setItems(seed);
    setSections((p) => withSectionsFor(p, seed)); // materialele recalculate își readuc secțiunile
  };

  const exportCsv = () => {
    const name = `sucvar-deviz-${(projectName || 'project').replace(/\s+/g, '-').toLowerCase()}.csv`;
    download(name, buildCsv({ lines: buildInvoiceLines(), net, vat, vatAmt, gross }), 'text/csv', true);
  };

  const exportFacturX = () => {
    const xml = buildFacturX({ lines: buildInvoiceLines(), vat, invoiceNo, seller, buyer: client });
    download(`factur-x-${(invoiceNo || 'draft').replace(/\s+/g, '-')}.xml`, xml, 'application/xml');
  };

  // ── Shared classes ──────────────────────────────────────────────────────
  const field = `h-9 px-2.5 rounded-sm border text-sm w-full transition-colors ${sk.input}`;
  const numField = `${field} font-mono tabular-nums text-right`;
  const panel = `relative border rounded-md ${sk.card}`;
  const panelHead = `flex items-center justify-between px-5 h-9 border-b ${sk.line} ${eyebrow}`;
  const lbl = (s: string) => <span className={`block mb-1 ${eyebrow}`}>{s}</span>;
  // „Elimină secțiunea": discret, cu hover bordeaux; pastilele de restaurare din bara de jos
  const removeBtn = `inline-flex items-center gap-1 h-7 px-2 rounded-sm font-sans text-[11px] normal-case tracking-normal cursor-pointer touch-manipulation transition-colors ${sk.dim} ${isDark ? 'hover:text-[#D65D7B] hover:bg-[#C94A6A]/10' : 'hover:text-[#5C1628] hover:bg-[#5C1628]/[0.06]'}`;
  const restorePill = `inline-flex items-center gap-1 h-7 px-3 rounded-full border text-xs font-medium cursor-pointer touch-manipulation transition-colors ${sk.chipOn} ${isDark ? 'hover:bg-[#C94A6A]/20' : 'hover:bg-[#5C1628]/[0.09]'}`;

  // ═══════════════════════════════════════════════════════════════════════
  // Loading
  // ═══════════════════════════════════════════════════════════════════════
  if (access.isChecking) {
    return (
      <div className={`min-h-screen font-sans pb-28 ${sk.page}`}>
        <Navbar />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-16">
          <div className={`h-80 border rounded-md animate-pulse ${sk.card}`} aria-busy="true" />
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Gate: Enterprise Restricted Module
  // ═══════════════════════════════════════════════════════════════════════
  if (!access.isEnterprise) {
    return <EnterpriseGate isSignedIn={access.isSignedIn} planId={access.planId} />;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Enterprise dashboard
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className={`min-h-screen font-sans pb-28 transition-colors print:bg-white print:text-[#1B1416] print:pb-0 ${sk.page}`}>
      <Navbar />

      <div className="print:hidden max-w-7xl mx-auto px-4 sm:px-6 pt-10 space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div className="space-y-3">
            <LiveDot label={t('Enterprise activ', 'Enterprise active')} className={sk.accent} />
            <h1 className={`text-3xl sm:text-[2.4rem] font-semibold leading-[1.08] tracking-tight ${sk.strong}`}>
              {t('Spațiu de lucru pentru antreprenori', 'Contractor workspace')}
            </h1>
            {email && <p className={`font-mono text-xs ${sk.dim}`}>{email}</p>}
            {cloudState !== 'idle' && (
              <p className={`font-mono text-[11px] ${sk.dim}`} role="status" aria-live="polite">
                {cloudState === 'saving' && t('Se salvează…', 'Saving…')}
                {cloudState === 'synced' && t('Salvat în cloud', 'Synced to cloud')}
                {cloudState === 'offline' && t('Offline — salvat local', 'Offline — saved locally')}
                {cloudState === 'error' && t('Sincronizare eșuată — salvat local', 'Sync failed — saved locally')}
              </p>
            )}
            <SubscriptionBadge plan={subscription} lang={lang} className={sk.dim} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={exportCsv} className={`inline-flex items-center gap-2 h-10 px-4 rounded-sm ${EYEBROW} cursor-pointer touch-manipulation transition-colors ${sk.btnGhost}`}>
              <FileSpreadsheet className="w-3.5 h-3.5" /> CSV
            </button>
            <button type="button" onClick={exportFacturX} className={`inline-flex items-center gap-2 h-10 px-4 rounded-sm ${EYEBROW} font-semibold cursor-pointer touch-manipulation transition-colors ${sk.btn}`}>
              <FileCode className="w-3.5 h-3.5" /> Factur-X
            </button>
            <button type="button" onClick={() => window.print()} className={`inline-flex items-center gap-2 h-10 px-4 rounded-sm ${EYEBROW} cursor-pointer touch-manipulation transition-colors ${sk.btnGhost}`}>
              <Printer className="w-3.5 h-3.5" /> PDF
            </button>
            <button type="button" onClick={resetAll} aria-label={t('Resetează', 'Reset')} className={`inline-flex items-center justify-center h-10 w-10 rounded-sm cursor-pointer touch-manipulation transition-colors ${sk.btnGhost}`}>
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* ── LEFT: inputs ─────────────────────────────────────────────── */}
          <div className="lg:col-span-8 space-y-6">
            {/* Portfolio: proiecte salvate */}
            <section className={panel}>
              <div className={panelHead}>
                <span>{t('Portofoliu de proiecte', 'Project portfolio')}</span>
                <span>{String(projects.length).padStart(2, '0')}</span>
              </div>
              {projectsLoading ? (
                <div className={`m-5 h-24 border rounded-md animate-pulse ${sk.card}`} aria-busy="true" />
              ) : projects.length === 0 ? (
                <p className={`p-8 text-center text-sm ${sk.dim}`}>
                  {t('Nu ai proiecte salvate. Generează și salvează un design în Studio, apoi alege-l aici.', 'No saved projects. Generate and save a design in the Studio, then pick it here.')}
                </p>
              ) : (
                <ul className="p-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 max-h-[26rem] overflow-y-auto">
                  {projects.map((p) => {
                    const active = p.id === selectedId;
                    const sp = getSpace(p.mode, p.spaceType);
                    return (
                      <li key={p.id}>
                        <button type="button" onClick={() => selectProject(p)} aria-pressed={active} className={`w-full text-left border rounded-md overflow-hidden cursor-pointer touch-manipulation transition-colors ${active ? `${sk.accent} border-current` : sk.line} ${sk.rowHover}`}>
                          <div className={`relative h-24 w-full overflow-hidden flex items-center justify-center ${sk.cell}`}>
                            {p.generatedImage ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.generatedImage} alt="" loading="lazy" className="w-full h-full object-contain" />
                            ) : (
                              <FolderOpen className={`w-5 h-5 ${sk.dim}`} />
                            )}
                          </div>
                          <div className={`p-3 space-y-1 ${isDark ? 'bg-[#1A1416]' : 'bg-white'}`}>
                            <p className={`text-sm font-semibold line-clamp-1 truncate ${isDark ? 'text-white' : 'text-[#1B1416]'}`}>{p.title}</p>
                            <p className={`font-mono text-[11px] ${sk.dim}`}>
                              {t(sp.labelRo, sp.labelEn)} · {calculateEngineering(p.dimensions, p.mode, p.spaceType).floorArea} m² · {p.createdAt.slice(0, 10)}
                            </p>
                            {savedIds.has(p.id) && <p className={`${eyebrow} ${sk.accent}`}>{t('deviz salvat', 'estimate saved')}</p>}
                            {(() => {
                              const s = sharing?.[p.id];
                              return s && (s.isPublic || s.clientReviewedAt) ? (
                                <ClientStatusBadge status={s.clientStatus} isDark={isDark} lang={lang} className="mt-1" />
                              ) : null;
                            })()}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {selectedProject && (
                <div className={`flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-t ${sk.line}`}>
                  <p className={`text-xs ${sk.muted}`}>{t('Deviz activ:', 'Active estimate:')} <span className={sk.strong}>{selectedProject.title}</span> · {t('se salvează automat', 'autosaved')}</p>
                  <button type="button" onClick={reseedFromProject} className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-sm text-xs cursor-pointer touch-manipulation ${sk.btnGhost}`}>
                    <RotateCcw className="w-3 h-3" /> {t('Recalculează materialele din proiect', 'Recompute materials from project')}
                  </button>
                </div>
              )}
              {selectedProject && (
                <div className={`px-5 py-4 border-t ${sk.line}`}>
                  <p className={`mb-2 ${eyebrow}`}>{t('Prezentare client · aprobare', 'Client presentation · approval')}</p>
                  <ShareControl
                    key={selectedProject.id}
                    projectId={selectedProject.id}
                    isDark={isDark}
                    lang={lang}
                    initial={sharing ? (sharing[selectedProject.id] ?? null) : undefined}
                    // Harta de partajare conține TOATE proiectele din cloud ale contului: lipsa = proiect doar local
                    inCloud={sharing ? Boolean(sharing[selectedProject.id]) : undefined}
                    onSaveToCloud={async () => (await saveProjectToDb(selectedProject)).savedToCloud}
                    onChange={(s) => setSharingMap((prev) => ({ ...(prev ?? {}), [s.projectId]: s }))}
                    showStatus
                  />
                </div>
              )}
            </section>

            {/* Project parameters */}
            <section className={panel}>
              <div className={panelHead}><span>{t('Parametrii proiectului', 'Project parameters')}</span></div>
              <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
                <label className="col-span-2">
                  {lbl(t('Proiect', 'Project'))}
                  <input type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder={t('ex: Vila Floreasca – etaj 1', 'e.g. Floreasca Villa – floor 1')} className={field} />
                </label>
                <label>
                  {lbl(t('Suprafață (m²)', 'Area (m²)'))}
                  <input type="number" inputMode="decimal" min={0} step="0.1" value={area} onChange={(e) => setArea(clampNum(e.target.value))} className={numField} />
                </label>
                <label>
                  {lbl(t('Echipă (persoane)', 'Crew (people)'))}
                  <input type="number" inputMode="numeric" min={1} max={50} value={crew} onChange={(e) => setCrew(clampNum(e.target.value, 1, 50))} className={numField} />
                </label>
                <label className="col-span-2">
                  {lbl(t('Regiune (tarife orare)', 'Region (hourly rates)'))}
                  <select value={region} onChange={(e) => { setRegion(e.target.value as RegionId); setRateOverride({}); }} className={field}>
                    {REGIONS.map((r) => <option key={r.id} value={r.id} className={sk.option}>{t(r.ro, r.en, r.fr)}</option>)}
                  </select>
                </label>
                <label className="col-span-2">
                  {lbl(t('Nivel finisaje', 'Finish level'))}
                  <select value={level} onChange={(e) => setLevel(e.target.value)} className={field}>
                    {FINISH_LEVELS.map((l) => <option key={l.id} value={l.id} className={sk.option}>{t(l.ro, l.en)} (×{l.k})</option>)}
                  </select>
                </label>
              </div>
            </section>

            {/* Labor matrix — secțiunea „Manoperă", eliminabilă (restaurare din bara de sub articole) */}
            {!laborOff && (
            <section className={panel}>
              <div className={panelHead}>
                <span>{t('Tarife de manoperă', 'Labour rates')}</span>
                <span className="flex items-center gap-2">
                  <span className="hidden sm:inline">{t('tarife editabile', 'editable rates')}</span>
                  <button type="button" onClick={() => setLaborOff(true)} aria-label={t('Elimină secțiunea Manoperă', 'Remove the Labour section', 'Supprimer la section Main-d’œuvre')} className={removeBtn}>
                    <X className="w-3 h-3" /> <span className="hidden sm:inline">{t('Elimină secțiunea', 'Remove section', 'Supprimer la section')}</span>
                  </button>
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className={`text-left border-b ${sk.line} ${eyebrow}`}>
                      <th className="px-5 py-2.5 font-normal">{t('Meserie', 'Trade')}</th>
                      <th className="px-2 py-2.5 font-normal text-right">{t('Arie m²', 'Scope m²')}</th>
                      <th className="px-2 py-2.5 font-normal text-right">h/m²</th>
                      <th className="px-2 py-2.5 font-normal text-right">{t('Ore', 'Hours')}</th>
                      <th className="px-2 py-2.5 font-normal text-right">lei/h</th>
                      <th className="px-5 py-2.5 font-normal text-right">{t('Cost', 'Cost')}</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${sk.divide}`}>
                    {labor.map((l) => (
                      <tr key={l.id}>
                        <td className={`px-5 py-2.5 ${sk.strong}`}>{t(l.ro, l.en)}</td>
                        <td className="px-2 py-2.5 w-28">
                          <input type="number" min={0} step="0.1" value={scope[l.id] ?? area} onChange={(e) => setScope((p) => ({ ...p, [l.id]: clampNum(e.target.value) }))} className={numField} aria-label={`${l.en} scope`} />
                        </td>
                        <td className={`px-2 py-2.5 text-right font-mono tabular-nums ${sk.dim}`}>{(l.hoursPerM2 * levelK).toFixed(2)}</td>
                        <td className={`px-2 py-2.5 text-right font-mono tabular-nums ${sk.muted}`}>{l.hours.toFixed(1)}</td>
                        <td className="px-2 py-2.5 w-24">
                          <input type="number" min={0} step="0.5" value={ronInput(l.rate)} onChange={(e) => setRateOverride((p) => ({ ...p, [l.id]: eurFromRonInput(e.target.value) }))} className={numField} aria-label={`${l.en} rate`} />
                        </td>
                        <td className={`px-5 py-2.5 text-right font-mono tabular-nums ${sk.strong}`}>{lei(l.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className={`border-t ${sk.line}`}>
                      <td className={`px-5 py-3 ${eyebrow}`} colSpan={3}>{t('Total manoperă', 'Labor total')}</td>
                      <td className={`px-2 py-3 text-right font-mono tabular-nums ${sk.muted}`}>{laborHours.toFixed(1)}</td>
                      <td />
                      <td className={`px-5 py-3 text-right font-mono tabular-nums font-medium ${sk.strong}`}>{lei(laborTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className={`px-5 py-3 border-t text-[11px] leading-snug ${sk.line} ${sk.dim}`}>
                {t(
                  'Normele de timp (h/m²) și tarifele regionale sunt valori implicite orientative; înlocuiește-le cu cele din lista ta de prețuri.',
                  'Time norms (h/m²) and regional rates are indicative defaults; replace them with your own price book.',
                )}
              </p>
            </section>
            )}

            {/* Itemised lines */}
            <section className={panel}>
              <div className={panelHead}>
                <span>{t('Articole de deviz', 'Estimate lines')}</span>
                <span>{String(lines.length).padStart(2, '0')}</span>
              </div>
              <div className={`p-5 border-b space-y-4 ${sk.line}`}>
                <p className={eyebrow}>{t('Adaugă din șablon', 'Add from template')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {TEMPLATES.map((tpl) => (
                    <button key={tpl.en} type="button" onClick={() => addFromTemplate(tpl)} className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-sm text-xs cursor-pointer touch-manipulation transition-colors ${sk.btnGhost}`}>
                      <Plus className="w-3 h-3" /> {t(tpl.ro, tpl.en)}
                    </button>
                  ))}
                </div>
              </div>

              {sections.length === 0 ? (
                <p className={`p-10 text-center text-sm ${sk.dim}`}>
                  {t('Nicio secțiune în deviz. Adaugă o secțiune nouă sau restaurează una implicită.', 'No sections in the estimate. Add a new section or restore a default one.', 'Aucune section dans le devis. Ajoutez une nouvelle section ou restaurez-en une par défaut.')}
                </p>
              ) : (
                sections.map((sec) => {
                  const rows = lines.filter((i) => i.cat === sec.id);
                  const title = tr(lang, sec.ro, sec.en);
                  return (
                    <div key={sec.id} className={`border-b ${sk.line}`}>
                      <div className={`flex items-center justify-between gap-3 px-5 min-h-9 py-1.5 ${eyebrow} ${sk.strong}`}>
                        {sec.custom ? (
                          <input
                            type="text"
                            value={title}
                            onChange={(e) => renameSection(sec.id, e.target.value)}
                            placeholder={t('Titlul secțiunii…', 'Section title…', 'Titre de la section…')}
                            aria-label={t('Titlul secțiunii', 'Section title', 'Titre de la section')}
                            className={`min-w-0 flex-1 h-7 -ml-1.5 px-1.5 rounded-sm border border-transparent bg-transparent uppercase tracking-[0.22em] font-mono text-[10px] transition-colors hover:border-current/20 focus:outline-none ${isDark ? 'focus:border-[#C94A6A]' : 'focus:border-[#5C1628]'} ${sk.strong}`}
                          />
                        ) : (
                          <span className="min-w-0 truncate">{title}</span>
                        )}
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="font-mono normal-case tracking-normal tabular-nums">{lei(totalByCat[sec.id] ?? 0)}</span>
                          <button type="button" onClick={() => removeSection(sec)} aria-label={`${t('Elimină secțiunea', 'Remove section', 'Supprimer la section')} ${title}`} className={removeBtn}>
                            <Trash2 className="w-3 h-3" /> <span className="hidden sm:inline">{t('Elimină secțiunea', 'Remove section', 'Supprimer la section')}</span>
                          </button>
                        </span>
                      </div>
                      {rows.length > 0 && (
                        <>
                          {/* Antet coloane: același șablon de grid ca rândurile, ca fiecare titlu să stea exact deasupra câmpului său. */}
                          <div aria-hidden className={`hidden sm:grid ${LINE_GRID} pb-1.5 ${COL_HEAD} ${sk.muted}`}>
                            <span className={COL.desc}>{t('Articol / Descriere', 'Item / Description')}</span>
                            <span className={COL.unit}>{t('U.M.', 'Unit')}</span>
                            <span className={`${COL.qty} text-right`}>{t('Cantitate', 'Quantity')}</span>
                            <span className={`${COL.price} text-right`}>{t('Preț unitar (lei)', 'Unit price (lei)')}</span>
                            <span className={`${COL.total} text-right`}>{t('Total', 'Total')}</span>
                            <span className={COL.del} />
                          </div>
                          <div className={`divide-y ${sk.divide}`}>
                            {rows.map((i) => (
                              <div key={i.id} className={`${LINE_GRID} py-2.5 items-end sm:items-center`}>
                                <input type="text" value={tr(lang, i.ro, i.en)} onChange={(e) => updateItem(i.id, tr(lang, { ro: e.target.value }, { en: e.target.value }))} placeholder={t('Descriere…', 'Description…')} aria-label={t('Articol / Descriere', 'Item / Description')} className={`${field} ${COL.desc}`} />
                                <label className={`${COL.unit} block`}>
                                  <span className={`sm:hidden block mb-1 ${COL_HEAD} ${sk.muted}`}>{t('U.M.', 'Unit')}</span>
                                  <input type="text" value={i.unit} onChange={(e) => updateItem(i.id, { unit: e.target.value })} className={field} aria-label={t('U.M.', 'Unit')} />
                                </label>
                                <label className={`${COL.qty} block`}>
                                  <span className={`sm:hidden block mb-1 text-right ${COL_HEAD} ${sk.muted}`}>{t('Cantitate', 'Quantity')}</span>
                                  <input type="number" min={0} step="0.5" value={i.qty} onChange={(e) => updateItem(i.id, { qty: clampNum(e.target.value) })} className={numField} aria-label={t('Cantitate', 'Quantity')} />
                                </label>
                                <label className={`${COL.price} block`}>
                                  <span className={`sm:hidden block mb-1 text-right ${COL_HEAD} ${sk.muted}`}>{t('Preț / U.M.', 'Price / unit')}</span>
                                  <input type="number" min={0} step="0.5" value={i.price === 0 ? '' : ronInput(i.price)} placeholder="0" onChange={(e) => updateItem(i.id, { price: eurFromRonInput(e.target.value) })} className={numField} aria-label={t('Preț unitar (lei)', 'Unit price (lei)')} />
                                </label>
                                <button type="button" onClick={() => removeItem(i.id)} aria-label={t('Șterge linia', 'Delete line')} className={`${COL.del} inline-flex h-9 items-center justify-center rounded-sm cursor-pointer touch-manipulation ${sk.dim} ${sk.rowHover}`}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                                <div className={`${COL.total} flex items-baseline justify-between sm:justify-end`}>
                                  <span className={`sm:hidden ${COL_HEAD} ${sk.muted}`}>{t('Total', 'Total')}</span>
                                  <span className={`font-mono text-xs tabular-nums whitespace-nowrap ${sk.strong}`}>{formatLei(i.qty * i.price, { maximumFractionDigits: 0 })}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                      <div className={`flex flex-wrap items-center gap-3 px-5 pb-3 ${rows.length > 0 ? 'pt-0' : 'pt-1'}`}>
                        <button type="button" onClick={() => addBlank(sec.id)} className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-sm text-xs cursor-pointer touch-manipulation ${sk.btnGhost}`}>
                          <Plus className="w-3 h-3" /> {t('Linie personalizată', 'Custom line')}
                        </button>
                        {rows.length === 0 && <span className={`text-xs ${sk.dim}`}>{t('Nicio linie în această secțiune.', 'No lines in this section yet.', 'Aucune ligne dans cette section.')}</span>}
                      </div>
                    </div>
                  );
                })
              )}

              {/* + Secțiune nouă: titlu liber sau o sugestie rapidă; pornește cu o linie goală */}
              <div className="px-5 py-4">
                {newSectionOpen ? (
                  <form
                    onSubmit={(e) => { e.preventDefault(); createSection(newSectionDraft); }}
                    className={`space-y-3 border rounded-md p-3 ${sk.line} ${sk.soft}`}
                  >
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        autoFocus
                        value={newSectionDraft}
                        onChange={(e) => setNewSectionDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') closeNewSection(); }}
                        maxLength={120}
                        placeholder={t('ex: Instalații sanitare', 'e.g. Plumbing works', 'ex. : Plomberie')}
                        aria-label={t('Titlul secțiunii noi', 'New section title', 'Titre de la nouvelle section')}
                        className={`${field} sm:flex-1`}
                      />
                      <div className="flex gap-2">
                        <button type="submit" disabled={!newSectionDraft.trim()} className={`inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 h-9 px-4 rounded-sm text-xs font-semibold cursor-pointer touch-manipulation disabled:opacity-40 disabled:cursor-not-allowed ${sk.btn}`}>
                          <Plus className="w-3 h-3" /> {t('Adaugă secțiunea', 'Add section', 'Ajouter la section')}
                        </button>
                        <button type="button" onClick={closeNewSection} aria-label={t('Anulează', 'Cancel', 'Annuler')} className={`inline-flex items-center justify-center h-9 w-9 rounded-sm cursor-pointer touch-manipulation ${sk.btnGhost}`}>
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {presets.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`mr-1 ${COL_HEAD} ${sk.muted}`}>{t('Sugestii', 'Suggestions', 'Suggestions')}</span>
                        {presets.map((p) => (
                          <button key={p.ro} type="button" onClick={() => createSection(t(p.ro, p.en, p.fr), p)} className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-full border text-xs cursor-pointer touch-manipulation transition-colors ${sk.line} ${sk.cell} ${sk.segOff}`}>
                            <Plus className="w-3 h-3" /> {t(p.ro, p.en, p.fr)}
                          </button>
                        ))}
                      </div>
                    )}
                  </form>
                ) : (
                  <button type="button" onClick={() => setNewSectionOpen(true)} className={`inline-flex w-full sm:w-auto items-center justify-center gap-1.5 h-9 px-4 rounded-sm border border-dashed text-xs font-medium cursor-pointer touch-manipulation transition-colors ${isDark ? 'border-[#C94A6A]/50 text-[#D65D7B] hover:bg-[#C94A6A]/10' : 'border-[#5C1628]/35 text-[#5C1628] hover:bg-[#5C1628]/[0.04]'}`}>
                    <Plus className="w-3.5 h-3.5" /> {t('Secțiune nouă', 'New section', 'Nouvelle section')}
                  </button>
                )}
              </div>

              {/* Restaurare dintr-un click a secțiunilor implicite eliminate */}
              {(laborOff || removedDefaults.length > 0) && (
                <div className={`flex flex-wrap items-center gap-2 px-5 py-3 border-t rounded-b-md ${sk.line} ${sk.soft}`}>
                  <span className={`text-xs ${sk.muted}`}>{t('Secțiuni implicite eliminate:', 'Removed default sections:', 'Sections par défaut supprimées :')}</span>
                  {laborOff && (
                    <button type="button" onClick={() => setLaborOff(false)} className={restorePill}>
                      <Plus className="w-3 h-3" /> {t('Manoperă', 'Labour')}
                    </button>
                  )}
                  {removedDefaults.map((c) => (
                    <button key={c.id} type="button" onClick={() => restoreSection(c)} className={restorePill}>
                      <Plus className="w-3 h-3" /> {t(c.ro, c.en)}
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* Client + furnizor (apar în oferta tipărită și în Factur-X) */}
            <section className={panel}>
              <div className={panelHead}><span>{t('Date client și furnizor', 'Client and seller details')}</span></div>
              <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label>{lbl(t('Furnizor (firma ta)', 'Seller (your company)'))}<input value={seller.name} onChange={(e) => setSeller((s) => ({ ...s, name: e.target.value }))} className={field} /></label>
                <label>{lbl(t('Cod TVA intracomunitar', 'EU VAT number', 'N° TVA intracommunautaire'))}<input value={seller.vatId} onChange={(e) => setSeller((s) => ({ ...s, vatId: e.target.value }))} placeholder="FR64443061841" className={`${field} font-mono`} /></label>
                <label>{lbl(t('SIREN / SIRET', 'SIREN / SIRET (company ID)', 'SIREN / SIRET'))}<input value={seller.regNo} onChange={(e) => setSeller((s) => ({ ...s, regNo: e.target.value }))} placeholder="443 061 841 00047" className={`${field} font-mono`} /></label>
                <label>{lbl(t('Sediul firmei', 'Company address'))}<input value={seller.address} onChange={(e) => setSeller((s) => ({ ...s, address: e.target.value }))} className={field} /></label>
                <label>{lbl('IBAN')}<input value={seller.iban} onChange={(e) => setSeller((s) => ({ ...s, iban: e.target.value }))} placeholder="RO49 AAAA 1B31 0075 9384 0000" className={`${field} font-mono`} /></label>
                <label>{lbl(t('Banca', 'Bank'))}<input value={seller.bank} onChange={(e) => setSeller((s) => ({ ...s, bank: e.target.value }))} className={field} /></label>
                {sellerError && <p role="alert" className="sm:col-span-2 text-xs text-red-600 font-medium">{sellerError}</p>}
                <label>{lbl(t('Client', 'Buyer'))}<input value={client.name} onChange={(e) => setClient((c) => ({ ...c, name: e.target.value }))} className={field} /></label>
                <label>{lbl(t('Cod TVA client', 'Client VAT number', 'N° TVA du client'))}<input value={client.vatId} onChange={(e) => setClient((c) => ({ ...c, vatId: e.target.value }))} className={`${field} font-mono`} /></label>
                <label>{lbl(t('Email client', 'Client email'))}<input type="email" value={client.email} onChange={(e) => setClient((c) => ({ ...c, email: e.target.value }))} className={field} /></label>
                <label>{lbl(t('Telefon client', 'Client phone'))}<input type="tel" value={client.phone} onChange={(e) => setClient((c) => ({ ...c, phone: e.target.value }))} className={field} /></label>
                <label>{lbl(t('Adresa clientului', 'Client address'))}<input value={client.address} onChange={(e) => setClient((c) => ({ ...c, address: e.target.value }))} className={field} /></label>
                <label>{lbl(t('Adresa șantierului', 'Site address'))}<input value={client.siteAddress} onChange={(e) => setClient((c) => ({ ...c, siteAddress: e.target.value }))} className={field} /></label>
                <label>{lbl(t('Număr document', 'Document number'))}<input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="SUC-2026-001" className={`${field} font-mono`} /></label>
                <label className="sm:col-span-2">{lbl(t('Observații / condiții (apar în ofertă)', 'Notes / terms (shown on the offer)'))}<textarea rows={2} value={client.notes} onChange={(e) => setClient((c) => ({ ...c, notes: e.target.value }))} className={`${field} h-auto py-2`} /></label>
              </div>
            </section>
          </div>

          {/* ── RIGHT: sticky pricing console ───────────────────────────── */}
          <PricingConsole
            lang={lang}
            isDark={isDark}
            margin={margin}
            onMarginChange={setMargin}
            contingency={contingency}
            onContingencyChange={setContingency}
            vat={vat}
            onVatChange={setVat}
            totals={{ laborTotal, itemsTotal, contingencyAmt, marginAmt, net, vatAmt, gross }}
            workDays={workDays}
            crew={crew}
            laborHours={laborHours}
            laborOff={laborOff}
          />
        </div>
      </div>

      {/* ══ PRINT ONLY ═══════════════════════════════════════════════════ */}
      <PrintDeviz
        lang={lang}
        docNo={invoiceNo}
        printDate={printDate}
        project={printProject}
        projectName={projectName}
        seller={seller}
        client={client}
        labor={laborOff ? [] : labor.map((l) => ({ name: t(l.ro, l.en), hours: l.hours, rate: l.rate, cost: l.cost }))}
        items={lines}
        sections={sections}
        totals={{ labor: laborTotal, materials: itemsTotal, contingency: contingencyAmt, contingencyPct: contingency, margin: marginAmt, marginPct: margin, net, vat, vatAmt, gross }}
        schedule={{ days: workDays, crew, hours: laborHours }}
      />
    </div>
  );
}