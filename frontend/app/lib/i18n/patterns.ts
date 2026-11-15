// app/lib/i18n/patterns.ts
// French for the API's computed strings (quantities, colour temperatures, lumens…): one rule per template
// instead of one dictionary entry per number. Mirrors the phrasing of the BOM builder (BomBuilder.cs).
type Lookup = (en: string) => string | undefined;

const RULES: [RegExp, (m: RegExpMatchArray, fr: Lookup) => string | undefined][] = [
  [/^About (\S+) L \(2 coats\) \+ primer; net area excl\. openings$/, (m) => `Environ ${m[1].replace('.', ',')} L (2 couches) + sous-couche ; surface nette hors ouvertures`],
  [/^(\d+) sheets 1\.2×2\.5 m, \+10% waste; hanger system included$/, (m) => `${m[1]} plaques 1,2×2,5 m, +10 % de chute ; système de suspension inclus`],
  [/^(\d+)K LED strip with recessed aluminium profile$/, (m) => `Ruban LED ${m[1]}K avec profilé aluminium encastré`],
  [/^Recessed LED downlight (\d+)K$/, (m) => `Spot LED encastré ${m[1]}K`],
  [/^Exterior LED wall light IP65 (\d+)K$/, (m) => `Applique LED extérieure IP65 ${m[1]}K`],
  [/^LED garden bollards (\d+)K$/, (m) => `Bornes LED de jardin ${m[1]}K`],
  [/^(\d+) lx target → (\d+) lm total \(lumen method\)$/, (m) => `${m[1]} lx visés → ${Number(m[2]).toLocaleString('fr-FR')} lm au total (méthode des flux)`],
  [/^(\d+)% of area; \+10% waste; sand and gravel bed separate$/, (m) => `${m[1]} % de la surface ; +10 % de chute ; lit de sable et gravier en sus`],
  [/^~(\S+) m³ for the planted zone$/, (m) => `~${m[1].replace('.', ',')} m³ pour la zone plantée`],
  [/^(.+); ~(\S+) ml run$/, (m, fr) => `${fr(m[1]) ?? m[1]} ; ~${m[2].replace('.', ',')} ml linéaires`],
  [/^(.+) — indicative allowance$/, (m, fr) => `${fr(m[1]) ?? m[1]} — enveloppe indicative`],
  [/^Picked from your description — search for this exact material; (.*)$/, (m, fr) =>
    `Issu de votre description — recherchez exactement ce matériau ; ${fr(m[1]) ?? m[1]}`],
  [/^Picked from your description — search for this exact material$/, () => 'Issu de votre description — recherchez exactement ce matériau'],
];

export function frenchByPattern(en: string, lookup: Lookup): string | undefined {
  for (const [re, build] of RULES) {
    const m = en.match(re);
    if (m) return build(m, lookup);
  }
  return undefined;
}
