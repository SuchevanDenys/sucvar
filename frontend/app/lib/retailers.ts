// app/lib/retailers.ts
// Piața românească: magazine, rutare și linkuri de căutare.
// Oglindă EXACTĂ a backend/src/Sucvar.Domain/Procurement/RomanianRetail.cs (aceeași tabelă, aceleași reguli) —
// modul autonom, fără importuri, ca fixture-urile golden ale backend-ului să poată fi regenerate cu Node.
//
// Interogarea din lista de materiale (`query`) este deja în română, fără diacritice ("parchet stejar"),
// deci este folosită ca atare în link.
// Rutare: materiale de construcție (gips-carton, polistiren, șapă, parchet, gresie, faianță, tencuieli, lemn)
// → Dedeman, Hornbach, Brico Dépôt; finisaje și decor → Dedeman, Leroy Merlin, Hornbach;
// mobilier → IKEA, Mobexpert, Dedeman; iluminat → IKEA, Dedeman, Leroy Merlin.

export type RetailerId = 'dedeman' | 'leroymerlin' | 'hornbach' | 'bricodepot' | 'ikea' | 'mobexpert';
export type ProcCategory = 'construction' | 'furniture' | 'lighting' | 'outdoor';
export type RetailerLane = 'trade' | 'finish' | 'furniture' | 'lighting' | 'outdoorTrade' | 'outdoor';

export interface RetailerLink {
  retailer: RetailerId;
  label: string;
  url: string;
}

export const RETAILERS: Record<RetailerId, { label: string; domain: string; build: (q: string) => string }> = {
  dedeman: { label: 'Dedeman', domain: 'dedeman.ro', build: (q) => `https://www.dedeman.ro/ro/catalogsearch/result/?q=${q}` },
  leroymerlin: { label: 'Leroy Merlin', domain: 'leroymerlin.ro', build: (q) => `https://www.leroymerlin.ro/search?q=${q}` },
  hornbach: { label: 'Hornbach', domain: 'hornbach.ro', build: (q) => `https://www.hornbach.ro/s/${q}` },
  bricodepot: { label: 'Brico Dépôt', domain: 'bricodepot.ro', build: (q) => `https://www.bricodepot.ro/cautare/?q=${q}` },
  ikea: { label: 'IKEA România', domain: 'ikea.com/ro', build: (q) => `https://www.ikea.com/ro/ro/search/?q=${q}` },
  mobexpert: { label: 'Mobexpert', domain: 'mobexpert.ro', build: (q) => `https://mobexpert.ro/search?q=${q}` },
};

export const LANES: Record<RetailerLane, RetailerId[]> = {
  trade: ['dedeman', 'hornbach', 'bricodepot'],
  finish: ['dedeman', 'leroymerlin', 'hornbach'],
  furniture: ['ikea', 'mobexpert', 'dedeman'],
  lighting: ['ikea', 'dedeman', 'leroymerlin'],
  outdoorTrade: ['dedeman', 'bricodepot', 'hornbach'],
  outdoor: ['dedeman', 'leroymerlin', 'hornbach'],
};

const TRADE_STEMS = ["gips carton", "polistiren", "vata", "sapa", "mortar", "adeziv", "parchet", "gresie", "faianta", "beton", "tencuiala", "amorsa", "membrana", "hidroizolatie", "rigla", "dale", "pamant", "bordura", "lemn lamelat", "grinzi", "gabion", "plinta", "glaf", "deck", "pietris", "travertin", "piatra", "terrazzo", "caramida", "microciment"];

const stripDiacritics = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

export function isTrade(query: string): boolean {
  const n = stripDiacritics(query).toLowerCase();
  return TRADE_STEMS.some((s) => n.includes(s));
}

export function laneFor(procCategory: string, query: string): RetailerLane {
  const trade = isTrade(query);
  switch (procCategory) {
    case 'construction':
      return trade ? 'trade' : 'finish';
    case 'furniture':
      return 'furniture';
    case 'lighting':
      return 'lighting';
    case 'outdoor':
      return trade ? 'outdoorTrade' : 'outdoor';
    default:
      return 'finish';
  }
}

export function buildRetailerLinks(query: string, category: string): RetailerLink[] {
  const ro = query.trim().slice(0, 120);
  const q = encodeURIComponent(ro);
  return LANES[laneFor(category, ro)].map((id) => ({ retailer: id, label: RETAILERS[id].label, url: RETAILERS[id].build(q) }));
}
