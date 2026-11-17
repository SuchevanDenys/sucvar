// app/components/studio/VisionPanel.tsx
// Studio · 03 — Personalizare: descriere liberă (RO/EN), materiale dintr-un click, rafinare pe element
// (pereți, pardoseală, mobilier…), paletă, lumină și comutatorul „Păstrează structura camerei (pereți, ferestre)”
// (activ implicit: geometria fotografiei rămâne blocată, se transformă finisajele, mobilierul și lumina).
// Totul se scrie în `customPrompt` (contractul existent al /api/generate) — fără câmpuri noi în API.
// În modul „Editează o zonă” panoul se concentrează pe zona selectată: alt îndemn, sugestii de obiecte / suprafețe,
// fără comutatorul de structură, lumină și inspirații pentru toată camera (restul fotografiei rămâne neatins).
"use client";

import React, { useId, useRef, useState } from 'react';
import { Check, CornerDownLeft, PenLine, Plus, Sparkles } from 'lucide-react';
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
}

export default function VisionPanel(props: VisionPanelProps) {
  const {
    lang, isDark, customPrompt, onCustomPromptChange, preserveStructure, onPreserveStructureChange,
    palette, onPaletteChange, lighting, onLightingChange, disabled, regionalEdit = false, selectionLabel = null,
  } = props;
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const promptId = useId();
  const switchId = useId();
  const refineId = useId();
  const [element, setElement] = useState<string | null>(null);
  const [refineText, setRefineText] = useState('');
  const refineRef = useRef<HTMLInputElement>(null);

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
      step="03"
      title={regionalEdit ? t('Zona selectată', 'Selected area', 'Zone sélectionnée') : t('Personalizare', 'Customise')}
      hint={regionalEdit
        ? t('Descrie doar ce se schimbă în zona pictată — restul fotografiei rămâne neatins.', 'Describe only what changes in the painted area — the rest of the photo stays untouched.', 'Décrivez seulement ce qui change dans la zone peinte — le reste de la photo reste intact.')
        : t('Descrie rezultatul dorit sau compune-l din materiale și elemente.', 'Describe the result you want, or build it from materials and elements.')}
    >
      {regionalEdit && (
        <div className={`flex items-start gap-2.5 rounded-lg border p-3 text-[12px] leading-relaxed ${isDark ? 'border-[#C94A6A]/35 bg-[#C94A6A]/[0.08]' : 'border-[#5C1628]/20 bg-[#FAF8F6]'}`}>
          <PenLine className={`mt-0.5 w-3.5 h-3.5 shrink-0 ${isDark ? 'text-[#E07F98]' : 'text-[#5C1628]'}`} aria-hidden />
          <span className={sk.muted}>
            {selectionLabel
              ? <>{t('Selecție', 'Selection', 'Sélection')}: <span className={`font-medium ${sk.strong}`}>{selectionLabel}</span>. {t('Lumina, umbrele și perspectiva camerei se păstrează.', 'The room’s lighting, shadows and perspective are kept.', 'La lumière, les ombres et la perspective de la pièce sont conservées.')}</>
              : t('Pictează pe fotografie zona pe care vrei să o schimbi (ex. doar canapeaua sau pardoseala).', 'Paint the area you want to change on the photo (e.g. only the sofa or the floor).', 'Peignez sur la photo la zone à modifier (ex. seulement le canapé ou le sol).')}
          </span>
        </div>
      )}

      {/* Descriere liberă */}
      <div className="space-y-2">
        <label htmlFor={promptId} className="flex items-center justify-between">
          <span className={label}>
            {regionalEdit ? t('Ce vrei să schimbi în zona selectată?', 'What should change in the selected area?', 'Que voulez-vous changer dans la zone sélectionnée ?') : t('Ce îți dorești?', 'What do you want?')}
          </span>
          <span className={`font-mono text-[11px] tabular-nums ${remaining < 100 ? sk.strong : sk.muted}`} aria-live="polite">
            {customPrompt.length}/{CUSTOM_PROMPT_MAX}
          </span>
        </label>
        <textarea
          id={promptId}
          value={customPrompt}
          maxLength={CUSTOM_PROMPT_MAX}
          disabled={disabled}
          rows={4}
          onChange={(e) => onCustomPromptChange(e.target.value)}
          placeholder={regionalEdit
            ? t(
                'Ce vrei să schimbi în zona selectată? Ex: înlocuiește cu o canapea din catifea bordo cu picioare din alamă',
                'What should change in the selected area? E.g. replace it with a bordeaux velvet sofa with brass legs',
                'Que voulez-vous changer dans la zone sélectionnée ? Ex : remplacez-la par un canapé en velours bordeaux aux pieds en laiton',
              )
            : t(
                'ex: Living minimalist cald, cu parchet de stejar, canapea din in crem, lumină naturală și accente negre mate',
                'e.g. A warm minimalist living room with oak flooring, a cream linen sofa, natural light and matte black accents',
              )}
          className={`w-full px-3.5 py-3 rounded-lg border text-sm leading-relaxed outline-none transition-colors resize-y min-h-[112px] ${sk.input}`}
        />
        <p className={`text-[11px] leading-relaxed ${sk.muted}`}>
          {t(
            'Scrie liber, în română sau engleză. Materialele menționate (stejar, in, travertin, LED…) ajung în randare și în lista de achiziții.',
            'Write freely, in Romanian or English. Materials you mention (oak, linen, travertine, LED…) shape the render and the shopping list.',
          )}
        </p>
      </div>

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

      {/* Păstrează structura camerei */}
      <div className={`flex items-start justify-between gap-4 rounded-lg border p-3.5 ${sk.line}`}>
        <label htmlFor={switchId} className="space-y-1 cursor-pointer">
          <span className={`block ${label}`}>
            {t('Păstrează structura camerei (pereți, ferestre)', 'Keep the room structure (walls, windows)', 'Conserver la structure de la pièce (murs, fenêtres)')}
          </span>
          <span className={`block text-[12px] leading-relaxed ${sk.muted}`}>
            {preserveStructure
              ? t('Arhitectura camerei rămâne fidelă fotografiei.', 'The room’s architecture stays true to the photo.')
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
    </StudioCard>
  );
}
