// app/lib/theme/skin.ts
// SUCVAR design skin — single source of truth for the "Bordeaux + Warm Alabaster & Champagne" look.
// Presentational components that use it live in components/ui/Editorial.tsx.
//
//   light  #FFFFFF page · #FAF8F6 / #F5F2EF alabaster surfaces · #E8E2E0 hairlines
//          #1B1416 espresso ink · #685D60 slate body · bordeaux #5C1628 (hover #450E1D, active #360A16)
//   dark   #110D0F obsidian page · #1A1416 cards · #2E2427 hairlines
//          #F5F2EF ivory ink · #B5A9AC muted · ruby-bordeaux #C94A6A (hover #D65D7B)
//   brass  #A67C52 champagne micro-accents (PRO / premium markers only, never body text on white)
//
// Contrast notes (WCAG 2.1): white on #5C1628 ≈ 12:1, white on #C94A6A ≈ 6:1, #685D60 on #FFF ≈ 6.3:1,
// #D65D7B on #110D0F ≈ 5.2:1 (used for bordeaux *text* in dark mode — #C94A6A alone is only ≈ 3.2:1).

export interface Skin {
  page: string;      // page background + base text
  header: string;   // sticky bars
  card: string;     // elevated surface (use with `border`)
  cell: string;     // opaque cell for hairline grids
  gap: string;      // background of a grid whose gap-px forms hairlines
  popover: string;  // dropdowns / menus
  line: string;     // border colour for 1px dividers
  divide: string;   // divide-y colour
  strong: string;   // primary ink titles
  muted: string;    // secondary body text
  dim: string;      // tertiary text
  accent: string;   // emphasis text (bordeaux)
  input: string;    // input / select borders + states (use with `border`)
  btn: string;      // primary button (bordeaux)
  btnGhost: string; // secondary button
  segOn: string;    // active segment / selected chip (translucent bordeaux tint)
  segOff: string;   // idle segment
  option: string;   // <option> colours
  grid: string;     // blueprint grid background
  rowHover: string;
  soft: string;     // alabaster secondary surface
  brand: string;     // solid bordeaux fill for bars, dots, progress, toggles
  brandText: string; // bordeaux text that passes AA on the page background
  brandBorder: string;
  chipOn: string;    // selected chip / card: tint background + tinted border + bordeaux text (use with `border`)
  brassBadge: string; // champagne "PRO" tag (use with `border`)
  brassDot: string;   // champagne indicator dot / rule
}

const GRID_DARK =
  'bg-[linear-gradient(to_right,rgba(245,242,239,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(245,242,239,0.035)_1px,transparent_1px)] bg-[size:56px_56px]';
const GRID_LIGHT =
  'bg-[linear-gradient(to_right,rgba(27,20,22,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(27,20,22,0.04)_1px,transparent_1px)] bg-[size:56px_56px]';

export function getSkin(isDark: boolean): Skin {
  if (isDark) {
    return {
      page: 'page-ambient bg-[#110D0F] text-[#F5F2EF] selection:bg-[#C94A6A]/30 selection:text-[#F5F2EF]',
      header: 'bg-[#110D0F]/90 backdrop-blur-md border-[#2E2427]',
      card: 'bg-[#1A1416] border-[#2E2427] shadow-[0_1px_2px_rgba(0,0,0,0.25)]',
      cell: 'bg-[#1A1416]',
      gap: 'bg-[#2E2427]',
      popover: 'bg-[#1A1416] border-[#2E2427] text-[#F5F2EF] shadow-[0_16px_40px_-16px_rgba(0,0,0,0.7)]',
      line: 'border-[#2E2427]',
      divide: 'divide-[#2E2427]',
      strong: 'text-[#F5F2EF]',
      muted: 'text-[#B5A9AC]',
      dim: 'text-[#B5A9AC]/80',
      accent: 'text-[#D65D7B]',
      input:
        'bg-[#110D0F] border-[#2E2427] text-[#F5F2EF] placeholder:text-[#8A7D80] hover:border-[#4A3A3F] focus:border-[#C94A6A] focus:outline-none focus:ring-[3px] focus:ring-[#C94A6A]/20 transition-[border-color,box-shadow] duration-200',
      btn: 'bg-[#C94A6A] text-white hover:bg-[#D65D7B] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100 disabled:hover:translate-y-0 disabled:active:scale-100 active:bg-[#B63F5D] border border-transparent shadow-[0_8px_24px_-12px_rgba(201,74,106,0.55)] transition-[background-color,box-shadow,translate,scale] duration-200',
      btnGhost:
        'border border-[#2E2427] text-[#F5F2EF] hover:bg-[#231B1E] hover:border-[#C94A6A]/60 active:scale-[0.99] motion-reduce:active:scale-100 transition-[background-color,border-color,color,scale] duration-200',
      segOn: 'bg-[#C94A6A]/[0.14] text-[#E07F98] shadow-[inset_0_0_0_1px_rgba(201,74,106,0.4)]',
      segOff: 'text-[#B5A9AC] hover:text-[#F5F2EF] hover:bg-[#231B1E]',
      option: 'bg-[#1A1416] text-[#F5F2EF]',
      grid: GRID_DARK,
      rowHover: 'hover:bg-[#231B1E]',
      soft: 'bg-[#231B1E]',
      brand: 'bg-[#C94A6A]',
      brandText: 'text-[#D65D7B]',
      brandBorder: 'border-[#C94A6A]',
      chipOn: 'bg-[#C94A6A]/[0.12] border-[#C94A6A]/45 text-[#E07F98]',
      brassBadge: 'bg-[#A67C52]/[0.14] border-[#A67C52]/45 text-[#D2AE87]',
      brassDot: 'bg-[#C49A6C]',
    };
  }
  return {
    page: 'page-ambient bg-white text-[#1B1416] selection:bg-[#5C1628]/15 selection:text-[#5C1628]',
    header: 'bg-white/90 backdrop-blur-md border-[#E8E2E0]',
    card: 'bg-white border-[#E8E2E0] shadow-[0_1px_2px_rgba(27,20,22,0.04),0_8px_24px_-20px_rgba(27,20,22,0.12)]',
    cell: 'bg-white',
    gap: 'bg-[#E8E2E0]',
    popover: 'bg-white border-[#E8E2E0] text-[#1B1416] shadow-[0_16px_40px_-20px_rgba(27,20,22,0.28)]',
    line: 'border-[#E8E2E0]',
    divide: 'divide-[#E8E2E0]',
    strong: 'text-[#1B1416]',
    muted: 'text-[#685D60]',
    dim: 'text-[#685D60]/85',
    accent: 'text-[#5C1628]',
    input:
      'bg-white border-[#E8E2E0] text-[#1B1416] placeholder:text-[#A99EA1] hover:border-[#CEC4C1] focus:border-[#5C1628] focus:outline-none focus:ring-[3px] focus:ring-[#5C1628]/10 transition-[border-color,box-shadow] duration-200',
    btn: 'bg-[#5C1628] text-white hover:bg-[#450E1D] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100 disabled:hover:translate-y-0 disabled:active:scale-100 active:bg-[#360A16] border border-transparent shadow-[0_8px_24px_-14px_rgba(92,22,40,0.6)] transition-[background-color,box-shadow,translate,scale] duration-200',
    btnGhost:
      'border border-[#E8E2E0] text-[#1B1416] hover:bg-[#FAF8F6] hover:border-[#5C1628]/40 hover:text-[#5C1628] active:scale-[0.99] motion-reduce:active:scale-100 transition-[background-color,border-color,color,scale] duration-200',
    segOn: 'bg-[rgba(92,22,40,0.05)] text-[#5C1628] shadow-[inset_0_0_0_1px_rgba(92,22,40,0.2)]',
    segOff: 'text-[#685D60] hover:text-[#1B1416] hover:bg-[#FAF8F6]',
    option: 'bg-white text-[#1B1416]',
    grid: GRID_LIGHT,
    rowHover: 'hover:bg-[#FAF8F6]',
    soft: 'bg-[#FAF8F6]',
    brand: 'bg-[#5C1628]',
    brandText: 'text-[#5C1628]',
    brandBorder: 'border-[#5C1628]',
    chipOn: 'bg-[rgba(92,22,40,0.05)] border-[rgba(92,22,40,0.2)] text-[#5C1628]',
    brassBadge: 'bg-[#A67C52]/[0.08] border-[#A67C52]/40 text-[#7D5A35]',
    brassDot: 'bg-[#A67C52]',
  };
}

/** Micro uppercase mono label: use for eyebrows, field labels, codes. */
export const EYEBROW = 'text-[10px] tracking-[0.22em] uppercase font-mono';

/** Editorial container (Lovable `container-editorial`): 1240px, 24px → 40px gutters. */
export const CONTAINER = 'w-full max-w-[1240px] mx-auto px-6 lg:px-10';

/**
 * Bandă de secțiune alternativă (ritm alb ↔ alabastru): light #FAF8F6, dark un obsidian ușor ridicat
 * (#140F11, între pagină #110D0F și carduri #1A1416, ca toate cardurile să rămână vizibile pe ea).
 */
export function bandClass(isDark: boolean): string {
  return isDark ? 'bg-[#140F11]' : 'bg-[#FAF8F6]';
}

/** 1px horizontal rule used next to eyebrows (Lovable `h-px w-8 bg-border-strong`). */
export function ruleClass(isDark: boolean): string {
  return isDark ? 'bg-[#F5F2EF]/25' : 'bg-[#1B1416]/25';
}


/** Eșantion de culoare tactil: margine fină + inel interior pentru contrast pe orice fundal. */
export function swatchClass(isDark: boolean, size: 'sm' | 'md' = 'md'): string {
  const dim = size === 'sm' ? 'w-2.5 h-2.5' : 'w-4 h-4';
  const ring = isDark
    ? 'border-[#F5F2EF]/20 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.35)]'
    : 'border-[#1B1416]/15 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.4)]';
  return `${dim} rounded-sm border ${ring} transition-transform duration-200 group-hover:scale-110`;
}
