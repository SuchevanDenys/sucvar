// app/data/home.ts
// Static content of the landing page (hero metrics, case studies, process, formulas, suppliers).
// Every user-facing string exists in RO and EN; values that are pure numbers/units stay shared.

import { Cpu, FileCheck2, Ruler } from 'lucide-react';
import { RETAILERS } from '@/app/lib/retailers';

// ── Hero proof metrics ──────────────────────────────────────────────────────
// Insigne din hero. Valorile sunt capabilități reale ale produsului, nu metrici de marketing:
// numărul de stiluri e derivat în page.tsx din catalog.
export const HERO_STATS = [
  {
    value: '12',
    ro: 'Stiluri arhitecturale curatoriate, fiecare cu materiale, paletă și lumină proprii.',
    en: 'Curated architectural styles, each with its own materials, palette and light.',
  },
  {
    value: 'BOM',
    ro: 'Listă de materiale actualizată instant, cu prețuri și linkuri către magazine.',
    en: 'A live bill of materials, with prices and direct retailer links.',
  },
  {
    value: 'PDF',
    ro: 'Dosare tehnice gata de prezentat clientului: Blueprint și Material Passport.',
    en: 'Client-ready technical dossiers: Blueprint and Material Passport.',
  },
  {
    value: '±4 mm',
    ro: 'Precizie a cantităților, calculate din cotele reale ale încăperii.',
    en: 'Quantity accuracy, derived from the room’s real dimensions.',
  },
];

// ── Case-study imagery → /public/showcase/ ──────────────────────────────────
export interface CaseStudy {
  id: string;
  codeRo: string;
  codeEn: string;
  outputRo: string;
  outputEn: string;
  titleRo: string;
  titleEn: string;
  before: string;
  after: string;
  meta: { labelRo: string; labelEn: string; valueRo: string; valueEn: string }[];
  summaryRo: string;
  summaryEn: string;
  listTitleRo: string;
  listTitleEn: string;
  materials: { nameRo: string; nameEn: string; qty: string; stdRo: string; stdEn: string }[];
}

export const CASES: CaseStudy[] = [
  {
    id: 'apartment',
    codeRo: 'PROIECT 01',
    codeEn: 'CASE 01',
    outputRo: 'Deviz · 41 s',
    outputEn: 'Estimate · 41 s',
    titleRo: 'Apartament de bloc din anii ’80, reimaginat ca open-space Japandi cald',
    titleEn: '1980s concrete-block apartment, reimagined as a warm Japandi open plan',
    before: '/showcase/room-before.jpg',
    after: '/showcase/room-after.jpg',
    meta: [
      { labelRo: 'Suprafață', labelEn: 'Floor area', valueRo: '68,4 m²', valueEn: '68.4 m²' },
      { labelRo: 'Pereți (net)', labelEn: 'Net walls', valueRo: '142 m²', valueEn: '142 m²' },
      { labelRo: 'Buget', labelEn: 'Budget', valueRo: 'Standard', valueEn: 'Standard' },
    ],
    summaryRo:
      'Pereții nestructurali dispar, spațiul se deschide, iar fiecare finisaj pornește de la cotele nete — cu pierderile de tăiere deja incluse.',
    summaryEn:
      'Non-structural walls come down, the space opens up, and every finish starts from the net dimensions — cutting waste already included.',
    listTitleRo: 'Materiale calculate (extras)',
    listTitleEn: 'Calculated materials (excerpt)',
    materials: [
      { nameRo: 'Parchet triplustratificat din stejar', nameEn: 'Engineered oak parquet', qty: '75.2 m²', stdRo: 'Stejar · 14 mm', stdEn: 'Oak · 14 mm' },
      { nameRo: 'Lamele acustice din fetru', nameEn: 'Acoustic felt slats', qty: '18.0 m²', stdRo: 'Fetru acustic', stdEn: 'Acoustic felt' },
      { nameRo: 'Șină magnetică 48 V', nameEn: '48 V magnetic track', qty: '14.0 ml', stdRo: 'Lumină caldă', stdEn: 'Warm light' },
    ],
  },
  {
    id: 'villa',
    codeRo: 'PROIECT 02',
    codeEn: 'CASE 02',
    outputRo: 'Deviz · 44 s',
    outputEn: 'Estimate · 44 s',
    titleRo: 'Vilă contemporană: o fațadă monolit din ceramică mată',
    titleEn: 'Contemporary villa: a monolithic matte-ceramic facade',
    before: '/showcase/villa-before.jpg',
    after: '/showcase/villa-after.jpg',
    meta: [
      { labelRo: 'Suprafață', labelEn: 'Area', valueRo: '240 m² fațadă', valueEn: '240 m² facade' },
      { labelRo: 'Anvelopă', labelEn: 'Envelope', valueRo: 'Ceramică ventilată', valueEn: 'Ventilated ceramic' },
      { labelRo: 'Finisaj', labelEn: 'Finish', valueRo: 'Ceramică mată', valueEn: 'Matte ceramic' },
    ],
    summaryRo:
      'O fațadă ventilată din ceramică mată, peste un strat izolant discret. Panourile, substructura și izolația pornesc toate din același desen al suprafeței.',
    summaryEn:
      'A ventilated matte-ceramic facade over a quiet insulating layer. Panels, substructure and insulation all start from the same drawing of the surface.',
    listTitleRo: 'Rezumat tehnic',
    listTitleEn: 'Technical summary',
    materials: [
      { nameRo: 'Panouri ceramice pentru fațadă ventilată', nameEn: 'Ventilated ceramic panels', qty: '252 m²', stdRo: 'Ceramică', stdEn: 'Ceramic' },
      { nameRo: 'Vată minerală bazaltică', nameEn: 'Basalt mineral wool', qty: '252 m²', stdRo: 'Bazalt · A1', stdEn: 'Basalt · A1' },
      { nameRo: 'Substructură din aluminiu cu rupere termică', nameEn: 'Thermally broken aluminium substructure', qty: '240 m²', stdRo: 'Aluminiu', stdEn: 'Aluminium' },
    ],
  },
];

// ── Supplier ecosystem ──────────────────────────────────────────────────────
// Deep-link URL templates: {q} is replaced with the encoded search term.
// Marché français (Paris & Île-de-France) — mêmes enseignes et mêmes gabarits que app/lib/retailers.ts.
// Négoce pro (Point.P, La Plateforme du Bâtiment, Brico Dépôt) pour le gros œuvre et les matériaux techniques ;
// grandes surfaces de bricolage et décoration (Leroy Merlin, Castorama, IKEA France, ManoMano) pour les finitions.

export const SAMPLE_QUERY = 'parquet contrecollé chêne 14 mm';
export const SAMPLE_PARAMS = ['chêne', '14 mm', 'couche d’usure 3,5 mm', '+10 % de chute'];

const supplier = (id: keyof typeof RETAILERS, roleRo: string, roleEn: string, roleFr: string) => ({
  name: RETAILERS[id].label,
  domain: RETAILERS[id].domain,
  roleRo,
  roleEn,
  roleFr,
  url: RETAILERS[id].build('{q}'),
});

export const SUPPLIERS = [
  supplier('pointp', 'Negoț profesional: gips-carton BA13, izolații, șape', 'Trade counter: BA13 plasterboard, insulation, screeds', 'Négoce pro : plaque de plâtre BA13, isolants, chapes'),
  supplier('laplateforme', 'Materiale tehnice, gresie, parchet, tencuieli', 'Technical materials, tiles, flooring, renders', 'Matériaux techniques, carrelage, parquet, enduits'),
  supplier('bricodepot', 'Gros œuvre la prețuri de depozit', 'Structural work at depot prices', 'Gros œuvre et matériaux à prix dépôt'),
  supplier('leroymerlin', 'Finisaje, obiecte sanitare și electrice', 'Finishes, bathroom and electrical', 'Finitions, sanitaire et électricité'),
  supplier('castorama', 'Decor, vopsele, iluminat', 'Decor, paint and lighting', 'Décoration, peinture et luminaires'),
  supplier('ikea', 'Mobilier, textile, corpuri de iluminat', 'Furniture, textiles and lighting', 'Mobilier, textiles et luminaires'),
  supplier('manomano', 'Feronerie, accesorii și piese greu de găsit', 'Hardware, fittings and hard-to-find parts', 'Quincaillerie, accessoires et pièces introuvables'),
];

export const LOOP_STEPS = [
  {
    ro: 'SUCVAR formulează căutarea potrivită, cu dimensiunile și finisajul exact.',
    en: 'SUCVAR writes the right search, with the exact dimensions and finish.',
  },
  {
    ro: 'Fiecare linie din deviz primește un link direct către magazinul ales.',
    en: 'Every line of the estimate gets a direct link to the retailer you prefer.',
  },
  {
    ro: 'Exporți devizul în CSV, direct în sistemul de ofertare al antreprenorului.',
    en: 'Export the estimate as CSV, straight into your contractor’s quoting system.',
  },
];

// ── Process ─────────────────────────────────────────────────────────────────
export const STEPS = [
  {
    number: '01',
    icon: Ruler,
    titleRo: 'Citim spațiul cu precizie',
    titleEn: 'We read the space precisely',
    descRo:
      'Pornim de la fotografia ta și de la cotele camerei — lungime, lățime, înălțime, uși și ferestre. Suprafețele nete și perimetrele sunt calculate înainte de orice randare.',
    descEn:
      'We start from your photo and the room’s dimensions — length, width, height, doors and windows. Net areas and perimeters are calculated before anything is rendered.',
    metaRo: 'L × l × H · ±4 mm',
    metaEn: 'L × W × H · ±4 mm',
  },
  {
    number: '02',
    icon: Cpu,
    titleRo: 'Randare AI fidelă arhitecturii',
    titleEn: 'AI rendering true to the architecture',
    descRo:
      'AI-ul păstrează geometria camerei, lumina naturală și deschiderile, apoi aplică finisaje reale din fișa stilului ales: pardoseli, pereți, accente și temperatura luminii.',
    descEn:
      'The AI keeps the room’s geometry, natural light and openings intact, then applies real finishes from the chosen style: flooring, walls, accents and light temperature.',
    metaRo: 'Fotografie + stil → randare',
    metaEn: 'Photo + style → render',
  },
  {
    number: '03',
    icon: FileCheck2,
    titleRo: 'Deviz și ofertă pentru client',
    titleEn: 'Estimate and client quote',
    descRo:
      'Cantitățile rezultă direct din geometrie și se actualizează la fiecare modificare. Exporți lista de materiale în CSV și dosarul tehnic în PDF, gata de trimis.',
    descEn:
      'Quantities flow straight from the geometry and update with every change. Export the bill of materials as CSV and the technical dossier as PDF, ready to send.',
    metaRo: 'Deviz · CSV · PDF',
    metaEn: 'Estimate · CSV · PDF',
  },
];

// ── Matrice de capabilități pe planuri ──────────────────────────────────────
// Oglindește regulile reale din app/lib/plan/tiers.ts și PRICING_PLANS:
// generări nelimitate pentru Pro/Agency, portal /b2b doar pentru Agency (Business).
// Valori: true = inclus, false = neinclus, text = valoare concretă.
export type CapabilityValue = boolean | { ro: string; en: string };
export const CAPABILITY_MATRIX: {
  ro: string;
  en: string;
  starter: CapabilityValue;
  pro: CapabilityValue;
  agency: CapabilityValue;
}[] = [
  { ro: 'Proiecte în Studio', en: 'Studio projects', starter: { ro: '3 / lună', en: '3 / month' }, pro: { ro: 'Nelimitate', en: 'Unlimited' }, agency: { ro: 'Nelimitate', en: 'Unlimited' } },
  { ro: 'Stiluri arhitecturale cu fișă tehnică', en: 'Architectural styles with spec sheets', starter: true, pro: true, agency: true },
  { ro: 'Deviz detaliat: materiale și costuri', en: 'Detailed estimate: materials and costs', starter: true, pro: true, agency: true },
  { ro: 'Export PDF Blueprint', en: 'Blueprint PDF export', starter: true, pro: true, agency: true },
  { ro: 'Material Passport pentru client (PDF)', en: 'Client Material Passport (PDF)', starter: false, pro: true, agency: true },
  { ro: 'Arhivă de proiecte în cloud', en: 'Cloud project archive', starter: false, pro: true, agency: true },
  { ro: 'Portal B2B: devize, manoperă și marje', en: 'B2B portal: estimates, labour and margins', starter: false, pro: false, agency: true },
  { ro: 'Conturi pentru echipă', en: 'Team seats', starter: false, pro: false, agency: { ro: '5', en: '5' } },
  { ro: 'PDF cu antet tehnic de proiectare', en: 'PDF with engineering title block', starter: false, pro: false, agency: true },
  { ro: 'Procesare prioritară', en: 'Priority processing', starter: false, pro: false, agency: true },
];

export const TIER_WORKFLOWS = {
  starter: {
    ro: 'Pentru proprietari: fotografiezi camera, alegi stilul și vezi cum arată — cu un deviz orientativ înainte să investești.',
    en: 'For homeowners: photograph the room, choose a style and see the result — with an indicative estimate before you invest.',
  },
  pro: {
    ro: 'Pentru designeri și arhitecți independenți: proiecte nelimitate, arhivă în cloud și Material Passport pentru fiecare client.',
    en: 'For independent designers and architects: unlimited projects, a cloud archive and a Material Passport for every client.',
  },
  agency: {
    ro: 'Pentru firme de construcții și birouri de proiectare: portalul B2B, cinci conturi de echipă și dosare PDF cu antet tehnic.',
    en: 'For construction firms and design practices: the B2B portal, five team seats and PDF dossiers with an engineering title block.',
  },
};

// ── Metodologie de calcul ───────────────────────────────────────────────────
// Constantele oglindesc app/data/catalog.ts (secțiunea 4, calculatorul ingineresc).
export const FORMULAS = [
  {
    labelRo: 'Suprafața netă a pereților',
    labelEn: 'Net wall area',
    descRo: 'Perimetrul înmulțit cu înălțimea, minus golurile ușilor și ferestrelor.',
    descEn: 'Perimeter times height, minus the door and window openings.',
    formulaRo: 'P × H − (uși × 1,89 + ferestre × 2,10) m²',
    formulaEn: 'P × H − (doors × 1.89 + windows × 2.10) m²',
  },
  {
    labelRo: 'Pardoseală (parchet sau gresie)',
    labelEn: 'Flooring (parquet or tiles)',
    descRo: 'Suprafața camerei, plus 10% pentru tăieri și îmbinări.',
    descEn: 'The floor area, plus 10% for cuts and joints.',
    formulaRo: 'L × l × 1,10 m²',
    formulaEn: 'L × W × 1.10 m²',
  },
  {
    labelRo: 'Vopsea lavabilă',
    labelEn: 'Wall paint',
    descRo: 'Două straturi pe suprafața netă, la 10 m² pe litru, cu 10% rezervă.',
    descEn: 'Two coats over the net area at 10 m² per litre, with a 10% reserve.',
    formulaRo: 'suprafață netă × 2 ÷ 10 m²/L × 1,10',
    formulaEn: 'net area × 2 ÷ 10 m²/L × 1.10',
  },
  {
    labelRo: 'Plintă',
    labelEn: 'Skirting board',
    descRo: 'Perimetrul fără lățimea ușilor, plus 5% pentru îmbinările din colțuri.',
    descEn: 'The perimeter minus door widths, plus 5% for corner joints.',
    formulaRo: '(P − uși × 0,90) × 1,05 ml',
    formulaEn: '(P − doors × 0.90) × 1.05 lm',
  },
  {
    labelRo: 'Tavan din gips-carton',
    labelEn: 'Plasterboard ceiling',
    descRo: 'Suprafața tavanului cu 10% rezervă, împărțită la placa standard de 3 m².',
    descEn: 'The ceiling area with a 10% reserve, divided by a standard 3 m² board.',
    formulaRo: 'L × l × 1,10 ÷ 3,0 m²/placă',
    formulaEn: 'L × W × 1.10 ÷ 3.0 m²/board',
  },
  {
    labelRo: 'Necesar de lumină',
    labelEn: 'Lighting requirement',
    descRo: 'Metoda lumenului: iluminarea dorită pe toată suprafața, corectată pentru pierderi și întreținere.',
    descEn: 'The lumen method: target illuminance across the area, corrected for losses and maintenance.',
    formulaRo: 'E (lx) × A ÷ (0,6 × 0,9) lm',
    formulaEn: 'E (lx) × A ÷ (0.6 × 0.9) lm',
  },
  {
    labelRo: 'Manoperă',
    labelEn: 'Labour',
    descRo: 'Fiecare cantitate înmulțită cu tariful de execuție corespunzător bugetului ales.',
    descEn: 'Each quantity multiplied by the labour rate for your chosen budget.',
    formulaRo: 'Σ (cantitate × tarif)',
    formulaEn: 'Σ (quantity × rate)',
  },
];
