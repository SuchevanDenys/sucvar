// app/components/studio/SpaceScenarioPanel.tsx
// Pasul 02: categorie + tip de spațiu, configurație, scenarii arhitecturale (chips)
// și nivelul de intervenție (scope).
"use client";

import React from 'react';
import { Check } from 'lucide-react';
import {
  MAX_FOCUS_CHIPS,
  SCOPES,
  SPACE_MODES,
  getFocusScenarios,
  getScope,
  getSpace,
} from '@/app/data/catalog';
import { MODE_IDS, PROJECT_NAME_MAX } from '@/app/lib/studio/constants';
import { EYEBROW, getSkin } from '@/app/lib/theme/skin';
import type { DesignMode, Language, ScopeLevel } from '@/app/types';
import { tr } from '@/app/lib/i18n';

interface SpaceScenarioPanelProps {
  lang: Language;
  isDark: boolean;
  projectName: string;
  defaultProjectName: string;
  mode: DesignMode;
  spaceId: string;
  layoutId: string;
  focusIds: string[];
  scope: ScopeLevel;
  onProjectNameChange: (value: string) => void;
  onModeChange: (mode: DesignMode) => void;
  onSpaceChange: (spaceId: string) => void;
  onLayoutChange: (layoutId: string) => void;
  onToggleFocus: (id: string) => void;
  onScopeChange: (scope: ScopeLevel) => void;
  /** false = categoria și tipul de spațiu sunt alese în altă parte (Studio: RoomStylePicker). */
  showSpacePicker?: boolean;
  /** false = fără chenar propriu (inclus într-o secțiune existentă). */
  framed?: boolean;
}

export default function SpaceScenarioPanel({
  lang,
  isDark,
  projectName,
  defaultProjectName,
  mode,
  spaceId,
  layoutId,
  focusIds,
  scope,
  onProjectNameChange,
  onModeChange,
  onSpaceChange,
  onLayoutChange,
  onToggleFocus,
  onScopeChange,
  showSpacePicker = true,
  framed = true,
}: SpaceScenarioPanelProps) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const eyebrow = `${EYEBROW} ${sk.dim}`;
  const fieldCls = `w-full h-10 px-3 rounded-sm border text-xs font-mono outline-none transition-colors ${sk.input}`;
  const seg = (active: boolean) =>
    `flex-1 min-h-10 px-3 py-2 ${EYEBROW} cursor-pointer touch-manipulation transition-colors ${active ? sk.segOn : sk.segOff}`;

  const space = getSpace(mode, spaceId);
  const picked = getFocusScenarios(space, focusIds);
  const limitReached = focusIds.length >= MAX_FOCUS_CHIPS;
  const activeScope = getScope(scope);

  return (
    <section className={framed ? `border rounded-md ${sk.card}` : ''}>
      {framed && (
      <div className={`px-4 h-9 flex items-center justify-between border-b ${sk.line} ${eyebrow}`}>
        <span>{t('Spațiu & scenariu', 'Space & scenario')}</span>
        <span className="tabular-nums">{focusIds.length}/{MAX_FOCUS_CHIPS}</span>
      </div>
      )}
      <div className={framed ? 'p-4 space-y-4' : 'space-y-4'}>
        <label className="block space-y-1.5">
          <span className={eyebrow}>{t('Nume proiect', 'Project name')}</span>
          <input
            type="text"
            value={projectName}
            maxLength={PROJECT_NAME_MAX}
            onChange={(e) => onProjectNameChange(e.target.value)}
            placeholder={defaultProjectName}
            className={fieldCls}
          />
        </label>

        {/* Categorie → tip de spațiu → configurație */}
        <div className="space-y-3">
          {showSpacePicker && (<>
          <div className={`flex border rounded-md overflow-hidden divide-x ${sk.line} ${sk.divide}`}>
            {MODE_IDS.map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => onModeChange(m)} className={seg(mode === m)}>
                {tr(lang, SPACE_MODES[m].labelRo, SPACE_MODES[m].labelEn)}
              </button>
            ))}
          </div>
          <select value={space.id} onChange={(e) => onSpaceChange(e.target.value)} className={fieldCls} aria-label={t('Spațiu', 'Space')}>
            {SPACE_MODES[mode].spaces.map((s) => (
              <option key={s.id} value={s.id} className={sk.option}>
                {tr(lang, s.labelRo, s.labelEn)}
              </option>
            ))}
          </select>
          </>)}
          <select value={layoutId} onChange={(e) => onLayoutChange(e.target.value)} className={fieldCls} aria-label={t('Configurație', 'Layout')}>
            {space.layouts.map((l) => (
              <option key={l.id} value={l.id} className={sk.option}>
                {tr(lang, l.labelRo, l.labelEn)}
              </option>
            ))}
          </select>
        </div>

        {/* Scenarii arhitecturale (chips): intră în promptul AI și în specificații */}
        <div className="space-y-2">
          <span className={eyebrow}>
            {t(`Scenarii (max. ${MAX_FOCUS_CHIPS})`, `Scenarios (max ${MAX_FOCUS_CHIPS})`,
            `Scénarios (max. ${MAX_FOCUS_CHIPS})`)}
          </span>
          <div className="flex flex-wrap gap-2">
            {space.scenarios.map((s) => {
              const active = focusIds.includes(s.id);
              const blocked = !active && limitReached;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={active}
                  disabled={blocked}
                  onClick={() => onToggleFocus(s.id)}
                  className={`inline-flex items-center gap-1.5 min-h-9 px-3 py-1.5 rounded-sm border text-left text-xs leading-snug cursor-pointer touch-manipulation transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    active ? `${sk.chipOn}` : `${sk.btnGhost}`
                  }`}
                >
                  {active && <Check className="w-3 h-3 shrink-0" aria-hidden />}
                  <span>{tr(lang, s.labelRo, s.labelEn)}</span>
                </button>
              );
            })}
          </div>
          {picked.length > 0 && (
            <ul className={`text-[11px] leading-relaxed space-y-0.5 ${sk.muted}`}>
              {picked.map((s) => (
                <li key={s.id}>
                  <span className={sk.accent}>›</span> {tr(lang, s.materialRo, s.materialEn)}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Nivel de intervenție: scalează devizul și informează promptul AI */}
        <div className="space-y-2">
          <span className={eyebrow}>{t('Nivel de intervenție', 'Intervention level')}</span>
          <div className={`flex border rounded-md overflow-hidden divide-x ${sk.line} ${sk.divide}`}>
            {SCOPES.map((o) => (
              <button key={o.id} type="button" aria-pressed={scope === o.id} onClick={() => onScopeChange(o.id)} className={`${seg(scope === o.id)} text-center`}>
                {tr(lang, o.labelRo, o.labelEn)}
              </button>
            ))}
          </div>
          <p className={`text-[11px] leading-relaxed ${sk.muted}`}>{tr(lang, activeScope.descRo, activeScope.descEn)}</p>
        </div>
      </div>
    </section>
  );
}
