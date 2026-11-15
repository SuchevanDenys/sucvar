'use client'; // Error boundaries must be Client Components

// Granița de eroare pentru toate paginile (sub layout-ul rădăcină). Next 16: `retry()` reîncearcă
// randarea segmentului; detaliile tehnice rămân în consolă (digest = id-ul erorii din jurnalul serverului).
import { useEffect } from 'react';
import StatusPage from '@/app/components/layout/StatusPage';

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error('[SUCVAR] UI error', error.digest ?? '', error);
  }, [error]);

  return (
    <StatusPage
      code={error.digest ? `ERR · ${error.digest}` : 'ERR'}
      titleRo="A apărut o eroare neprevăzută"
      titleEn="Something went wrong"
      textRo="Datele tale salvate nu au fost afectate. Încearcă din nou; dacă problema persistă, reîncarcă pagina."
      textEn="Your saved data was not affected. Try again; if the problem persists, reload the page."
      action={{ labelRo: 'Încearcă din nou', labelEn: 'Try again', onClick: retry }}
    />
  );
}
