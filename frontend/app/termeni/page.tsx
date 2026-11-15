import type { Metadata } from 'next';
import LegalPage from '@/app/components/legal/LegalPage';
import { TERMS } from '@/app/components/legal/content';

export const metadata: Metadata = {
  title: 'SUCVAR | Termeni și condiții',
  description: 'Termenii de utilizare ai platformei SUCVAR.',
  alternates: { canonical: '/termeni' },
};

export default function Page() {
  return <LegalPage titleRo="Termeni și condiții" titleEn="Terms and conditions" sections={TERMS} />;
}
