// 02 · Firmă & setări implicite B2B — antetul devizelor (company_profiles) + monedă / TVA / marjă (profiles).
"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import type { Party } from '@/app/lib/b2b/exports';
import { EMPTY_SELLER } from '@/app/lib/b2b/portfolio';
import { updateProfile, type Currency, type ProfileView } from '@/app/lib/profile/client';
import { Field, Notice, PrimaryButton, Section, inputClass, type Ui } from './shared';
import { tr } from '@/app/lib/i18n';
import { VAT_PRESETS } from '@/app/lib/b2b/estimate';
import type { Language } from '@/app/types';

export default function CompanySection({
  profile, ui, lang, onSaved,
}: { profile: ProfileView; ui: Ui; lang: Language; onSaved: (p: ProfileView) => void }) {
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const [company, setCompany] = useState<Required<Party>>(profile.company ?? EMPTY_SELLER);
  // Câmpurile numerice rămân text cât timp utilizatorul scrie („19,5”); se validează la salvare
  const [currency, setCurrency] = useState<Currency>(profile.defaults.currency);
  const [vatText, setVatText] = useState(String(profile.defaults.vatRate));
  const [marginText, setMarginText] = useState(String(profile.defaults.marginPercent));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const canEdit = profile.canEditCompany;

  const set = (key: keyof Party) => (e: React.ChangeEvent<HTMLInputElement>) => setCompany((c) => ({ ...c, [key]: e.target.value }));
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v.replace(',', '.')));

  const save = async () => {
    const vatRate = num(vatText);
    const marginPercent = num(marginText);
    if (!(vatRate >= 0 && vatRate <= 100) || !(marginPercent >= 0 && marginPercent <= 100)) {
      setNote({ kind: 'error', text: t('TVA și marja trebuie să fie între 0 și 100%.', 'VAT and margin must be between 0 and 100%.') });
      return;
    }
    setBusy(true);
    setNote(null);
    const r = await updateProfile({ defaults: { currency, vatRate, marginPercent }, ...(canEdit ? { company } : {}) });
    setBusy(false);
    if (r.status === 'ok') {
      onSaved(r.data);
      setNote({ kind: 'ok', text: t('Setările au fost salvate.', 'Settings saved.') });
    } else {
      setNote({ kind: 'error', text: r.status === 'auth' ? t('Sesiunea a expirat.', 'Session expired.') : r.message });
    }
  };

  return (
    <Section
      index="02"
      title={t('Firmă & setări B2B', 'Company & B2B defaults')}
      ui={ui}
      aside={!canEdit && <span className={`text-[10px] font-mono uppercase tracking-widest ${ui.muted}`}>{t('Doar Business', 'Business only')}</span>}
    >
      {!profile.migrated && (
        <Notice kind="info">
          {t('Setările implicite se pot salva după rularea migrării 004 în Supabase (backend/db/migrations).', 'Defaults can be saved after running migration 004 in Supabase (backend/db/migrations).')}
        </Notice>
      )}

      <fieldset disabled={!canEdit} className="grid grid-cols-1 sm:grid-cols-2 gap-4 disabled:opacity-70">
        <Field label={t('Nume firmă', 'Company name')} ui={ui}><input value={company.name} onChange={set('name')} maxLength={200} className={inputClass(ui)} /></Field>
        <Field label={t('Cod TVA intracomunitar', 'EU VAT number', 'N° TVA intracommunautaire')} ui={ui}><input value={company.vatId} onChange={set('vatId')} placeholder="FR64443061841" maxLength={40} className={inputClass(ui, true)} /></Field>
        <Field label={t('SIREN / SIRET', 'SIREN / SIRET (company ID)', 'SIREN / SIRET')} ui={ui}><input value={company.regNo} onChange={set('regNo')} placeholder="443 061 841 00047" maxLength={40} className={inputClass(ui, true)} /></Field>
        <Field label={t('Telefon', 'Phone')} ui={ui}><input type="tel" value={company.phone} onChange={set('phone')} maxLength={40} className={inputClass(ui)} /></Field>
        <Field label={t('Sediul firmei', 'Company address')} ui={ui} wide><input value={company.address} onChange={set('address')} maxLength={300} className={inputClass(ui)} /></Field>
        <Field label="IBAN" ui={ui}><input value={company.iban} onChange={set('iban')} placeholder="FR76 3000 6000 0112 3456 7890 189" maxLength={50} className={inputClass(ui, true)} /></Field>
        <Field label={t('Banca', 'Bank')} ui={ui}><input value={company.bank} onChange={set('bank')} maxLength={100} className={inputClass(ui)} /></Field>
      </fieldset>
      {!canEdit && (
        <p className={`text-xs ${ui.muted}`}>
          {t('Datele firmei apar pe devizele B2B și sunt disponibile în planul Business. ', 'Company details appear on B2B quotes and require the Business plan. ')}
          <Link href="/checkout?plan=agency" className="underline underline-offset-4">{t('Vezi planul Business', 'See the Business plan')}</Link>
        </p>
      )}

      <div className={`grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t ${ui.line}`}>
        <Field label={t('Monedă implicită', 'Default currency')} ui={ui}>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value === 'RON' ? 'RON' : 'EUR')}
            className={`${inputClass(ui)} cursor-pointer`}
          >
            <option value="EUR">EUR (€)</option>
            <option value="RON">RON (lei)</option>
          </select>
        </Field>
        <Field label={t('TVA implicit (%)', 'Default VAT (%)')} ui={ui}>
          {/* Champ en premier : c'est le contrôle associé au <label> (un clic sur le libellé ne choisit pas de taux). */}
          <input inputMode="decimal" value={vatText} onChange={(e) => setVatText(e.target.value)} className={inputClass(ui, true)} />
          {/* TVA en 1 clic : 20 % (taux normal) ou 10 % (rénovation > 2 ans) */}
          <div role="group" aria-label={t('Cota TVA', 'VAT rate', 'Taux de TVA')} className="flex gap-1.5 mt-1.5">
            {VAT_PRESETS.map((p) => {
              const on = num(vatText) === p.pct;
              return (
                <button
                  key={p.pct}
                  type="button"
                  onClick={() => setVatText(String(p.pct))}
                  aria-pressed={on}
                  title={t(p.hintRo, p.hintEn, p.hintFr)}
                  className={`flex-1 h-8 px-2 border text-[11px] font-mono tabular-nums cursor-pointer touch-manipulation transition-colors ${ui.line} ${
                    on ? 'bg-[#111111] text-white border-[#111111] dark:bg-[#F5F5F5] dark:text-[#0B0B0C] dark:border-[#F5F5F5]' : ui.muted
                  }`}
                >
                  {p.pct} %
                </button>
              );
            })}
          </div>
        </Field>
        <Field label={t('Marjă implicită (%)', 'Default margin (%)')} ui={ui}>
          <input inputMode="decimal" value={marginText} onChange={(e) => setMarginText(e.target.value)} className={inputClass(ui, true)} />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <PrimaryButton ui={ui} busy={busy} onClick={save}>{t('Salvează setările', 'Save settings')}</PrimaryButton>
        {note && <Notice kind={note.kind}>{note.text}</Notice>}
      </div>
    </Section>
  );
}
