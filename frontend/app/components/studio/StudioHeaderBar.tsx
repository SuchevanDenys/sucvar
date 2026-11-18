// app/components/studio/StudioHeaderBar.tsx
// Antetul compact al Studio-ului (zona 1 din 3): numele proiectului în stânga, istoricul pașilor
// (Original → Varianta 1 → Editare 2) în centru doar când există, acțiunile de proiect grupate în dreapta
// („Salvează în arhivă”, „Trimite în Deviz B2B”). Mesajul ultimei acțiuni apare discret sub bară.
"use client";

import React from 'react';
import { Archive, History, Loader2, Send } from 'lucide-react';
import { tr } from '@/app/lib/i18n';
import { getSkin } from '@/app/lib/theme/skin';
import type { Language } from '@/app/types';

interface StudioHeaderBarProps {
  lang: Language;
  isDark: boolean;
  /** Câmpul numelui proiectului (ProjectNameField). */
  nameField: React.ReactNode;
  /** Rezumatul configurației (ex. „Interior · Living · Japandi”). */
  summary: string;
  steps: readonly { id: string; label: string }[];
  activeStep: number;
  onStepSelect: (index: number) => void;
  isLoading: boolean;
  canSave: boolean;
  isSaving: boolean;
  onSave: () => void;
  isSending: boolean;
  onSendToB2b: () => void;
  statusMessage?: string | null;
}

export default function StudioHeaderBar({
  lang, isDark, nameField, summary, steps, activeStep, onStepSelect, isLoading, canSave, isSaving, onSave, isSending, onSendToB2b, statusMessage,
}: StudioHeaderBarProps) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const on = isDark ? 'bg-[#C94A6A] text-white' : 'bg-[#5C1628] text-white';
  const action = 'inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap cursor-pointer touch-manipulation transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="mb-5 sm:mb-6">
      <div className={`flex flex-wrap lg:flex-nowrap items-center gap-x-4 gap-y-3 rounded-xl border px-4 py-3 ${sk.card}`}>
        <div className="min-w-0 flex-1 basis-full sm:basis-auto">
          {nameField}
          <p className={`mt-0.5 truncate text-[12px] ${sk.muted}`}>{summary}</p>
        </div>

        {steps.length > 1 && (
          <nav
            aria-label={t('Istoric editări', 'Edit history', 'Historique des modifications')}
            className={`order-last lg:order-none basis-full lg:basis-auto flex min-w-0 items-center gap-1 overflow-x-auto rounded-full border p-1 studio-scroll ${sk.line} ${isDark ? 'bg-[#110D0F]' : 'bg-[#FAF8F6]'}`}
          >
            <History className={`mx-1 w-3.5 h-3.5 shrink-0 ${sk.muted}`} aria-hidden />
            {steps.map((step, i) => (
              <React.Fragment key={step.id}>
                {i > 0 && <span className={`text-[11px] ${sk.dim}`} aria-hidden>→</span>}
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => onStepSelect(i)}
                  aria-current={i === activeStep ? 'step' : undefined}
                  title={i === activeStep ? t('Imaginea de lucru curentă', 'Current working image', 'Image de travail actuelle') : t('Revino la acest pas', 'Go back to this step', 'Revenir à cette étape')}
                  className={`inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-[12px] font-medium cursor-pointer touch-manipulation transition-colors disabled:opacity-40 ${i === activeStep ? on : sk.segOff}`}
                >
                  {step.label}
                </button>
              </React.Fragment>
            ))}
          </nav>
        )}

        <div className="flex shrink-0 items-center gap-2 ml-auto">
          <button type="button" onClick={onSave} disabled={!canSave || isSaving || isLoading} className={`${action} border ${sk.line} ${sk.btnGhost}`}>
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Archive className="w-3.5 h-3.5" aria-hidden />}
            <span className="hidden sm:inline">{t('Salvează în arhivă', 'Save to archive', 'Archiver')}</span>
            <span className="sm:hidden">{t('Salvează', 'Save', 'Enregistrer')}</span>
          </button>
          <button type="button" onClick={onSendToB2b} disabled={!canSave || isSending || isSaving || isLoading} className={`${action} ${sk.btn}`}>
            {isSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Send className="w-3.5 h-3.5" aria-hidden />}
            <span className="hidden sm:inline">{t('Trimite în Deviz B2B', 'Send to B2B Quote', 'Envoyer au devis B2B')}</span>
            <span className="sm:hidden">{t('Deviz B2B', 'B2B quote', 'Devis B2B')}</span>
          </button>
        </div>
      </div>
      {statusMessage && <p role="status" className={`mt-2 px-1 text-[12px] ${sk.muted}`}>{statusMessage}</p>}
    </div>
  );
}
