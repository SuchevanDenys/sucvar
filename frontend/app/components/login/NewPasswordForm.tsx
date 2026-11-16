// app/components/login/NewPasswordForm.tsx
// /login — formularul „Alege o parolă nouă", afișat după ce utilizatorul revine din emailul de resetare
// (sesiune Supabase de tip PASSWORD_RECOVERY). Componentă controlată: starea și trimiterea rămân în pagină.
"use client";

import React from 'react';
import { tr } from '@/app/lib/i18n';
import { getUi } from '@/app/lib/theme/tokens';
import type { Language } from '@/app/types';

interface NewPasswordFormProps {
  lang: Language;
  isDark: boolean;
  password: string;
  confirmPassword: string;
  showPassword: boolean;
  isSubmitting: boolean;
  /** Mesajele de eroare / stare ale paginii (aceleași ca la autentificare). */
  messages: React.ReactNode;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}

export default function NewPasswordForm({
  lang, isDark, password, confirmPassword, showPassword, isSubmitting, messages, onPasswordChange, onConfirmPasswordChange, onSubmit,
}: NewPasswordFormProps) {
  const ui = getUi(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const eyebrowClass = `text-[11px] uppercase tracking-[0.28em] ${ui.muted}`;
  const fieldClass = `w-full h-11 px-3 rounded-sm border bg-transparent text-base outline-none transition-colors ${ui.input}`;

  return (
    <div className={`max-w-md mx-auto p-8 rounded-md border space-y-6 ${ui.card}`}>
      <div className="space-y-2">
        <p className={eyebrowClass}>{t('Resetare parolă', 'Password reset')}</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('Alege o parolă nouă', 'Choose a new password')}
        </h1>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="newPassword" className="block text-xs font-medium mb-1">
            {t('Parolă nouă (minim 6 caractere)', 'New password (min 6 characters)')}
          </label>
          <input
            id="newPassword"
            type={showPassword ? 'text' : 'password'}
            required
            minLength={6}
            autoComplete="new-password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="newPasswordConfirm" className="block text-xs font-medium mb-1">
            {t('Confirmă parola', 'Confirm password')}
          </label>
          <input
            id="newPasswordConfirm"
            type={showPassword ? 'text' : 'password'}
            required
            minLength={6}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => onConfirmPasswordChange(e.target.value)}
            className={fieldClass}
          />
        </div>
        {messages}
        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full h-12 rounded-sm text-xs font-semibold uppercase tracking-widest transition-colors disabled:opacity-50 cursor-pointer touch-manipulation ${ui.btn}`}
        >
          {isSubmitting
            ? t('Se procesează...', 'Processing...')
            : t('Salvează parola', 'Save password')}
        </button>
      </form>
    </div>
  );
}
