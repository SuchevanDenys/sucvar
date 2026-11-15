import type { Metadata } from 'next';
import LegalPage from '@/app/components/legal/LegalPage';
import { REFUNDS } from '@/app/components/legal/content';

export const metadata: Metadata = {
  title: 'SUCVAR | Politica de anulare și rambursare',
  description: 'Anularea abonamentului, dreptul de retragere și rambursări.',
  alternates: { canonical: '/rambursare' },
};

export default function Page() {
  return <LegalPage titleRo="Politica de anulare și rambursare" titleEn="Cancellation and refund policy" sections={REFUNDS} />;
}
