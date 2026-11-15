'use client'; // Error boundaries must be Client Components

// Eroare în layout-ul rădăcină: înlocuiește tot documentul, deci are propriile <html>/<body> și stiluri
// inline (CSS-ul global nu se încarcă aici — vezi documentația Next 16, error.md → global-error).
import { useEffect } from 'react';

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error('[SUCVAR] fatal UI error', error.digest ?? '', error);
  }, [error]);

  return (
    <html lang="fr">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#0B0B0C', color: '#F5F5F5' }}>
        <title>SUCVAR | Erreur</title>
        <main style={{ maxWidth: 520, margin: '0 auto', padding: '96px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 11, letterSpacing: '0.28em', textTransform: 'uppercase', color: '#A1A1AA' }}>
            {error.digest ? `ERR · ${error.digest}` : 'ERR'}
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 600 }}>L’application n’a pas pu être chargée</h1>
          <p style={{ fontSize: 14, color: '#A1A1AA' }}>Vos données enregistrées n’ont pas été affectées.</p>
          <button
            type="button"
            onClick={() => retry()}
            style={{ marginTop: 16, height: 44, padding: '0 24px', border: 0, borderRadius: 2, background: '#F5F5F5', color: '#111111', fontWeight: 600, cursor: 'pointer' }}
          >
            Réessayer
          </button>
        </main>
      </body>
    </html>
  );
}
