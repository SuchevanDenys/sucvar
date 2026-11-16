// app/lib/theme/tokens.ts
// Color classes used by every page (language/theme state lives in usePrefs.ts).
//
// Design invariant — "Bordeaux + Warm Alabaster & Champagne" (mirrors skin.ts):
//   light  #FFFFFF page · #FAF8F6 / #F5F2EF alabaster · #1B1416 espresso ink · bordeaux #5C1628
//   dark   #110D0F page · #1A1416 cards · #2E2427 lines · #F5F2EF ink · ruby-bordeaux #C94A6A
// Status colours (red errors, amber limits) remain the only other hues.
// Classes are spelled out in full because Tailwind cannot detect class names assembled by interpolation.

const lightUi = {
  page: 'bg-white text-[#1B1416]',
  header: 'bg-white/90 backdrop-blur-md border-[#E8E2E0] text-[#1B1416]',
  card: 'bg-white border-[#E8E2E0] text-[#1B1416]',
  soft: 'bg-[#FAF8F6]',
  line: 'border-[#E8E2E0]',
  muted: 'text-[#685D60]',
  accent: 'text-[#5C1628]',
  btn: 'bg-[#5C1628] text-white hover:bg-[#450E1D] active:bg-[#360A16]',
  btnGhost:
    'border-[#E8E2E0] text-[#1B1416] hover:border-[#5C1628]/40 hover:text-[#5C1628] hover:bg-[#FAF8F6]',
  input: 'border-[#E8E2E0] text-[#1B1416] focus:border-[#5C1628]',
};

const darkUi = {
  page: 'bg-[#110D0F] text-[#F5F2EF]',
  header: 'bg-[#110D0F]/90 backdrop-blur-md border-[#2E2427] text-[#F5F2EF]',
  card: 'bg-[#1A1416] border-[#2E2427] text-[#F5F2EF]',
  soft: 'bg-[#231B1E]',
  line: 'border-[#2E2427]',
  muted: 'text-[#B5A9AC]',
  accent: 'text-[#D65D7B]',
  btn: 'bg-[#C94A6A] text-white hover:bg-[#D65D7B]',
  btnGhost:
    'border-[#2E2427] text-[#F5F2EF] hover:border-[#C94A6A]/60 hover:bg-[#231B1E]',
  input: 'border-[#2E2427] text-[#F5F2EF] focus:border-[#C94A6A]',
};

// Every page calls getUi(isDark) and uses the returned classes
export function getUi(isDark: boolean) {
  if (isDark) {
    return darkUi;
  }
  return lightUi;
}
