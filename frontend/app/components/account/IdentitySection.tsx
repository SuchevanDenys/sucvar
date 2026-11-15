// 01 · Identitate & date personale — avatar/inițiale, nume editabil, email, data înregistrării, deconectare.
"use client";

import React, { useState } from 'react';
import { LogOut } from 'lucide-react';
import { updateProfile, type ProfileView } from '@/app/lib/profile/client';
import { EYEBROW_UI, Field, Notice, PrimaryButton, Section, formatDate, inputClass, type Ui } from './shared';
import { tr } from '@/app/lib/i18n';
import type { Language } from '@/app/types';

export default function IdentitySection({
  profile, ui, lang, onSaved, onSignOut,
}: { profile: ProfileView; ui: Ui; lang: Language; onSaved: (p: ProfileView) => void; onSignOut: () => void }) {
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const [name, setName] = useState(profile.account.fullName ?? '');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const dirty = name.trim() !== (profile.account.fullName ?? '');

  const save = async () => {
    setBusy(true);
    setNote(null);
    const r = await updateProfile({ fullName: name.trim() || null });
    setBusy(false);
    if (r.status === 'ok') {
      onSaved(r.data);
      setNote({ kind: 'ok', text: t('Numele a fost salvat.', 'Name saved.') });
    } else {
      setNote({ kind: 'error', text: r.status === 'auth' ? t('Sesiunea a expirat.', 'Session expired.') : r.message });
    }
  };

  const avatar = profile.account.avatarUrl && !imgFailed;
  return (
    <Section index="01" title={t('Identitate', 'Identity')} ui={ui}>
      <div className="flex flex-wrap items-center gap-5">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element -- avatar extern (Google), dimensiune fixă
          <img
            src={profile.account.avatarUrl!}
            alt=""
            width={64}
            height={64}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className={`h-16 w-16 rounded-full object-cover border ${ui.line}`}
          />
        ) : (
          <span aria-hidden className={`h-16 w-16 rounded-full inline-flex items-center justify-center font-mono text-lg tracking-wider border ${ui.line} ${ui.soft}`}>
            {profile.account.initials}
          </span>
        )}
        <div className="min-w-0 space-y-1">
          <p className="text-lg font-semibold truncate">{profile.account.fullName || profile.account.email}</p>
          <p className={`text-xs font-mono truncate ${ui.muted}`}>{profile.account.email}</p>
          <p className={`${EYEBROW_UI} ${ui.muted}`}>
            {t('Membru din', 'Member since')} {formatDate(profile.account.createdAt, lang)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t('Nume complet', 'Full name')} ui={ui}>
          <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoComplete="name" className={inputClass(ui)} />
        </Field>
        <Field label="Email" ui={ui}>
          <input value={profile.account.email} readOnly className={`${inputClass(ui, true)} ${ui.muted}`} />
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <PrimaryButton ui={ui} busy={busy} disabled={!dirty} onClick={save}>{t('Salvează numele', 'Save name')}</PrimaryButton>
          {note && <Notice kind={note.kind}>{note.text}</Notice>}
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className={`inline-flex items-center gap-2 h-10 px-4 rounded-sm border text-[11px] font-semibold uppercase tracking-widest cursor-pointer touch-manipulation ${ui.btnGhost}`}
        >
          <LogOut className="w-3.5 h-3.5" aria-hidden />
          {t('Deconectare', 'Sign out')}
        </button>
      </div>
    </Section>
  );
}
