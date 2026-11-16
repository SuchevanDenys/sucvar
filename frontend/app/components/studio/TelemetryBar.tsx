// app/components/studio/TelemetryBar.tsx
// Status + plan usage strip on top of the Studio workspace.
"use client";

import React from 'react';
import { LiveDot } from '@/app/components/ui/Editorial';
import type { UsePlan } from '@/app/lib/plan/usePlan';
import { EYEBROW, getSkin } from '@/app/lib/theme/skin';
import type { Language } from '@/app/types';
import { tr } from '@/app/lib/i18n';

interface TelemetryBarProps {
  lang: Language;
  isDark: boolean;
  isLoading: boolean;
  statusLabel: string;
  modeLabel: string;
  spaceLabel: string;
  plan: UsePlan;
}

export default function TelemetryBar({ lang, isDark, isLoading, statusLabel, modeLabel, spaceLabel, plan }: TelemetryBarProps) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const eyebrow = `${EYEBROW} ${sk.dim}`;
  return (
  <div className={`border-b ${sk.line}`}>
    <div className="max-w-7xl mx-auto px-4 sm:px-6 h-9 flex items-center justify-between">
      <LiveDot label={statusLabel} active className={isLoading ? sk.accent : sk.dim} />
      <div className={`flex items-center gap-4 ${eyebrow}`}>
        <span className="hidden sm:inline">
          {modeLabel} / {spaceLabel}
        </span>
        {!plan.isLoading && (
          plan.isPro ? (
            <span className={sk.accent}>{plan.tier === 'agency' ? 'BUSINESS' : 'PROFESSIONAL'} · {t('nelimitat', 'unlimited')}</span>
          ) : (
            <span className="flex items-center gap-2">
              <span>{t('Generări', 'Generations')}</span>
              <span className="flex gap-0.5">
                {Array.from({ length: Math.max(0, Number(plan.limit) || 0) }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 w-3 rounded-full ${
                      i < Number(plan.used)
                        ? isDark ? 'bg-[#C94A6A]' : 'bg-[#5C1628]'
                        : isDark ? 'bg-[#C94A6A]/20' : 'bg-[#5C1628]/[0.12]'
                    }`}
                  />
                ))}
              </span>
              <span className="tabular-nums">{plan.used}/{plan.limit}</span>
            </span>
          )
        )}
      </div>
    </div>
  </div>
  );
}
