// app/components/studio/VisionPanel.tsx
// Studio · 04 — Descriere & Generare: descriere liberă (RO/EN), materiale dintr-un click, rafinare pe element
// (pereți, pardoseală, mobilier…), paletă, lumină și comutatorul „Păstrează structura camerei (pereți, ferestre)”
// (activ implicit: geometria fotografiei rămâne blocată, se transformă finisajele, mobilierul și lumina).
// Totul se scrie în `customPrompt` (contractul existent al /api/generate) — fără câmpuri noi în API.
// Dezvăluire progresivă: descrierea + sugestiile rapide sunt mereu vizibile; rafinarea pe element, paleta, lumina,
// structura și inspirațiile stau sub „Mai multe opțiuni”. Butonul principal de generare vine ca `children` (la final).
// În modul „Editează o zonă” panoul se concentrează pe zona selectată: alt îndemn, sugestii de obiecte / suprafețe,
// fără comutatorul de structură, lumină și inspirații pentru toată camera (restul fotografiei rămâne neatins).
"use client";

import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, CornerDownLeft, Plus, SlidersHorizontal, Sparkles } from 'lucide-react';
import { getSkin } from '@/app/lib/theme/skin';
import {
  CUSTOM_PROMPT_MAX,
  INSPIRATIONS,
  LIGHTINGS,
  PALETTES,
  applyInspiration,
  type LightingId,
  type PaletteId,
} from '@/app/lib/studio/vision';
import type { Language } from '@/app/types';
import { tr } from '@/app/lib/i18n';
import { StudioCard } from './StudioCard';

/** Materiale / finisaje dintr-un click (recunoscute de glosarul API-ului și în lista de achiziții). */
const MATERIAL_CHIPS: { ro: string; en: string }[] = [
  { ro: 'Parchet stejar natur', en: 'Natural oak parquet' },
  { ro: 'Pereți alb cald', en: 'Warm white walls' },
  { ro: 'Mobilier minimalist', en: 'Minimalist furniture' },
  { ro: 'Microciment', en: 'Microcement' },
  { ro: 'Accente negru mat', en: 'Matte black accents' },
  { ro: 'Lemn de nuc', en: 'Walnut wood' },
  { ro: 'Iluminat LED ascuns', en: 'Hidden LED lighting' },
  { ro: 'Canapea din in', en: 'Linen sofa' },
  { ro: 'Travertin', en: 'Travertine' },
  { ro: 'Plante naturale', en: 'Natural plants' },
];

/** Sugestii pentru zona selectată: ce poate deveni obiectul / suprafața pictată. */
const REGION_CHIPS: { ro: string; en: string; fr: string }[] = [
  { ro: 'Canapea din catifea bordo', en: 'Bordeaux velvet sofa', fr: 'Canapé en velours bordeaux' },
  { ro: 'Parchet în spic din stejar', en: 'Oak herringbone parquet', fr: 'Parquet chevron en chêne' },
  { ro: 'Insulă cu blat din marmură', en: 'Marble-top kitchen island', fr: 'Îlot avec plan en marbre' },
  { ro: 'Fotoliu din bouclé crem', en: 'Cream bouclé armchair', fr: 'Fauteuil en bouclette crème' },
  { ro: 'Perete cu riflaje din lemn', en: 'Wood slat wall panelling', fr: 'Mur en tasseaux de bois' },
  { ro: 'Covor din lână', en: 'Wool rug', fr: 'Tapis en laine' },
  { ro: 'Blat din cuarț alb', en: 'White quartz countertop', fr: 'Plan en quartz blanc' },
  { ro: 'Lustră suspendată din alamă', en: 'Brass pendant light', fr: 'Suspension en laiton' },
  { ro: 'Microciment', en: 'Microcement', fr: 'Microciment' },
  { ro: 'Plante naturale', en: 'Natural plants', fr: 'Plantes naturelles' },
];

/** „Editează acest rezultat”: comenzi rapide pentru obiectul pictat pe randare. */
const CHAIN_CHIPS: { ro: string; en: string; fr: string }[] = [
  { ro: 'Schimbă culoarea obiectului selectat', en: 'Change the colour of the selected object', fr: 'Changer la couleur de l’objet sélectionné' },
  { ro: 'Înlocuiește cu lemn de stejar', en: 'Replace it with oak wood', fr: 'Remplacer par du bois de chêne' },
  { ro: 'Adaugă lumină caldă', en: 'Add warm light', fr: 'Ajouter une lumière chaude' },
  { ro: 'Tapițerie din piele coniac', en: 'Cognac leather upholstery', fr: 'Revêtement en cuir cognac' },
  { ro: 'Fă-l verde smarald', en: 'Make it emerald green', fr: 'Le rendre vert émeraude' },
];

/** Elemente ale camerei care pot fi rafinate separat (se scriu ca „pardoseală: …” în descriere). */
const ELEMENTS: { id: string; ro: string; en: string; hintRo: string; hintEn: string }[] = [
  { id: 'walls', ro: 'Pereți', en: 'Walls', hintRo: 'ex: verde salvie mat, un perete cu riflaje din lemn', hintEn: 'e.g. matte sage green, one wall with wood slats' },
  { id: 'floor', ro: 'Pardoseală', en: 'Floor', hintRo: 'ex: parchet în spic din stejar deschis', hintEn: 'e.g. light oak herringbone parquet' },
  { id: 'furniture', ro: 'Mobilier', en: 'Furniture', hintRo: 'ex: canapea modulară bej, măsuță rotundă din travertin', hintEn: 'e.g. beige modular sofa, round travertine coffee table' },
  { id: 'lighting', ro: 'Iluminat', en: 'Lighting', hintRo: 'ex: lustră suspendată din alamă, bandă LED în tavan', hintEn: 'e.g. brass pendant, LED strip in the ceiling' },
  { id: 'ceiling', ro: 'Tavan', en: 'Ceiling', hintRo: 'ex: tavan alb cu mulură decorativă', hintEn: 'e.g. white ceiling with decorative moulding' },
  { id: 'decor', ro: 'Decor', en: 'Decor', hintRo: 'ex: covor din lână, draperii din in, artă abstractă', hintEn: 'e.g. wool rug, linen curtains, abstract art' },
];

const norm = (s: string) => s.toLocaleLowerCase('ro-RO');

/** Adaugă o frază la descriere (separată prin virgulă), respectând limita de caractere. */
function appendPhrase(current: string, phrase: string): string {
  const trimmed = current.trim().replace(/[.,;\s]+$/, '');
  return (trimmed ? `${trimmed}, ${phrase}` : phrase).slice(0, CUSTOM_PROMPT_MAX);
}

/** Scoate o frază din descriere (indiferent de majuscule) și curăță separatorii rămași. */
function removePhrase(current: string, phrase: string): string {
  const i = norm(current).indexOf(norm(phrase));
  if (i < 0) return current;
  return (current.slice(0, i) + current.slice(i + phrase.length))
    .replace(/\s*,\s*,\s*/g, ', ')
    .replace(/^[\s,]+|[\s,]+$/g, '');
}

interface VisionPanelProps {
  lang: Language;
  isDark: boolean;
  customPrompt: string;
  onCustomPromptChange: (value: string) => void;
  preserveStructure: boolean;
  onPreserveStructureChange: (value: boolean) => void;
  palette: PaletteId | null;
  onPaletteChange: (id: PaletteId | null) => void;
  lighting: LightingId | null;
  onLightingChange: (id: LightingId | null) => void;
  disabled?: boolean;
  /** „Editează o zonă” activ: textul descrie DOAR ce se schimbă în selecție. */
  regionalEdit?: boolean;
  /** Poziția selecției curente, tradusă (ex. „prim-plan, centru”), sau null dacă nu s-a pictat nimic. */
  selectionLabel?: string | null;
  /** Crește la „Editează acest rezultat”: aduce câmpul de descriere în vizor și îl focalizează. */
  focusSignal?: number;
  /** Imaginea de lucru este o randare anterioară: afișează comenzile rapide pentru editarea în lanț. */
  chainedEdit?: boolean;
  /** Contextul păstrat la editarea în lanț (ex. „Living · Japandi”), afișat ca etichetă deasupra descrierii. */
  chainContext?: string | null;
  /** „Optimizare spațiu”: descrierea devine opțională, structura e mereu păstrată (comutatorul dispare). */
  optimizing?: boolean;
  /** Blocul de generare (butonul principal, cota, erorile), afișat la finalul cardului. */
  children?: React.ReactNode;
}

export default function VisionPanel(props: VisionPanelProps) {
  const {
    lang, isDark, customPrompt, onCustomPromptChange, preserveStructure, onPreserveStructureChange,
    palette, onPaletteChange, lighting, onLightingChange, disabled, regionalEdit = false, selectionLabel = null,
    focusSignal = 0, chainedEdit = false, chainContext = null, optimizing = false, children,
  } = props;
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const promptId = useId();
  const switchId = useId();
  const refineId = useId();
  const [element, setElement] = useState<string | null>(null);
  const [refineText, setRefineText] = useState('');
  const refineRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreId = useId();
  // Opțiunile ascunse care sunt totuși active (rezumat pe butonul „Mai multe opțiuni”)
  const activeExtras = (palette ? 1 : 0) + (!regionalEdit && lighting ? 1 : 0) + (!regionalEdit && !optimizing && !preserveStructure ? 1 : 0);

  useEffect(() => {
    if (focusSignal === 0) return;
    const el = promptRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
  }, [focusSignal]);

  const pill = (active: boolean) =>
    `inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] whitespace-nowrap cursor-pointer touch-manipulation active:scale-[0.97] transition-[background-color,border-color,transform] disabled:opacity-40 disabled:cursor-not-allowed ${
      active ? `${sk.chipOn}` : `${sk.line} ${sk.segOff}`
    }`;
  const label = `text-[13px] font-medium ${sk.strong}`;

  const remaining = CUSTOM_PROMPT_MAX - customPrompt.length;
  const activeElement = ELEMENTS.find((e) => e.id === element) ?? null;

  const toggleMaterial = (phrase: string) => {
    const present = norm(customPrompt).includes(norm(phrase));
    onCustomPromptChange(present ? removePhrase(customPrompt, phrase) : appendPhrase(customPrompt, phrase));
  };

  const addRefinement = () => {
    if (!activeElement || !refineText.trim()) return;
    onCustomPromptChange(appendPhrase(customPrompt, `${norm(t(activeElement.ro, activeElement.en))}: ${refineText.trim()}`));
    setRefineText('');
    setElement(null);
  };

  return (
    <StudioCard
      isDark={isDark}
      step="04"
      title={t('Descriere & Generare', 'Describe & Generate', 'Description & génération')}
      hint={regionalEdit
        ? selectionLabel
          ? `${t('Selecție', 'Selection', 'Sélection')}: ${selectionLabel} — ${t('lumina, umbrele și perspectiva camerei se păstrează.', 'the room’s lighting, shadows and perspective are kept.', 'la lumière, les ombres et la perspective sont conservées.')}`
          : t('Descrie doar ce se schimbă în zona pictată — restul fotografiei rămâne neatins.', 'Describe only what changes in the painted area — the rest of the photo stays untouched.', 'Décrivez seulement ce qui change dans la zone peinte — le reste de la photo reste intact.')
        : optimizing
          ? t('Opțional: adaugă stilul sau materialele dorite — reorganizarea urmează regulile ergonomice.', 'Optional: add the style or materials you want — the layout follows the ergonomic rules.', 'Facultatif : ajoutez le style ou les matériaux — l’agencement suit les règles ergonomiques.')
          : t('Descrie rezultatul dorit sau compune-l din materiale și elemente.', 'Describe the result you want, or build it from materials and elements.')}
    >

      {/* Descriere liberă */}
      <div className="space-y-2">
        {regionalEdit && chainedEdit && chainContext && (
          <p className={`flex flex-wrap items-center gap-1.5 text-[11.5px] ${sk.muted}`}>
            <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-[#A67C52]/45 bg-[#A67C52]/10 px-2.5 font-medium text-[#A67C52]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#A67C52]" aria-hidden />
              {t('Context păstrat', 'Context kept', 'Contexte conservé')}: {chainContext}
            </span>
            <span>{t('— descrie doar obiectul.', '— describe only the object.', '— décrivez seulement l’objet.')}</span>
          </p>
        )}
        <label htmlFor={promptId} className="flex items-center justify-between">
          <span className={label}>
            {regionalEdit
              ? t('Ce vrei să schimbi în zona selectată?', 'What should change in the selected area?', 'Que voulez-vous changer dans la zone sélectionnée ?')
              : optimizing ? t('Preferințe de stil (opțional)', 'Style preferences (optional)', 'Préférences de style (facultatif)') : t('Ce îți dorești?', 'What do you want?')}
          </span>
          <span className={`font-mono text-[11px] tabular-nums ${remaining < 100 ? sk.strong : sk.muted}`} aria-live="polite">
            {customPrompt.length}/{CUSTOM_PROMPT_MAX}
          </span>
        </label>
        <textarea
          ref={promptRef}
          id={promptId}
          value={customPrompt}
          maxLength={CUSTOM_PROMPT_MAX}
          disabled={disabled}
          rows={optimizing ? 3 : 4}
          onChange={(e) => onCustomPromptChange(e.target.value)}
          placeholder={regionalEdit && chainedEdit
            ? t(
                'Scrie doar ce vrei să modifici în zona pictată (ex: schimbă culoarea în verde salvie)',
                'Write only what should change in the painted area (e.g. change the colour to sage green)',
                'Écrivez seulement ce qui change dans la zone peinte (ex : changez la couleur en vert sauge)',
              )
            : regionalEdit
            ? t(
                'Ce vrei să schimbi în zona selectată? Ex: înlocuiește cu o canapea din catifea bordo cu picioare din alamă',
                'What should change in the selected area? E.g. replace it with a bordeaux velvet sofa with brass legs',
                'Que voulez-vous changer dans la zone sélectionnée ? Ex : remplacez-la par un canapé en velours bordeaux aux pieds en laiton',
              )
            : t(
                'ex: Living minimalist cald, cu parchet de stejar, canapea din in crem, lumină naturală și accente negre mate',
                'e.g. A warm minimalist living room with oak flooring, a cream linen sofa, natural light and matte black accents',
              )}
          className={`w-full px-3.5 py-3 rounded-lg border text-sm leading-relaxed outline-none transition-colors resize-y ${optimizing ? 'min-h-[88px]' : 'min-h-[112px]'} ${sk.input}`}
        />
      </div>

      {regionalEdit && chainedEdit && (
        <div className="space-y-2">
          <p className={label}>{t('Modifică obiectul selectat', 'Modify the selected object', 'Modifier l’objet sélectionné')}</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('Modifică obiectul selectat', 'Modify the selected object', 'Modifier l’objet sélectionné')}>
            {CHAIN_CHIPS.map((m) => {
              const phrase = t(m.ro, m.en, m.fr);
              const active = norm(customPrompt).includes(norm(phrase));
              return (
                <button key={m.ro} type="button" disabled={disabled} aria-pressed={active} onClick={() => toggleMaterial(phrase)} className={pill(active)}>
                  {active ? <Check className="w-3 h-3" aria-hidden /> : <Sparkles className="w-3 h-3 opacity-60" aria-hidden />}
                  {phrase}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Materiale dintr-un click */}
      <div className="space-y-2">
        <p className={label}>{regionalEdit ? t('Sugestii pentru zonă', 'Ideas for the area', 'Idées pour la zone') : t('Materiale & finisaje', 'Materials & finishes')}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label={regionalEdit ? t('Sugestii pentru zonă', 'Ideas for the area', 'Idées pour la zone') : t('Materiale & finisaje', 'Materials & finishes')}>
          {(regionalEdit ? REGION_CHIPS : MATERIAL_CHIPS).map((m: { ro: string; en: string; fr?: string }) => {
            const phrase = t(m.ro, m.en, m.fr);
            const active = norm(customPrompt).includes(norm(phrase));
            return (
              <button key={m.ro} type="button" disabled={disabled} aria-pressed={active} onClick={() => toggleMaterial(phrase)} className={pill(active)}>
                {active ? <Check className="w-3 h-3" aria-hidden /> : <Plus className="w-3 h-3 opacity-60" aria-hidden />}
                {phrase}
              </button>
            );
          })}
        </div>
      </div>

      {/* Opțiuni suplimentare (dezvăluire progresivă) */}
      <div className={`rounded-lg border ${sk.line}`}>
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          aria-expanded={moreOpen}
          aria-controls={moreId}
          className={`w-full flex items-center justify-between gap-3 px-3.5 h-10 rounded-lg text-left text-[13px] font-medium cursor-pointer touch-manipulation transition-colors ${sk.rowHover} ${sk.strong}`}
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal className={`w-3.5 h-3.5 ${sk.muted}`} aria-hidden />
            {regionalEdit ? t('Paletă de culori', 'Colour palette') : t('Mai multe opțiuni', 'More options', 'Plus d’options')}
            {activeExtras > 0 && (
              <span className={`inline-flex h-5 items-center rounded-full px-1.5 text-[10.5px] font-medium ${sk.segOn}`}>
                {activeExtras} {t('active', 'active', 'actives')}
              </span>
            )}
          </span>
          <span className={`flex items-center gap-1.5 text-[11.5px] font-normal ${sk.muted}`}>
            {!regionalEdit && <span className="hidden sm:inline">{t('Element, paletă, lumină, structură', 'Element, palette, light, structure', 'Élément, palette, lumière, structure')}</span>}
            <ChevronDown className={`w-4 h-4 transition-transform ${moreOpen ? 'rotate-180' : ''}`} aria-hidden />
          </span>
        </button>
        {moreOpen && (
        <div id={moreId} className={`space-y-5 border-t px-3.5 pb-4 pt-4 ${sk.line}`}>
      {/* Rafinare pe element (toată camera) */}
      {!regionalEdit && (
      <div className="space-y-2">
        <p className={label}>{t('Rafinează un element', 'Refine an element')}</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('Element', 'Element')}>
          {ELEMENTS.map((e) => (
            <button
              key={e.id}
              type="button"
              role="radio"
              aria-checked={element === e.id}
              disabled={disabled}
              onClick={() => {
                setElement((cur) => (cur === e.id ? null : e.id));
                setTimeout(() => refineRef.current?.focus(), 0);
              }}
              className={pill(element === e.id)}
            >
              {t(e.ro, e.en)}
            </button>
          ))}
        </div>
        {activeElement && (
          <div className={`flex items-center gap-2 rounded-lg border p-1.5 pl-3 ${sk.line}`}>
            <label htmlFor={refineId} className={`shrink-0 text-[12px] font-medium ${sk.strong}`}>{t(activeElement.ro, activeElement.en)}:</label>
            <input
              id={refineId}
              ref={refineRef}
              value={refineText}
              disabled={disabled}
              onChange={(e) => setRefineText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addRefinement();
                }
              }}
              placeholder={t(activeElement.hintRo, activeElement.hintEn)}
              className={`min-w-0 flex-1 bg-transparent text-[13px] outline-none ${sk.strong} ${isDark ? 'placeholder:text-[#8A7D80]' : 'placeholder:text-[#A99EA1]'}`}
            />
            <button
              type="button"
              disabled={disabled || !refineText.trim()}
              onClick={addRefinement}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium cursor-pointer touch-manipulation disabled:opacity-40 disabled:cursor-not-allowed ${sk.btn}`}
            >
              <CornerDownLeft className="w-3.5 h-3.5" aria-hidden />
              {t('Adaugă', 'Add')}
            </button>
          </div>
        )}
      </div>
      )}

      {/* Paletă & lumină */}
      <div className="space-y-2">
        <p className={label}>{t('Paletă de culori', 'Colour palette')}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={disabled} aria-pressed={palette === null} onClick={() => onPaletteChange(null)} className={pill(palette === null)}>
            {t('Auto', 'Auto')}
          </button>
          {PALETTES.map((p) => (
            <button key={p.id} type="button" disabled={disabled} aria-pressed={palette === p.id} onClick={() => onPaletteChange(p.id)} className={pill(palette === p.id)}>
              {tr(lang, p.ro, p.en)}
            </button>
          ))}
        </div>
      </div>
      {!regionalEdit && (<>
      <div className="space-y-2">
        <p className={label}>{t('Lumină', 'Lighting')}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={disabled} aria-pressed={lighting === null} onClick={() => onLightingChange(null)} className={pill(lighting === null)}>
            {t('Auto', 'Auto')}
          </button>
          {LIGHTINGS.map((p) => (
            <button key={p.id} type="button" disabled={disabled} aria-pressed={lighting === p.id} onClick={() => onLightingChange(p.id)} className={pill(lighting === p.id)}>
              {tr(lang, p.ro, p.en)}
            </button>
          ))}
        </div>
      </div>

      {/* Păstrează structura camerei (în „Optimizare spațiu” structura e mereu păstrată) */}
      {!optimizing && (
      <div className={`flex items-start justify-between gap-4 rounded-lg border p-3.5 ${sk.line}`}>
        <label htmlFor={switchId} className="space-y-1 cursor-pointer">
          <span className={`block ${label}`}>
            {t('Păstrează structura camerei (pereți, uși, ferestre)', 'Keep the room structure (walls, doors, windows)', 'Conserver la structure de la pièce (murs, portes, fenêtres)')}
          </span>
          <span className={`block text-[12px] leading-relaxed ${sk.muted}`}>
            {preserveStructure
              ? t('Ușile, golurile și ferestrele rămân exact unde sunt — nimic nu se pune peste ele.', 'Doors, doorways and windows stay exactly where they are — nothing is placed over them.', 'Portes, passages et fenêtres restent exactement en place — rien n’est posé devant.')
              : t('Redesign spațial complet — AI-ul poate reorganiza camera.', 'Full spatial redesign — the AI may rearrange the room.')}
          </span>
        </label>
        <button
          id={switchId}
          type="button"
          role="switch"
          aria-checked={preserveStructure}
          disabled={disabled}
          onClick={() => onPreserveStructureChange(!preserveStructure)}
          className={`relative shrink-0 w-10 h-6 rounded-full border transition-colors cursor-pointer touch-manipulation disabled:opacity-40 ${
            preserveStructure
              ? isDark ? 'bg-[#C94A6A] border-[#C94A6A]' : 'bg-[#5C1628] border-[#5C1628]'
              : `${sk.line} ${isDark ? 'bg-[#231B1E]' : 'bg-[#F5F2EF]'}`
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full transition-transform ${
              preserveStructure ? 'translate-x-4 bg-white' : 'bg-[#B5A9AC]'
            }`}
          />
        </button>
      </div>
      )}

      {/* Inspirații complete (secundar) */}
      <div className="space-y-2">
        <p className={`flex items-center gap-1.5 text-[12px] ${sk.muted}`}>
          <Sparkles className="w-3 h-3" aria-hidden />
          {t('Sau pornește de la o inspirație', 'Or start from an inspiration')}
        </p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('Inspirații', 'Inspirations')}>
          {INSPIRATIONS.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              onClick={() => onCustomPromptChange(applyInspiration(customPrompt, p, lang))}
              className={`inline-flex h-7 items-center rounded-full px-2.5 text-[11px] cursor-pointer touch-manipulation transition-colors disabled:opacity-40 ${isDark ? 'bg-[#231B1E] hover:bg-[#2E2427]' : 'bg-[#F5F2EF] hover:bg-[#EFEAE6]'} ${sk.muted}`}
            >
              {tr(lang, p.labelRo, p.labelEn, p.labelFr)}
            </button>
          ))}
        </div>
      </div>
      </>)}
        </div>
        )}
      </div>

      {children}
    </StudioCard>
  );
}
