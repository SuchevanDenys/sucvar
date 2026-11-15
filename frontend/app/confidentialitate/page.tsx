import type { Metadata } from 'next';
import LegalPage from '@/app/components/legal/LegalPage';
import { PRIVACY } from '@/app/components/legal/content';

export const metadata: Metadata = {
  title: 'SUCVAR | Politica de confidențialitate',
  description: 'Cum prelucrează SUCVAR datele personale (GDPR).',
  alternates: { canonical: '/confidentialitate' },
};

export default function Page() {
  return <LegalPage titleRo="Politica de confidențialitate" titleEn="Privacy policy" sections={PRIVACY} />;
}
