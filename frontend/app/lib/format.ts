// app/lib/format.ts
// Formatare comună pentru piața românească (convenția `ro-RO`: punct la mii, virgulă zecimală).
//
// MONEDA: toate sumele calculate și stocate (catalog, listă de materiale, devize B2B, API, baza de date)
// rămân în EURO — nimic nu se rescrie. Interfața le AFIȘEAZĂ în lei, convertite cu un singur curs fix
// (`EUR_TO_RON`). Câmpurile editabile în lei se convertesc înapoi cu `fromRon` înainte de salvare.
// Excepție: prețurile abonamentelor rămân în € (Stripe încasează în EUR).

/** Curs fix orientativ EUR → RON folosit la afișare (actualizează-l aici, într-un singur loc). */
export const EUR_TO_RON = 5;

/** Moneda afișată în interfață. */
export const DISPLAY_CURRENCY = 'RON' as const;
export const CURRENCY_SUFFIX = 'lei';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Sumă stocată în EUR → lei (rotunjit la 2 zecimale). */
export function toRon(eur: number): number {
  return Number.isFinite(eur) ? round2(eur * EUR_TO_RON) : 0;
}

/** Sumă introdusă în lei → EUR pentru stocare (nerotunjit, ca dus-întorsul să fie stabil). */
export function fromRon(ron: number): number {
  return Number.isFinite(ron) ? ron / EUR_TO_RON : 0;
}

/** Data salvată a unui proiect, în format `ro-RO`. Proiectele vechi pot avea text liber: îl returnăm neschimbat. */
export function formatProjectDate(savedDate: string): string {
  const parsedDate = new Date(savedDate);
  if (Number.isNaN(parsedDate.getTime())) {
    return savedDate;
  }
  return parsedDate.toLocaleDateString('ro-RO');
}

/**
 * Sumă stocată în EUR, afișată în lei: `ro-RO` + sufixul „ lei" (ex. 1450 € → „7.250 lei").
 * `options` controlează doar zecimalele (implicit maximum 2; ex. `{ maximumFractionDigits: 0 }` pentru totaluri).
 */
export function formatLei(eur: number, options?: Intl.NumberFormatOptions): string {
  return `${toRon(eur).toLocaleString('ro-RO', { maximumFractionDigits: 2, ...options })} ${CURRENCY_SUFFIX}`;
}

/** Sumă deja în lei (fără conversie), format `ro-RO`. */
export function formatRonValue(ron: number, options?: Intl.NumberFormatOptions): string {
  return `${(Number.isFinite(ron) ? ron : 0).toLocaleString('ro-RO', { maximumFractionDigits: 2, ...options })} ${CURRENCY_SUFFIX}`;
}

/** Cantitate (m², ml, buc.) în `ro-RO`, cu cel mult `maxFractionDigits` zecimale. */
export function formatQuantity(value: number, maxFractionDigits: number): string {
  return value.toLocaleString('ro-RO', { maximumFractionDigits: maxFractionDigits });
}
