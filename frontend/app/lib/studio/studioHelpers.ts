// app/lib/studio/studioHelpers.ts
// Funcții pure folosite de pagina Studio (/generate). Nu țin stare și nu ating DOM-ul,
// deci pot fi testate și refolosite independent de componenta paginii.
import { getSpace } from '@/app/data/catalog';
import type { Translate } from '@/app/lib/i18n';
import { PLAN_LIMITS } from '@/app/lib/studio/aiConfig';
import { MAX_PHOTO_BYTES, MIN_PHOTO_SIDE } from '@/app/lib/studio/constants';
import type { PhotoErrorCode } from '@/app/lib/studio/images';
import type { DesignMode, EngineeringSpecs, RoomDimensions } from '@/app/types';

/**
 * Cotele inițiale ale unui spațiu: dimensiunile lui implicite realiste + setările care
 * se păstrează la schimbarea spațiului (buget, intensitate AI, nivel de intervenție).
 * Scenariile (focusIds) se golesc: cele ale spațiului anterior nu se mai potrivesc.
 */
export function dimensionsForSpace(
  mode: DesignMode,
  spaceId: string,
  keep: Pick<RoomDimensions, 'budget' | 'aiStrength' | 'scope'>,
): RoomDimensions {
  const space = getSpace(mode, spaceId);
  const d = space.defaults;
  return {
    width: d.width,
    length: d.length,
    height: d.height,
    doorsCount: d.doorsCount,
    windowsCount: d.windowsCount,
    layoutPreset: space.layouts[0].id,
    focusIds: [],
    ...keep,
  };
}

/** Aria (m², o zecimală) trimisă API-ului ca `areaSqm` — aceeași rotunjire ca pe server. */
export const roundedArea = (dims: Pick<RoomDimensions, 'width' | 'length'>): number =>
  Math.round(dims.width * dims.length * 10) / 10;

/** Rândurile panoului „Specificații inginerești" și ale blueprint-ului tipărit (aceleași valori în ambele). */
export function buildSpecRows(m: EngineeringSpecs, t: Translate): { label: string; value: string }[] {
  return [
    { label: t('Suprafață pardoseală', 'Floor area'), value: `${m.floorArea} m²` },
    { label: t('Volum', 'Volume'), value: `${m.volume} m³` },
    { label: t('Arie netă pereți', 'Net wall area'), value: `${m.netWallArea} m²` },
    { label: t('Pardoseală +10%', 'Flooring +10%'), value: `${m.flooringWithWaste} m²` },
    { label: t('Vopsea (2 straturi)', 'Paint (2 coats)'), value: `${m.paintLiters} L` },
    { label: t('Plintă', 'Baseboard'), value: `${m.baseboardMeters} ml` },
    { label: t('Gips-carton (plăci)', 'Plasterboard (sheets)'), value: `${m.plasterboardSheets} ${t('buc.', 'pcs')}` },
    { label: t('Corpuri de iluminat', 'Light fixtures'), value: `${m.lightFixtures} ${t('buc.', 'pcs')}` },
  ];
}

/** Mesajul afișat când fotografia aleasă este respinsă de `resizePhoto`. */
export function photoErrorMessage(code: PhotoErrorCode, t: Translate): string {
  const maxMb = MAX_PHOTO_BYTES / 1024 / 1024;
  switch (code) {
    case 'type':
      return t('Format neacceptat. Folosește o fotografie JPEG, PNG sau WebP.', 'Unsupported format. Use a JPEG, PNG or WebP photo.');
    case 'size':
      return t(`Fotografia depășește ${maxMb} MB.`, `The photo is larger than ${maxMb} MB.`, `La photo dépasse ${maxMb} Mo.`);
    case 'small':
      return t(
        `Fotografia este prea mică (minim ${MIN_PHOTO_SIDE} px pe latura scurtă).`,
        `The photo is too small (at least ${MIN_PHOTO_SIDE} px on the short side).`,
        `La photo est trop petite (au moins ${MIN_PHOTO_SIDE} px sur le petit côté).`,
      );
    case 'huge':
      return t('Fotografia este prea detaliată pentru a fi trimisă. Încearcă una mai simplă.', 'The photo is too detailed to upload. Try a simpler one.');
    default:
      return t('Fotografia nu a putut fi citită.', 'The photo could not be read.');
  }
}

/** Mesajul de limită lunară atinsă pe planul gratuit (verificare locală și răspunsul 403 LIMIT_REACHED). */
export function starterLimitMessage(t: Translate): string {
  const n = PLAN_LIMITS.starterMonthlyGenerations;
  return t(
    `Ai folosit cele ${n} generări gratuite din această lună. Treci pe Professional pentru generări nelimitate.`,
    `You have used your ${n} free generations this month. Upgrade to Professional for unlimited generations.`,
    `Vous avez utilisé vos ${n} générations gratuites ce mois-ci. Passez à Professional pour des générations illimitées.`,
  );
}
