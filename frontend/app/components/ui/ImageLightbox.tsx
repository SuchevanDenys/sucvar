// app/components/ui/ImageLightbox.tsx
// Previzualizare pe tot ecranul: imaginea întreagă (object-contain, fără decupare), comutator Înainte / După,
// descărcare. Se închide cu Esc, click pe fundal sau ✕; blochează derularea paginii cât timp e deschisă.
"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';

interface ImageLightboxProps {
  open: boolean;
  onClose: () => void;
  /** Imaginea principală (de obicei randarea). */
  src: string;
  /** Opțional: fotografia originală — activează comutatorul Înainte / După. */
  beforeSrc?: string | null;
  alt?: string;
  labels?: { before: string; after: string; close: string; download: string };
  downloadName?: string;
}

const DEFAULT_LABELS = { before: 'Înainte', after: 'După', close: 'Închide', download: 'Descarcă' };

export default function ImageLightbox({ open, onClose, src, beforeSrc, alt = '', labels = DEFAULT_LABELS, downloadName = 'sucvar-design.jpg' }: ImageLightboxProps) {
  const [showBefore, setShowBefore] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (beforeSrc && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) setShowBefore((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose, beforeSrc]);

  if (!open) return null;
  const current = showBefore && beforeSrc ? beforeSrc : src;
  const chip = 'inline-flex h-9 items-center gap-2 rounded-full px-4 text-xs font-medium transition-colors cursor-pointer';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt || labels.after}
      className="fixed inset-0 z-[100] flex flex-col bg-[#110D0F]/90 backdrop-blur-md print:hidden"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 h-16 shrink-0" onClick={(e) => e.stopPropagation()}>
        {beforeSrc ? (
          <div role="group" className="inline-flex rounded-full border border-white/10 border-t-white/20 bg-white/[0.06] p-1 backdrop-blur-md shadow-[0_12px_32px_-16px_rgba(0,0,0,0.8)]">
            <button type="button" aria-pressed={showBefore} onClick={() => setShowBefore(true)} className={`${chip} h-7 ${showBefore ? 'bg-[#C94A6A] text-white' : 'text-white/75 hover:text-white'}`}>
              {labels.before}
            </button>
            <button type="button" aria-pressed={!showBefore} onClick={() => setShowBefore(false)} className={`${chip} h-7 ${!showBefore ? 'bg-[#C94A6A] text-white' : 'text-white/75 hover:text-white'}`}>
              {labels.after}
            </button>
          </div>
        ) : <span />}
        <div className="flex items-center gap-2">
          <a href={current} download={downloadName} className={`${chip} border border-white/10 border-t-white/20 bg-white/[0.06] text-white backdrop-blur-md hover:bg-white/15 hover:border-[#C94A6A]/50`}>
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{labels.download}</span>
          </a>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={labels.close} className={`${chip} w-9 justify-center px-0 bg-[#F5F2EF] text-[#1B1416] hover:bg-white`}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center px-3 pb-4 sm:px-6 sm:pb-6">
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
        <img
          src={current}
          alt={alt}
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full object-contain rounded-md ring-1 ring-white/10 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.8)] select-none"
          draggable={false}
        />
      </div>
    </div>
  );
}
