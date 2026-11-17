// app/components/studio/ProjectNameField.tsx
// „Denumire proiect" — titlul editabil din antetul Studio-ului (înainte și după randare).
// Controlat: pagina ține starea și persistă redenumirea. Câmpul gol afișează numele inteligent
// (ex. „Living · Japandi") pe care îl primește proiectul la salvare, deci nu există proiecte fără nume.
"use client";

import React from 'react';
import { Check, CloudOff, Loader2, PencilLine } from 'lucide-react';
import { PROJECT_NAME_MAX } from '@/app/lib/studio/constants';
import { getSkin } from '@/app/lib/theme/skin';
import { tr } from '@/app/lib/i18n';
import type { Language } from '@/app/types';

/** Starea redenumirii unui proiect deja salvat: idle = nimic de confirmat. */
export type RenameStatus = 'idle' | 'saving' | 'saved' | 'local' | 'error';

interface ProjectNameFieldProps {
  lang: Language;
  isDark: boolean;
  value: string;
  /** Numele folosit când câmpul e gol (cameră · stil). */
  fallbackName: string;
  onChange: (value: string) => void;
  /** Blur / Enter: pagina persistă imediat, fără să mai aștepte debounce-ul. */
  onCommit?: () => void;
  /** true = proiectul există deja în Arhivă: redenumirea se salvează automat. */
  isSaved: boolean;
  status: RenameStatus;
  disabled?: boolean;
}

export default function ProjectNameField({
  lang,
  isDark,
  value,
  fallbackName,
  onChange,
  onCommit,
  isSaved,
  status,
  disabled = false,
}: ProjectNameFieldProps) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const isBlank = value.trim().length === 0;

  // Linie de stare discretă sub câmp
  const statusNode = (() => {
    switch (status) {
      case 'saving':
        return (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
            {t('Se salvează numele…', 'Saving name…', 'Enregistrement du nom…')}
          </span>
        );
      case 'saved':
        return (
          <span className={`inline-flex items-center gap-1.5 ${sk.accent}`}>
            <Check className="w-3 h-3" aria-hidden />
            {t('Nume actualizat în Arhivă', 'Name updated in Archive', 'Nom mis à jour dans l’archive')}
          </span>
        );
      case 'local':
        return (
          <span className="inline-flex items-center gap-1.5">
            <CloudOff className="w-3 h-3" aria-hidden />
            {t('Nume salvat local', 'Name saved locally', 'Nom enregistré localement')}
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1.5 text-red-500">
            <CloudOff className="w-3 h-3" aria-hidden />
            {t('Numele nu a putut fi salvat', 'The name could not be saved', 'Le nom n’a pas pu être enregistré')}
          </span>
        );
      default:
        return isBlank ? (
          <span>
            {t('Se va salva ca', 'Will be saved as', 'Sera enregistré sous')}{' '}
            <span className={`font-medium ${sk.strong}`}>{fallbackName}</span>
          </span>
        ) : isSaved ? (
          <span>{t('Modificările se salvează automat', 'Changes save automatically', 'Les modifications sont enregistrées automatiquement')}</span>
        ) : null;
    }
  })();

  return (
    <div className="min-w-0 w-full max-w-xl">
      <label htmlFor="studio-project-name" className="sr-only">
        {t('Denumire proiect', 'Project name', 'Nom du projet')}
      </label>
      <div
        className={`group relative flex items-center gap-2 rounded-lg border px-3 transition-[border-color,box-shadow] duration-200 ${
          isDark
            ? 'bg-[#110D0F] border-[#2E2427] hover:border-[#4A3A3F] focus-within:border-[#C94A6A] focus-within:ring-[3px] focus-within:ring-[#C94A6A]/30'
            : 'bg-white border-[#E8E2E0] hover:border-[#CEC4C1] focus-within:border-[#5C1628] focus-within:ring-[3px] focus-within:ring-[#5C1628]/30'
        } ${disabled ? 'opacity-60' : ''}`}
      >
        <input
          id="studio-project-name"
          type="text"
          value={value}
          maxLength={PROJECT_NAME_MAX}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onCommit?.()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          placeholder={t('Denumire proiect (ex: Living Apartament Copou)', 'Project name (e.g. Copou Apartment Living Room)', 'Nom du projet (ex : Séjour appartement Copou)')}
          aria-describedby="studio-project-name-status"
          className={`peer min-w-0 flex-1 h-11 bg-transparent text-[18px] sm:text-[22px] font-semibold tracking-tight outline-none focus-visible:outline-none ${sk.strong} ${
            isDark ? 'placeholder:text-[#8A7D80]' : 'placeholder:text-[#A99EA1]'
          } placeholder:font-normal placeholder:text-[15px] sm:placeholder:text-[17px]`}
        />
        <PencilLine
          className={`w-4 h-4 shrink-0 transition-colors ${sk.muted} ${isDark ? 'group-focus-within:text-[#D65D7B]' : 'group-focus-within:text-[#5C1628]'}`}
          aria-hidden
        />
      </div>
      <p id="studio-project-name-status" aria-live="polite" className={`mt-1.5 min-h-[18px] text-[12px] ${sk.muted}`}>
        {statusNode}
      </p>
    </div>
  );
}
