// app/components/portal/ClientStatusBadge.tsx — starea aprobării clientului, monocrom.
// Ierarhie fără culoare: aprobat = plin (cerneală), modificări = contur accentuat, în așteptare = contur discret.
import React from 'react';
import { Check, Clock, PencilLine } from 'lucide-react';
import type { ClientStatus } from '@/app/lib/database.types';
import { EYEBROW } from '@/app/lib/theme/skin';
import { tr } from '@/app/lib/i18n';
import type { Language } from '@/app/types';

export const CLIENT_STATUS_LABELS: Record<ClientStatus, { ro: string; en: string }> = {
  pending: { ro: 'În așteptare', en: 'Pending' },
  approved: { ro: 'Aprobat de client', en: 'Approved by client' },
  changes_requested: { ro: 'Modificări solicitate', en: 'Changes requested' },
};

export default function ClientStatusBadge({
  status,
  isDark,
  lang,
  className = '',
}: {
  status: ClientStatus;
  isDark: boolean;
  lang: Language;
  className?: string;
}) {
  const tone =
    status === 'approved'
      ? isDark ? 'bg-[#C94A6A] text-white border-[#C94A6A]' : 'bg-[#5C1628] text-white border-[#5C1628]'
      : status === 'changes_requested'
        ? isDark ? 'text-[#F5F2EF] border-[#F5F2EF]' : 'text-[#1B1416] border-[#1B1416]'
        : isDark ? 'border-[#2E2427] text-[#B5A9AC]' : 'border-[#E8E2E0] text-[#685D60]';
  const Icon = status === 'approved' ? Check : status === 'changes_requested' ? PencilLine : Clock;
  const label = CLIENT_STATUS_LABELS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-full border ${EYEBROW} tracking-[0.14em] ${tone} ${className}`}>
      <Icon className="w-3 h-3" aria-hidden />
      {tr(lang, label.ro, label.en)}
    </span>
  );
}
