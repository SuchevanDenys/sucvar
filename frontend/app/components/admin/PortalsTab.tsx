// app/components/admin/PortalsTab.tsx — Tab 3: moderarea portalurilor publice /p/[id].
// „Dezactivează linkul" = POST /api/admin/public-projects/{id}/unpublish (is_public = false, jurnalizat);
// linkul clientului răspunde imediat 404 („Proiect privat sau inexistent").
"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Search } from 'lucide-react';
import { fetchPublicProjects, unpublishProject, type AdminPublicProject, type Paged } from '@/app/lib/admin/client';
import type { ClientStatus } from '@/app/lib/database.types';
import { EYEBROW } from '@/app/lib/theme/skin';
import { Badge, Button, ErrorLine, Pager, errorMessage, formatDateTime, inputClass, type AdminCtx } from './shared';

type State = { kind: 'loading' } | { kind: 'ready'; data: Paged<AdminPublicProject> } | { kind: 'error'; message: string };

export default function PortalsTab({ ctx }: { ctx: AdminCtx }) {
  const { sk, t } = ctx;
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState({ q: '', page: 1 });
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPublicProjects(query.q, query.page)
      .then((data) => alive && setState({ kind: 'ready', data }))
      .catch((e: unknown) => alive && setState({ kind: 'error', message: errorMessage(e, ctx) }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const load = (next: { q: string; page: number }) => {
    setState({ kind: 'loading' });
    setQuery(next);
  };

  const disable = async (id: string) => {
    setBusyId(id);
    setActionError(null);
    try {
      await unpublishProject(id);
      setState((s) =>
        s.kind === 'ready' ? { kind: 'ready', data: { ...s.data, total: Math.max(0, s.data.total - 1), items: s.data.items.filter((p) => p.id !== id) } } : s,
      );
    } catch (e) {
      setActionError(errorMessage(e, ctx));
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  };

  const statusLabel: Record<ClientStatus, string> = {
    pending: t('În așteptare', 'Pending'),
    approved: t('Aprobat', 'Approved'),
    changes_requested: t('Modificări cerute', 'Changes requested'),
  };

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          load({ q: search, page: 1 });
        }}
      >
        <div className="relative flex-1 min-w-[220px]">
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${sk.dim}`} aria-hidden />
          <input
            type="search"
            value={search}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('Titlu, email proprietar sau ID…', 'Title, owner email or ID…')}
            aria-label={t('Caută proiecte publice', 'Search public projects')}
            className={`${inputClass(ctx)} pl-9`}
          />
        </div>
        <Button ctx={ctx} type="submit">{t('Caută', 'Search')}</Button>
      </form>

      {state.kind === 'error' && <ErrorLine ctx={ctx} message={state.message} />}
      <ErrorLine ctx={ctx} message={actionError} />

      {state.kind === 'loading' && (
        <div className={`grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-px border ${sk.gap} ${sk.line}`} aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={`h-72 animate-pulse ${sk.cell}`} />
          ))}
        </div>
      )}

      {state.kind === 'ready' && state.data.items.length === 0 && (
        <p className={`border px-4 py-10 text-center text-sm ${sk.card} ${sk.muted}`}>{t('Niciun portal public activ.', 'No active public portals.')}</p>
      )}

      {state.kind === 'ready' && state.data.items.length > 0 && (
        <ul className={`grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-px border ${sk.gap} ${sk.line}`}>
          {state.data.items.map((p) => (
            <li key={p.id} className={`flex flex-col ${sk.cell}`}>
              <div className={`aspect-[4/3] overflow-hidden ${ctx.isDark ? 'bg-[#1C1C1F]' : 'bg-[#F5F5F5]'}`}>
                {p.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbnail} alt={p.title} loading="lazy" className="w-full h-full object-contain" />
                ) : (
                  <div className={`w-full h-full flex items-center justify-center ${EYEBROW} ${sk.dim}`}>{t('Fără imagine', 'No image')}</div>
                )}
              </div>
              <div className="p-4 flex-1 flex flex-col gap-3">
                <div className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium leading-snug">{p.title}</p>
                    <Badge ctx={ctx} solid={p.clientStatus === 'approved'}>{statusLabel[p.clientStatus]}</Badge>
                  </div>
                  <p className={`text-xs truncate ${sk.muted}`}>{p.ownerEmail ?? '—'}</p>
                  <p className={`text-[11px] tabular-nums ${sk.dim}`}>
                    {formatDateTime(p.createdAt, ctx.lang)}
                    {p.clientReviewedAt && ` · ${t('revizuit', 'reviewed')} ${formatDateTime(p.clientReviewedAt, ctx.lang)}`}
                  </p>
                  {p.clientFeedback && <p className={`text-xs line-clamp-2 ${sk.muted}`}>“{p.clientFeedback}”</p>}
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <Link
                    href={`/p/${encodeURIComponent(p.id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1.5 h-9 px-3 ${EYEBROW} ${sk.btnGhost}`}
                  >
                    <ExternalLink className="w-3 h-3" />
                    /p/{p.id.slice(0, 8)}
                  </Link>
                  {confirmId === p.id ? (
                    <>
                      <Button ctx={ctx} danger busy={busyId === p.id} onClick={() => disable(p.id)}>
                        {t('Confirmă', 'Confirm')}
                      </Button>
                      <Button ctx={ctx} ghost disabled={busyId === p.id} onClick={() => setConfirmId(null)}>
                        {t('Anulează', 'Cancel')}
                      </Button>
                    </>
                  ) : (
                    <Button ctx={ctx} danger disabled={busyId !== null} onClick={() => setConfirmId(p.id)}>
                      {t('Dezactivează linkul public', 'Disable public link')}
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {state.kind === 'ready' && (
        <Pager ctx={ctx} page={state.data.page} pageSize={state.data.pageSize} total={state.data.total} onPage={(page) => load({ q: query.q, page })} />
      )}
    </div>
  );
}
