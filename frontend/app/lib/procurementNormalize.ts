// app/lib/procurementNormalize.ts — normalizare la citire pentru listele de materiale salvate.
//
// Proiectele generate înainte de trecerea pe piața românească au în `procurement_items`
// (Supabase) și în localStorage linkuri către magazine franceze (leroymerlin.fr, castorama.fr,
// manomano.fr, pointp.fr, ikea.com/fr …). Un URL salvat NU este afișat niciodată: la fiecare citire
// linkurile se reconstruiesc din `query` + `procCategory` cu `buildRetailerLinks` (Dedeman,
// Leroy Merlin România, Hornbach, Brico Dépôt, IKEA România, Mobexpert) — aceeași regulă ca
// backend/src/Sucvar.Domain/Procurement/ProcurementStore.cs.
//
// Interogările rămase în franceză (linii personalizate) sunt traduse înapoi în română cu tabela
// fostului `FrenchRetail.cs`; dacă nu sunt cunoscute, se folosește titlul românesc fără diacritice.
import type { BomItem, BomUnit } from '@/app/lib/procurement';
import { buildRetailerLinks, RETAILERS, type ProcCategory, type RetailerLink } from '@/app/lib/retailers';

const PROC_CATEGORIES: ReadonlySet<string> = new Set(['construction', 'furniture', 'lighting', 'outdoor']);
const UNITS: ReadonlySet<string> = new Set(['m²', 'ml', 'buc.']);

const stripDiacritics = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const KELVIN = /(\d{4})\s?k\b/;

/** Cheie: minuscule, fără diacritice, spații simple; temperatura de culoare devine `{k}k`. */
const legacyKey = (q: string) =>
  stripDiacritics(q).trim().toLowerCase().replace(/\s+/g, ' ').replace(/(\d{4})\s?k\b/g, '{k}k');

/** Interogare franceză (fostul FrenchRetail.QueryMap, inversat) → interogarea română a listei. */
const FR_TO_RO: Readonly<Record<string, string>> = {
  "canape 3 places": "canapea 3 locuri",
  "meuble tv": "comoda tv living",
  "meuble de cuisine": "corpuri bucatarie",
  "plan de travail cuisine": "blat bucatarie",
  "lit 160x200 avec sommier": "pat 160x200",
  "armoire portes coulissantes": "dulap dormitor usi glisante",
  "wc suspendu avec bati-support": "vas wc suspendat rezervor incastrat",
  "paroi de douche verre trempe": "cabina dus sticla securizata",
  "bureau 140x70": "birou 140x70",
  "fauteuil de bureau ergonomique": "scaun birou ergonomic",
  "banc a chaussures": "pantofar cu banca",
  "miroir d'entree portemanteau": "oglinda hol cuier",
  "canape convertible": "canapea extensibila",
  "etagere sous pente": "raft mansarda",
  "dressing modulable": "sistem dressing modular",
  "commode tiroirs": "comoda sertare",
  "table bistrot": "masa cafenea",
  "chaise chr empilable": "scaun cafenea horeca",
  "salon de jardin": "set mobilier gradina",
  "grand pot de fleurs exterieur": "ghivece mari exterior",
  "parquet chene huile": "parchet stejar uleiat",
  "peinture murale blanc casse mat": "vopsea lavabila alb cald",
  "sol stratifie chene gris": "parchet laminat stejar gri",
  "peinture murale blanche mate": "vopsea lavabila alba mata",
  "parquet contrecolle noyer": "parchet triplustratificat nuc",
  "peinture murale grise": "vopsea lavabila gri",
  "carrelage gres cerame effet beton 80x80": "gresie portelanata beton 80x80",
  "peinture murale blanche": "vopsea lavabila alba",
  "carrelage gres cerame noir mat": "gresie portelanata neagra mata",
  "peinture murale anthracite": "vopsea lavabila antracit",
  "parquet chene brosse": "parchet stejar natural periat",
  "peinture murale beige": "vopsea lavabila bej",
  "parquet massif chene": "parchet masiv stejar",
  "peinture murale creme": "vopsea lavabila crem",
  "peinture murale vert sauge": "vopsea lavabila verde salvie",
  "parquet chene blanchi": "parchet stejar albit",
  "peinture murale bleu clair": "vopsea lavabila albastru deschis",
  "carrelage effet beton": "gresie aspect beton",
  "peinture murale gris beton": "vopsea lavabila gri beton",
  "carrelage gres cerame effet beton": "gresie portelanata beton",
  "enduit decoratif effet beton": "amorsa decorativa aspect beton",
  "parquet chene naturel": "parchet stejar natural",
  "peinture murale verte": "vopsea lavabila verde",
  "sol stratifie": "parchet laminat",
  "peinture murale": "vopsea lavabila",
  "ragreage autonivelant": "sapa autonivelanta",
  "carrelage gres cerame 60x60 antiderapant": "gresie portelanata 60x60 antiderapanta",
  "faience murale 30x60": "faianta 30x60",
  "peinture salle de bain anti-humidite": "vopsea lavabila anti mucegai baie",
  "plinthe mdf 80 mm": "plinta mdf 80 mm",
  "plaque de platre ba13": "placa gips carton 12.5 mm",
  "ruban led {k}k profile aluminium": "banda led {k}k profil aluminiu",
  "spot led encastrable {k}k": "spot led incastrat {k}k",
  "isolant polystyrene expanse ite 100 mm": "polistiren expandat eps 100 10 cm",
  "enduit de facade siloxane": "tencuiala decorativa siliconica fatada",
  "appui de fenetre aluminium": "glaf exterior aluminiu",
  "lame de terrasse composite": "deck exterior wpc",
  "lambourde bois autoclave": "rigla lemn tratat autoclavizat",
  "applique led exterieure ip65 {k}k": "aplica led exterior ip65 {k}k",
  "dalle beton exterieure": "dale beton exterior",
  "gazon en rouleau": "gazon rulou",
  "terre vegetale": "pamant vegetal",
  "bordure de jardin": "bordura gradina",
  "borne led jardin {k}k": "baliza led gradina {k}k",
  "parquet chene baton rompu": "parchet in spic herringbone",
  "parquet chene point de hongrie": "parchet point de hongrie",
  "parquet chene": "parchet stejar",
  "parquet noyer": "parchet nuc",
  "carrelage terrazzo": "gresie terrazzo",
  "beton cire": "microciment",
  "carrelage effet marbre": "gresie aspect marmura",
  "carrelage travertin": "travertin",
  "peinture a la chaux": "vopsea decorativa var",
  "panneau tasseaux bois": "panouri riflaje lemn",
  "plaquette de parement brique": "placaj caramida aparenta",
  "papier peint intisse": "tapet",
  "ruban led profile aluminium": "banda led profil aluminiu",
  "suspension luminaire": "lustra suspendata",
  "lampadaire": "lampadar",
  "canape lin": "canapea in",
  "canape velours": "canapea catifea",
  "canape cuir": "canapea piele",
  "fauteuil bouclette": "fotoliu boucle",
  "chaise rotin": "scaun ratan",
  "table a manger bois massif": "masa dining lemn masiv",
  "bibliotheque etagere": "biblioteca rafturi",
  "robinetterie noir mat": "baterie negru mat",
  "poignees laiton": "accesorii alama",
  "plan de travail quartz": "blat cuart",
  "grande plante d'interieur": "plante interior mari",
  "tapis laine": "covor lana",
  "rideaux lin": "draperii in",
  "moulure decorative plafond": "mulura decorativa",
  "verriere atelier acier noir": "verriere atelier",
  "parement pierre de paris": "piatra de paris",
  "parement pierre naturelle": "piatra naturala placata",
  "table extensible": "masa extensibila",
  "bibliotheque sur mesure": "rafturi mdf pana in tavan",
  "baie vitree coulissante aluminium": "tamplarie glisanta aluminiu",
  "plan de travail quartz 20 mm": "blat cuart 20 mm",
  "meuble de cuisine 60 cm": "corpuri 60 cm modulare",
  "table a manger 160 cm": "masa dining 160 cm",
  "colonne de cuisine": "coloane h 240 cm",
  "lambris mdf a peindre": "lambriu mdf vopsit",
  "paroi de douche verre 8 mm": "sticla securizata 8 mm",
  "rail a rideaux encastre": "draperii dublu-strat pe sina ascunsa",
  "bureau mural suspendu": "blat suspendat 60 cm",
  "carrelage gres cerame 60x120 rectifie": "gresie 120×60 rectificata",
  "baignoire ilot": "cada acril/piatra compozita",
  "sauna cedre": "cabina sauna lemn cedru",
  "bureau assis-debout 160x75": "blat 160×75",
  "table ronde 90 cm": "masa ø90",
  "panneau acoustique": "panouri fonoabsorbante pet",
  "bibliotheque chene": "rafturi stejar 220 cm",
  "meuble d'entree": "corp pal 18 mm",
  "miroir mural grand format": "oglinda 6 mm",
  "carrelage gres cerame 80x80 antiderapant r10": "gresie 80×80 antiderapanta r10",
  "fenetre de toit 78x140": "ferestre velux 78×140",
  "placard sous pente": "dulapuri pe comanda la inclinatie",
  "poutre bois traitee": "grinzi lemn tratate ignifug",
  "cabine de douche integrale": "baie prefabricata compacta",
  "tiroir a fermeture amortie": "sertare soft-close",
  "profile led {k}k": "profile led {k}k",
  "etagere a chaussures inclinee": "rafturi inclinate",
  "comptoir corian": "tejghea corian",
  "plan de travail bois massif 40 mm": "blat lemn masiv 40 mm",
  "banquette chr non feu m1": "canapele tapitate ignifug (m1)",
  "baffle acoustique": "baffle fonoabsorbant",
  "bardage bois thermotraite": "riflaj pin termotratat 20×120",
  "menuiserie aluminium rupture de pont thermique": "tamplarie aluminiu cu ruptura termica",
  "membrane d'etancheite pvc": "hidroizolatie membrana pvc",
  "applique exterieure ip65 up down": "aplice ip65 up/down {k}k",
  "pergola bioclimatique aluminium": "aluminiu 6060 t5",
  "lame de terrasse composite antiderapante": "wpc 140×25 antiderapant",
  "brise-vue aluminium effet bois": "lamele aluminiu aspect lemn",
  "chauffage infrarouge exterieur": "radiatoare ir 2 kw ip65",
  "mur vegetal modulaire": "panouri modulare irigate",
  "rideau de verre coulissant": "sistem glisant fara rama 8 mm",
  "dalle clipsable acacia 30x30": "dale acacia 30×30 clic",
  "piscine beton": "beton armat hidroizolat",
  "bain de soleil aluminium": "sezlonguri aluminiu/textilena",
  "projecteur led piscine rgb": "proiectoare led rgb ip68",
  "cuisine d'exterieur": "tejghea piatra",
  "graminees": "graminee",
  "arbre tige": "arbori 8–10 cm girth",
  "borne led jardin 12 v": "balize led ip65 12 v",
  "bassin bache epdm": "lac cu geomembrana epdm",
  "barbecue inox": "gratar inox 304",
  "four a pizza exterieur": "cuptor refractar",
  "poutre lamelle-colle gl24h": "lemn lamelat gl24h",
  "table de jardin teck": "masa tec 280 cm",
  "dalle pierre naturelle exterieure": "placi granit/calcar 60×40 pe strat drenant",
  "gabion": "gabioane sau beton aparent",
  "arbre cepee": "arbore multi-trunchi",
  "caniveau inox": "rigole liniare inox",
};

// Cuvinte / semne care apar doar în interogările franceze (nu și în cele românești ale listei).
// Atenție: „verriere atelier" este o interogare ROMÂNEASCĂ din lexiconul Vision — nu adăugați „verriere".
const FRENCH_HINT =
  /[éèêëàâçùûôœî]|\b(parquet|carrelage|peinture|murale?|meuble|plaque de platre|ba13|canape|lit|armoire|fauteuil|chaise|etagere|placard|luminaire|suspension|ruban|encastrable|exterieure?|jardin|tapis|rideaux?|bois|chene|noyer|enduit|plinthe|faience|ragreage|isolant|terrasse|dalle|lambourde|robinetterie|poignees|bibliotheque|tabouret|applique|lampadaire|papier peint|miroir|commode|bureau|cuisine|douche|salle de bain)\b/;

/** Interogare curată în română pentru căutarea la magazinele din România. */
export function toRomanianQuery(query: string, titleRo = ''): string {
  const fallback = stripDiacritics(titleRo).trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
  const q = query.trim();
  if (!q) return fallback;
  const ro = FR_TO_RO[legacyKey(q)];
  if (ro) {
    if (!ro.includes('{k}')) return ro;
    const kelvin = KELVIN.exec(stripDiacritics(q).toLowerCase());
    return ro.replace('{k}', kelvin ? kelvin[1] : '3000');
  }
  if (FRENCH_HINT.test(q.toLowerCase()) || FRENCH_HINT.test(stripDiacritics(q).toLowerCase())) {
    return fallback || stripDiacritics(q).slice(0, 120);
  }
  return q.slice(0, 120);
}

/** true doar pentru căutările la magazinele din România (orice .fr / magazin francez → false). */
export function isRomanianRetailUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'ikea.com') return u.pathname.toLowerCase().startsWith('/ro/');
  return Object.values(RETAILERS).some((r) => host === r.domain || host.endsWith(`.${r.domain}`));
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Element salvat (JSON nesigur) → BomItem cu linkuri românești reconstruite.
 * Linkurile salvate sunt ignorate complet; null = element invalid.
 */
export function normalizeProcurementItem(raw: unknown, index = 0): BomItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  let titleRo = str(o.titleRo, 200);
  let titleEn = str(o.titleEn, 200);
  if (!titleRo && !titleEn) return null;
  titleRo ||= titleEn;
  titleEn ||= titleRo;
  const procCategory = (PROC_CATEGORIES.has(str(o.procCategory, 20)) ? str(o.procCategory, 20) : 'construction') as ProcCategory;
  const unit = (UNITS.has(str(o.unit, 20)) ? str(o.unit, 20) : 'buc.') as BomUnit;
  const qty = round2(num(o.qty));
  const unitPrice = round2(num(o.unitPrice));
  const query = toRomanianQuery(str(o.query, 200), titleRo);
  const item: BomItem = {
    id: str(o.id, 40) || `proc-${index}`,
    cat: str(o.cat, 40) || 'other',
    procCategory,
    titleRo,
    titleEn,
    specRo: str(o.specRo, 300),
    specEn: str(o.specEn, 300),
    qty,
    unit,
    unitPrice,
    total: round2(qty * unitPrice),
    query,
    links: buildRetailerLinks(query, procCategory),
  };
  if (o.fromPrompt === true) item.fromPrompt = true;
  return item;
}

/** Listă salvată → listă normalizată; undefined dacă valoarea nu e un tablou. */
export function normalizeProcurementItems(raw: unknown): BomItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((r, i) => normalizeProcurementItem(r, i)).filter((i): i is BomItem => i !== null);
}

/** Pentru linkurile care vin gata construite (portalul public): păstrează doar magazinele din România. */
export function romanianLinksOnly<T extends Pick<RetailerLink, 'url'>>(links: readonly T[] | null | undefined): T[] {
  return (links ?? []).filter((l) => isRomanianRetailUrl(l.url));
}
