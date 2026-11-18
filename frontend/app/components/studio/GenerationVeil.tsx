// app/components/studio/GenerationVeil.tsx
// Starea „randare în curs” peste fotografie: un voal mat (blur 6 px) cu o aură caldă care „respiră” (șampanie +
// bordo), linii de trasaj arhitectural (colțare + secțiunea de aur) care se desenează și se aliniază, și o pastilă
// de sticlă cu etapa curentă (1/3 → 2/3 → 3/3, sau textul pentru masca de precizie) și o bară de progres atenuată.
// Doar transform / opacity animate (GPU, 60 FPS); `prefers-reduced-motion` îngheață totul în starea finală.
"use client";

import React, { useEffect, useState } from 'react';
import type { Language } from '@/app/types';
import { tr } from '@/app/lib/i18n';

interface GenerationVeilProps {
  lang: Language;
  /** Editare de zonă (inpainting cu mască) → textele etapelor descriu refacerea zonei. */
  regional: boolean;
}

/** Pragurile etapelor (s): randările durează de obicei 20–60 s, deci ultima etapă rămâne până la final. */
const STEP_AT = [0, 7, 19];
/** Progres estimat: se apropie asimptotic de 94 % (nu „minte” că a terminat), constanta ≈ timpul tipic. */
const progressAt = (seconds: number) => 94 * (1 - Math.exp(-seconds / 16));

export default function GenerationVeil({ lang, regional }: GenerationVeilProps) {
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = performance.now();
    const id = window.setInterval(() => setElapsed((performance.now() - start) / 1000), 400);
    return () => window.clearInterval(id);
  }, []);

  const steps = regional
    ? [
        t('Citim masca și contextul zonei…', 'Reading the mask and the area’s context…', 'Lecture du masque et du contexte de la zone…'),
        t('Refacem zona selectată cu masca de precizie…', 'Rebuilding the selected area with the precision mask…', 'Reconstruction de la zone avec le masque de précision…'),
        t('Îmbinăm lumina și umbrele cu restul camerei…', 'Blending light and shadows with the rest of the room…', 'Fusion de la lumière et des ombres avec la pièce…'),
      ]
    : [
        t('Analizăm geometria și lumina camerei…', 'Analysing the room’s geometry and light…', 'Analyse de la géométrie et de la lumière…'),
        t('Aplicăm materialele și stilul arhitectural…', 'Applying materials and the architectural style…', 'Application des matériaux et du style architectural…'),
        t('Finalizăm detaliile fotorealiste…', 'Finishing the photorealistic details…', 'Finalisation des détails photoréalistes…'),
      ];
  const step = STEP_AT.reduce((acc, at, i) => (elapsed >= at ? i : acc), 0);
  const progress = progressAt(elapsed);

  return (
    <div className="gen-veil absolute inset-0 z-10 overflow-hidden" role="status" aria-live="polite">
      {/* Voal mat + aura care respiră */}
      <div aria-hidden className="absolute inset-0 bg-[#110D0F]/25 backdrop-blur-[6px] backdrop-saturate-[1.15]" />
      <div aria-hidden className="gen-aura gen-aura--champagne" />
      <div aria-hidden className="gen-aura gen-aura--bordeaux" />

      {/* Trasaj arhitectural: secțiunea de aur (38,2 % / 61,8 %) */}
      <div aria-hidden className="absolute inset-4 sm:inset-6">
        <span className="gen-line gen-line--v" style={{ left: '38.2%', animationDelay: '120ms' }} />
        <span className="gen-line gen-line--v gen-line--wine" style={{ left: '61.8%', animationDelay: '260ms' }} />
        <span className="gen-line gen-line--h gen-line--wine" style={{ top: '38.2%', animationDelay: '400ms' }} />
        <span className="gen-line gen-line--h" style={{ top: '61.8%', animationDelay: '540ms' }} />
        {/* Colțare de cadru */}
        <span className="gen-corner gen-corner--tl" />
        <span className="gen-corner gen-corner--tr" />
        <span className="gen-corner gen-corner--bl" />
        <span className="gen-corner gen-corner--br" />
        <span className="absolute left-2 top-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-[#E9DCCB]/55">SUCVAR · A–01</span>
        <span className="absolute right-2 top-1.5 font-mono text-[9px] tracking-[0.22em] text-[#E9DCCB]/55">φ 1,618</span>
      </div>

      {/* Pastila de stare */}
      <div className="absolute inset-x-0 bottom-4 sm:bottom-6 flex justify-center px-4">
        <div className="gen-pill w-full max-w-[25rem] rounded-2xl border border-white/10 border-t-white/20 bg-[#110D0F]/60 backdrop-blur-xl backdrop-saturate-150 px-4 py-3 text-[#FAF8F6] shadow-[0_2px_8px_-2px_rgba(0,0,0,0.45),0_28px_60px_-24px_rgba(17,13,15,0.9)]">
          <div className="flex items-center gap-3">
            <span aria-hidden className="gen-spinner relative h-5 w-5 shrink-0">
              <svg viewBox="0 0 20 20" className="absolute inset-0 h-full w-full">
                <circle cx="10" cy="10" r="8.5" fill="none" stroke="#A67C52" strokeOpacity="0.28" strokeWidth="1" />
                <path className="gen-spinner-arc" d="M10 1.5 A8.5 8.5 0 0 1 18.5 10" fill="none" stroke="#C9A27A" strokeWidth="1.25" strokeLinecap="round" />
              </svg>
              <span className="gen-dot absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#C94A6A]" />
            </span>
            <p key={`${regional}-${step}`} className="gen-step min-w-0 flex-1 text-[12.5px] font-medium leading-snug">
              <span className="font-mono tabular-nums text-[#C9A27A]">{step + 1}/3</span>
              <span className="mx-1.5 text-white/35">·</span>
              {steps[step]}
            </p>
          </div>
          <div className="mt-2.5 h-[3px] w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="gen-progress relative h-full rounded-full bg-gradient-to-r from-[#5C1628] via-[#8A3B48] to-[#A67C52]"
              style={{ width: `${Math.max(4, progress)}%` }}
            >
              <span aria-hidden className="gen-sheen" />
            </div>
          </div>
          <p className="mt-1.5 flex justify-between text-[10.5px] text-white/50">
            <span>{regional ? t('Restul camerei rămâne neatins', 'The rest of the room stays untouched', 'Le reste de la pièce reste intact') : t('Structura camerei se păstrează', 'The room’s structure is kept', 'La structure de la pièce est conservée')}</span>
            <span className="tabular-nums">{t('de obicei 20–60 s', 'usually 20–60 s')}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
