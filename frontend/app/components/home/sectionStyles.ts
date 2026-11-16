// app/components/home/sectionStyles.ts
// (Not `layout.ts`: inside `app/` that filename is reserved by the App Router and would become a route layout.)
// Convenții de layout comune secțiunilor de pe pagina principală.

/**
 * Ținta ancorelor: conteneurul de conținut (nu secțiunea, cu padding-ul ei mare), decalat față de bara de
 * navigare lipicioasă (h-16) + 32 px de respirație = `scroll-mt-24`. `lib/scroll.ts` măsoară înălțimea reală a
 * antetului și realiniază după derulare; clasa aceasta este doar soluția nativă de rezervă (fără JS).
 */
export const ANCHOR_OFFSET = 'scroll-mt-24';

/** Spațierea verticală și linia de separare a unei secțiuni numerotate (§01 … §06). */
export const sectionSpacing = (lineClass: string): string => `border-t py-24 lg:py-32 ${lineClass}`;
