// 04 · Portofoliu & linkuri client — proiectele din cloud, comutator link public, copiere, statusul aprobării.
"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, ExternalLink, HardHat, Layers } from 'lucide-react';
import ProcurementList from '@/app/components/archive/ProcurementList';
import ClientStatusBadge from '@/app/components/portal/ClientStatusBadge';
import { copyText, setSharing, shareUrl } from '@/app/lib/portal/client';
import { backfillProcurement, type ProfileProject, type ProfileView } from '@/app/lib/profile/client';
import { STORAGE_KEYS, writeStorage } from '@/app/lib/storage';
import { EYEBROW_UI, Notice, Section, formatDate, type Ui } from './shared';
import { tr } from '@/app/lib/i18n';
import type { Language } from '@/app/types';

const MODE_LABEL: Record<string, { ro: string; en: string }> = {
  interiors: { ro: 'Interior', en: 'Interior' },
  exteriors: { ro: 'Exterior', en: 'Exterior' },
  gardens: { ro: 'Grădină', en: 'Garden' },
};

export default function PortfolioSection({
  profile, ui, lang, isDark, onProjectChange,
}: { profile: ProfileView; ui: Ui; lang: Language; isDark: boolean; onProjectChange: (p: ProfileProject) => void }) {
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const toggle = async (p: ProfileProject) => {
    setBusyId(p.id);
    setNote(null);
    const r = await setSharing(p.id, !p.isPublic);
    setBusyId(null);
    if (r.ok) onProjectChange({ ...p, isPublic: r.data.isPublic, clientStatus: r.data.clientStatus, clientFeedback: r.data.clientFeedback, clientReviewedAt: r.data.clientReviewedAt });
    else setNote({ kind: 'error', text: r.message ?? t('Operația a eșuat.', 'The operation failed.') });
  };

  const copy = async (p: ProfileProject) => {
    if (!p.isPublic) await toggle(p);
    const ok = await copyText(shareUrl(p.id));
    setNote(ok ? { kind: 'ok', text: t('Link copiat.', 'Link copied.') } : { kind: 'error', text: t('Copierea a fost blocată de browser.', 'The browser blocked copying.') });
  };

  // Aceeași cale ca „Deschide în Studio” din arhivă: Studio citește id-ul din localStorage la montare
  const openInStudio = (p: ProfileProject) => {
    writeStorage(STORAGE_KEYS.activeProject, p.id);
    router.push('/generate');
  };

  return (
    <Section
      index="04"
      title={t('Portofoliu & linkuri client', 'Portfolio & client links')}
      ui={ui}
      aside={<span className={`text-[10px] font-mono uppercase tracking-widest ${ui.muted}`}>{profile.projects.length}</span>}
    >
      {note && <Notice kind={note.kind}>{note.text}</Notice>}
      {profile.projects.length === 0 ? (
        <p className={`text-sm ${ui.muted}`}>
          {t('Nu ai încă proiecte salvate în cloud. Generează o randare în Studio și apasă „Salvează”.', 'No cloud projects yet. Generate a render in Studio and press “Save”.')}
        </p>
      ) : (
        <ul className={`divide-y ${ui.line} -mx-5 sm:-mx-6`}>
          {profile.projects.map((p) => (
            <li key={p.id} className="px-5 sm:px-6 py-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{p.title}</p>
                  <p className={`mt-0.5 ${EYEBROW_UI} ${ui.muted}`}>
                    {(tr(lang, MODE_LABEL[p.mode]?.ro, MODE_LABEL[p.mode]?.en)) ?? p.mode} · {p.spaceType || '—'} · {formatDate(p.createdAt, lang)}
                    {!p.hasImage && ` · ${t('fără randare', 'no render')}`}
                  </p>
                </div>
                {(p.isPublic || p.clientReviewedAt) && <ClientStatusBadge status={p.clientStatus} isDark={isDark} lang={lang} />}
              </div>

              {p.clientFeedback && (
                <blockquote className={`border-l-2 pl-3 text-xs leading-relaxed whitespace-pre-line break-words ${isDark ? 'border-[#F5F2EF]/40' : 'border-[#1B1416]/40'} ${ui.muted}`}>
                  {p.clientFeedback}
                  {p.clientReviewedAt && <span className="block mt-1 font-mono text-[10px]">{formatDate(p.clientReviewedAt, lang)}</span>}
                </blockquote>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={p.isPublic}
                  disabled={busyId === p.id}
                  onClick={() => void toggle(p)}
                  className={`inline-flex items-center gap-2 h-9 px-3 rounded-sm border text-[11px] font-semibold uppercase tracking-widest cursor-pointer touch-manipulation disabled:opacity-50 ${p.isPublic ? ui.btn : ui.btnGhost}`}
                >
                  {p.isPublic ? t('Link public · activ', 'Public link · on') : t('Link public · oprit', 'Public link · off')}
                </button>
                <button type="button" disabled={busyId === p.id} onClick={() => void copy(p)} className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-sm border text-[11px] font-semibold uppercase tracking-widest cursor-pointer touch-manipulation disabled:opacity-50 ${ui.btnGhost}`}>
                  <Copy className="w-3.5 h-3.5" aria-hidden /> {t('Copiază link', 'Copy link')}
                </button>
                {p.isPublic && (
                  <a href={`/p/${encodeURIComponent(p.id)}`} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-sm border text-[11px] font-semibold uppercase tracking-widest touch-manipulation ${ui.btnGhost}`}>
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden /> {t('Deschide', 'Open')}
                  </a>
                )}
                <button type="button" onClick={() => openInStudio(p)} className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-sm text-[11px] font-semibold uppercase tracking-widest cursor-pointer touch-manipulation ${ui.muted}`}>
                  <Layers className="w-3.5 h-3.5" aria-hidden /> Studio
                </button>
                {profile.canEditCompany && (
                  <a href="/b2b" className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-sm text-[11px] font-semibold uppercase tracking-widest touch-manipulation ${ui.muted}`}>
                    <HardHat className="w-3.5 h-3.5" aria-hidden /> B2B
                  </a>
                )}
              </div>

              <ProcurementList
                items={p.procurementItems ?? []}
                isDark={isDark}
                lang={lang}
                persisted={p.procurementPersisted ?? true}
                onBackfill={async () => {
                  const r = await backfillProcurement(p.id);
                  if (r?.persisted) onProjectChange({ ...p, procurementItems: r.items, procurementTotal: r.total, procurementPersisted: true });
                  else setNote({ kind: 'error', text: t('Lista nu a putut fi salvată (rulează migrarea 006).', 'The list could not be saved (run migration 006).') });
                  return !!r?.persisted;
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
