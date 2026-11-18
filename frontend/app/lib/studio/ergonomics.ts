// app/lib/studio/ergonomics.ts
// „Analiză ergonomică” — oglinda exactă a `backend/src/Sucvar.Domain/Studio/SpatialErgonomicsAnalyzer.cs`
// (aceleași praguri, aceleași reguli, aceleași texte). Rulează instant în browser, fără cost AI:
//   • suprafață (m²) și volum (m³);
//   • grad optim de ocupare cu mobilier 30–35 % și suprafață liberă de circulație 65–70 %;
//   • culoar minim 75–85 cm (90–100 cm în bucătărie, hol, cafenea; 85–90 cm pentru obiectivul „circulație”);
//   • 3–4 recomandări adaptate cotelor reale, tipului de cameră și obiectivului ales.
// `promptConstraints` (engleză) pleacă la /api/generate ca `ergonomicConstraints`; serverul le igienizează.
// Dacă modifici o regulă aici, modific-o și în C# (testele backend acoperă pragurile).

export type OptimizationGoalId = 'spaciousness' | 'storage' | 'home_office' | 'circulation';

export interface OptimizationGoal {
  id: OptimizationGoalId;
  ro: string;
  en: string;
  fr: string;
  hintRo: string;
  hintEn: string;
  hintFr: string;
}

export const OPTIMIZATION_GOALS: readonly OptimizationGoal[] = [
  {
    id: 'spaciousness', ro: 'Senzație de spațiu', en: 'Sense of space', fr: 'Sensation d’espace',
    hintRo: 'Cameră mică: mobilier suspendat, suprafețe luminoase, podea liberă',
    hintEn: 'Small room: wall-mounted furniture, light surfaces, open floor',
    hintFr: 'Petite pièce : mobilier suspendu, surfaces claires, sol dégagé',
  },
  {
    id: 'storage', ro: 'Depozitare maximă', en: 'Maximum storage', fr: 'Rangement maximal',
    hintRo: 'Corpuri încastrate până în tavan, depozitare ascunsă, piese multifuncționale',
    hintEn: 'Floor-to-ceiling built-ins, hidden storage, multifunctional pieces',
    hintFr: 'Rangements toute hauteur, rangement caché, meubles multifonctions',
  },
  {
    id: 'home_office', ro: 'Colț Home Office', en: 'Home office corner', fr: 'Coin bureau',
    hintRo: 'Birou ergonomic lângă fereastră, zonare acustică și vizuală, fără cabluri',
    hintEn: 'Ergonomic desk by the window, acoustic and visual zoning, cable-free',
    hintFr: 'Bureau ergonomique près de la fenêtre, zonage, sans câbles',
  },
  {
    id: 'circulation', ro: 'Flux de circulație aerisit', en: 'Airy circulation', fr: 'Circulation aérée',
    hintRo: 'Culoare centrale libere ≥ 75–85 cm, zonare echilibrată, ferestre neobstrucționate',
    hintEn: 'Clear central walkways ≥ 75–85 cm, balanced zoning, unobstructed windows',
    hintFr: 'Passages libres ≥ 75–85 cm, zonage équilibré, fenêtres dégagées',
  },
];

export const isOptimizationGoal = (v: unknown): v is OptimizationGoalId =>
  typeof v === 'string' && OPTIMIZATION_GOALS.some((g) => g.id === v);

export interface ErgonomicRecommendation {
  id: string;
  ro: string;
  en: string;
  promptEn: string;
}

export interface ErgonomicReport {
  spaceType: string;
  lengthM: number;
  widthM: number;
  heightM: number;
  dimensionsAssumed: boolean;
  areaSqm: number;
  volumeM3: number;
  minFurnitureSqm: number;
  maxFurnitureSqm: number;
  minFreeSqm: number;
  maxFreeSqm: number;
  walkwayMinCm: number;
  walkwayMaxCm: number;
  highTraffic: boolean;
  goal: OptimizationGoalId | null;
  recommendations: ErgonomicRecommendation[];
  /** Regulile în engleză trimise modelului (amprentă, culoar, apoi fiecare recomandare). */
  promptConstraints: string[];
}

export const FURNITURE_RATIO_MIN = 0.3;
export const FURNITURE_RATIO_MAX = 0.35;
const MAX_RECOMMENDATIONS = 4;

/** Cote tipice (lungime × lățime × înălțime, m) per tip de cameră — identice cu backend-ul. */
export function defaultDimensions(spaceType: string): { length: number; width: number; height: number } {
  switch (spaceType) {
    case 'kitchen': return { length: 4.0, width: 3.0, height: 2.6 };
    case 'master bedroom': return { length: 4.2, width: 3.5, height: 2.6 };
    case 'bathroom': return { length: 2.6, width: 2.0, height: 2.5 };
    case 'home office': return { length: 3.5, width: 3.0, height: 2.6 };
    case 'entryway': return { length: 3.0, width: 1.6, height: 2.6 };
    case 'attic loft': return { length: 6.0, width: 4.5, height: 2.4 };
    case 'walk-in closet': return { length: 2.5, width: 2.0, height: 2.5 };
    case 'commercial cafe': return { length: 10.0, width: 7.0, height: 3.2 };
    default: return { length: 5.0, width: 4.0, height: 2.65 };
  }
}

// Math.round(x * 10^d) / 10^d cu MidpointRounding.AwayFromZero (valori pozitive)
const round = (v: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round((v + Number.EPSILON) * f) / f;
};
const fmt1 = (v: number) => String(round(v, 1)); // "0.#"
const fmtLen = (v: number) => { // "0.0#": 7 → 7.0, 4.2 → 4.2, 4.25 → 4.25
  const s = round(v, 2).toFixed(2);
  return s.endsWith('0') ? s.slice(0, -1) : s;
};

const valid = (v: number | null | undefined, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(max, Math.max(min, v)) : null;

/** Analiza ergonomică a unei camere; cotele lipsă / nule se completează cu valorile tipice ale camerei. */
export function analyzeErgonomics(
  spaceType: string,
  dims: { length?: number | null; width?: number | null; height?: number | null },
  goalId: OptimizationGoalId | null = null,
): ErgonomicReport {
  const space = spaceType.trim() || 'living room';
  const defaults = defaultDimensions(space);
  const l = valid(dims.length, 1, 100);
  const w = valid(dims.width, 1, 100);
  const h = valid(dims.height, 2, 15);
  const assumed = l === null || w === null || h === null;
  let length = l ?? defaults.length;
  let width = w ?? defaults.width;
  const height = h ?? defaults.height;
  if (width > length) [length, width] = [width, length]; // lățimea = latura scurtă

  const area = round(length * width, 2);
  const volume = round(area * height, 2);
  const highTraffic = space === 'kitchen' || space === 'entryway' || space === 'commercial cafe';
  const goal = goalId && isOptimizationGoal(goalId) ? goalId : null;
  const [walkMin, walkMax] = highTraffic ? [90, 100] : goal === 'circulation' ? [85, 90] : [75, 85];

  const base = {
    spaceType: space,
    lengthM: round(length, 2),
    widthM: round(width, 2),
    heightM: round(height, 2),
    dimensionsAssumed: assumed,
    areaSqm: area,
    volumeM3: volume,
    minFurnitureSqm: round(area * FURNITURE_RATIO_MIN, 1),
    maxFurnitureSqm: round(area * FURNITURE_RATIO_MAX, 1),
    minFreeSqm: round(area * (1 - FURNITURE_RATIO_MAX), 1),
    maxFreeSqm: round(area * (1 - FURNITURE_RATIO_MIN), 1),
    walkwayMinCm: walkMin,
    walkwayMaxCm: walkMax,
    highTraffic,
    goal,
  };
  const recommendations = recommend(base, goal);
  return {
    ...base,
    recommendations,
    promptConstraints: [
      `keep the total furniture footprint within 30-35% of the ${fmt1(area)} m² floor (at most ${fmt1(base.maxFurnitureSqm)} m²), ` +
        `leaving about ${fmt1(base.minFreeSqm)} m² of free circulation floor`,
      `keep clear walkways at least ${walkMin} cm wide between furniture, doors and windows`,
      ...recommendations.map((r) => r.promptEn),
    ],
  };
}

type Base = Omit<ErgonomicReport, 'recommendations' | 'promptConstraints'>;

function recommend(r: Base, goal: OptimizationGoalId | null): ErgonomicRecommendation[] {
  const list: ErgonomicRecommendation[] = [];
  const add = (rec: ErgonomicRecommendation) => {
    if (list.length < MAX_RECOMMENDATIONS && !list.some((x) => x.id === rec.id)) list.push(rec);
  };
  const cm = String(r.walkwayMinCm);
  const longWall = fmtLen(r.lengthM);
  const ceiling = r.heightM.toFixed(2);

  // 1. Obiectivul
  switch (goal) {
    case 'spaciousness':
      add({ id: 'goal_spaciousness',
        ro: 'Mobilier suspendat sau pe picioare subțiri și o oglindă mare pe peretele opus ferestrei — podeaua vizibilă mărește optic camera.',
        en: 'Wall-mounted or slim-legged furniture and a large mirror opposite the window — visible floor makes the room look larger.',
        promptEn: 'use wall-mounted and slim-legged furniture with visible floor beneath, and a large mirror opposite the window' });
      break;
    case 'storage':
      add({ id: 'goal_storage',
        ro: `Corpuri încastrate până în tavan pe peretele lung (${longWall} m), adâncime 35–60 cm, cu fronturi plane fără mânere.`,
        en: `Floor-to-ceiling built-ins along the long wall (${longWall} m), 35–60 cm deep, with flat handle-less fronts.`,
        promptEn: `add floor-to-ceiling built-in cabinetry 35-60 cm deep along the ${longWall} m long wall with flat handle-less fronts` });
      break;
    case 'home_office':
      add({ id: 'goal_home_office',
        ro: 'Birou de min. 120 × 60 cm perpendicular pe fereastră (lumină laterală, fără reflexii pe ecran), separat vizual cu un raft deschis.',
        en: 'A desk of at least 120 × 60 cm perpendicular to the window (side light, no screen glare), zoned with an open shelf.',
        promptEn: 'place a desk of at least 120 x 60 cm perpendicular to the window for side light, zoned off with an open shelving unit' });
      break;
    case 'circulation':
      add({ id: 'goal_circulation',
        ro: `Traseu liber de ${cm} cm de la ușă la fereastră; mobilierul se grupează pe zone, lângă pereți, fără a bloca golurile.`,
        en: `A clear ${cm} cm path from the door to the window; furniture grouped in zones along the walls, never blocking openings.`,
        promptEn: `keep a clear ${cm} cm path from the door to the window with furniture grouped in zones along the walls` });
      break;
  }

  // 2. Tipul camerei
  switch (r.spaceType) {
    case 'master bedroom':
      if (r.widthM < 3.0) {
        add({ id: 'bed_narrow',
          ro: 'Cameră îngustă: pat de 140–160 cm, noptiere suspendate și dulap cu uși glisante (fără raza de deschidere a ușilor).',
          en: 'Narrow room: a 140–160 cm bed, floating nightstands and a sliding-door wardrobe (no door swing).',
          promptEn: 'use a 140-160 cm wide bed with floating wall-mounted nightstands and a sliding-door wardrobe' });
      } else {
        add({ id: 'bed_clearance',
          ro: 'Pat de 160–180 cm cu minimum 60 cm liber pe ambele laturi și 90 cm în fața dulapului.',
          en: 'A 160–180 cm bed with at least 60 cm free on both sides and 90 cm in front of the wardrobe.',
          promptEn: 'use a 160-180 cm bed with at least 60 cm clearance on both sides and 90 cm in front of the wardrobe' });
      }
      break;
    case 'kitchen':
      add({ id: 'kitchen_triangle',
        ro: 'Triunghiul de lucru (frigider–chiuvetă–plită) între 4 și 7 m, cu 90–120 cm liberi între fronturile paralele.',
        en: 'Work triangle (fridge–sink–hob) of 4–7 m in total, with 90–120 cm between parallel fronts.',
        promptEn: 'keep a compact fridge-sink-hob work triangle with 90-120 cm clearance between parallel counters' });
      break;
    case 'bathroom':
      add({ id: 'bath_clearance',
        ro: 'Lavoar suspendat și WC suspendat, cu 60–70 cm liberi în fața fiecăruia; duș walk-in cu sticlă clară în loc de cadă.',
        en: 'Wall-hung vanity and WC with 60–70 cm free in front of each; a walk-in shower with clear glass instead of a bathtub.',
        promptEn: 'use a wall-hung vanity and toilet with 60-70 cm clearance in front, and a clear-glass walk-in shower' });
      break;
    case 'living room':
      add({ id: 'living_distances',
        ro: 'Canapeaua la 2,5–3 m de TV, măsuța la 40–45 cm de canapea; canapea cu brațe subțiri, nu colțar supradimensionat.',
        en: 'Sofa 2.5–3 m from the TV, coffee table 40–45 cm from the sofa; a slim-armed sofa rather than an oversized corner unit.',
        promptEn: 'use a slim-armed sofa 2.5-3 m from the TV wall with the coffee table 40-45 cm in front, no oversized sectional' });
      break;
    case 'home office':
      add({ id: 'office_desk',
        ro: 'Birou de 140 × 70 cm lângă fereastră, scaun ergonomic cu 100 cm liberi în spate pentru retragere.',
        en: 'A 140 × 70 cm desk by the window and an ergonomic chair with 100 cm free behind it.',
        promptEn: 'place a 140 x 70 cm desk by the window with an ergonomic chair and 100 cm free space behind it' });
      break;
    case 'entryway':
      add({ id: 'entry_shallow',
        ro: 'Corpuri de maximum 35 cm adâncime (pantofar, cuier încastrat) și o oglindă pe toată înălțimea.',
        en: 'Cabinets at most 35 cm deep (shoe cabinet, built-in coat rack) and a full-height mirror.',
        promptEn: 'use shallow cabinets at most 35 cm deep, a built-in coat rack and a full-height mirror' });
      break;
    case 'walk-in closet':
      add({ id: 'closet_aisle',
        ro: 'Rafturi pe maximum două laturi, adâncime 55–60 cm, cu un culoar central de cel puțin 90 cm.',
        en: 'Shelving on at most two sides, 55–60 cm deep, with a central aisle of at least 90 cm.',
        promptEn: 'fit 55-60 cm deep shelving on at most two walls with a central aisle of at least 90 cm' });
      break;
    case 'attic loft':
      add({ id: 'attic_kneewall',
        ro: 'Folosește zona joasă de sub pantă pentru depozitare încastrată; mobilierul înalt doar sub coama acoperișului.',
        en: 'Use the low area under the slope for built-in storage; tall furniture only under the roof ridge.',
        promptEn: 'use the low knee-wall area under the sloped ceiling for built-in storage and keep tall furniture under the ridge' });
      break;
    case 'commercial cafe':
      add({ id: 'cafe_service',
        ro: 'Culoar de serviciu de 120 cm între bar și mese; mese de 60–70 cm pentru două persoane, la 45 cm între scaune.',
        en: 'A 120 cm service aisle between the bar and the tables; 60–70 cm tables for two, 45 cm between chairs.',
        promptEn: 'keep a 120 cm service aisle between the counter and the tables, with compact 60-70 cm tables' });
      break;
  }

  // 3. Cotele
  if (r.heightM >= 2.7) {
    add({ id: 'tall_ceiling',
      ro: `Tavan de ${ceiling} m: depozitare verticală până în tavan, eliberând podeaua.`,
      en: `${ceiling} m ceiling: vertical floor-to-ceiling storage that frees the floor.`,
      promptEn: 'exploit the ceiling height with vertical floor-to-ceiling storage that keeps the floor free' });
  } else if (r.heightM < 2.5) {
    add({ id: 'low_ceiling',
      ro: 'Tavan jos: mobilier low-profile, fără lustre suspendate — spoturi încastrate și lumină indirectă.',
      en: 'Low ceiling: low-profile furniture, no hanging pendants — recessed spots and indirect light.',
      promptEn: 'use low-profile furniture and recessed ceiling lights instead of hanging pendants' });
  }

  if (r.areaSqm < 14) {
    add({ id: 'small_area',
      ro: 'Sub 14 m²: scaune și canapele pe picioare sau suspendate, nuanțe neutre calde și deschise, maximum 2–3 piese mari.',
      en: 'Under 14 m²: legged or floating seating, light warm neutrals and no more than 2–3 large pieces.',
      promptEn: 'use legged or floating seating, light warm neutral tones and no more than three large furniture pieces' });
  } else if (r.areaSqm >= 25) {
    add({ id: 'large_area',
      ro: 'Peste 25 m²: zonează cu covoare și corpuri de iluminat dedicate; mobilierul poate sta desprins de pereți.',
      en: 'Over 25 m²: zone the space with rugs and dedicated lighting; furniture can float away from the walls.',
      promptEn: 'define distinct functional zones with rugs and dedicated lighting, letting furniture float away from the walls' });
  } else {
    add({ id: 'anchor_walls',
      ro: 'Piesele mari (canapea, pat, dulap) pe pereții plini; diagonala ușă–fereastră rămâne liberă, ca un culoar natural.',
      en: 'Large pieces (sofa, bed, wardrobe) on the solid walls; the door–window diagonal stays free as a natural walkway.',
      promptEn: 'anchor the large furniture pieces against the solid walls and keep the diagonal from the door to the window free' });
  }

  if (r.widthM < 2.6 && !['master bedroom', 'entryway', 'walk-in closet', 'bathroom'].includes(r.spaceType)) {
    add({ id: 'narrow_room',
      ro: 'Cameră îngustă: mobilierul pe o singură latură lungă, culoarul pe cealaltă; fronturi glisante sau pliante.',
      en: 'Narrow room: furniture along one long wall, the walkway along the other; sliding or folding fronts.',
      promptEn: 'place furniture along one long wall and keep the walkway along the opposite wall' });
  }

  add({ id: 'daylight',
    ro: 'Nimic mai înalt de 90 cm în fața ferestrei; draperii subțiri montate la tavan, ca lumina naturală să intre nestingherită.',
    en: 'Nothing taller than 90 cm in front of the window; sheer curtains hung from the ceiling to let daylight in.',
    promptEn: 'keep everything in front of the windows below 90 cm with sheer ceiling-hung curtains to maximize daylight' });
  return list;
}
