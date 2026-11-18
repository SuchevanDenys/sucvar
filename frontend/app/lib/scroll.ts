// app/lib/scroll.ts
// Défilement vers les ancres de la page d'accueil (#planuri, #proof, …).
//
// Alignement : la cible est placée juste sous la barre de navigation collante, avec une respiration fixe
// (ANCHOR_GAP_PX). On mesure la hauteur RÉELLE de l'en-tête (safe-area iOS comprise) au lieu d'un offset
// figé, puis on réaligne une fois le défilement terminé (`scrollend`) : si des images ou des polices ont
// décalé la mise en page pendant l'animation, la section finit quand même cadrée, sans vide disgracieux.
// La classe `scroll-mt-24` posée sur les cibles reste le repli natif (lien direct, sans JavaScript).

/** Ancre de la section des offres ; utilisée par la Navbar et tous les liens « voir les offres ». */
export const PRICING_ANCHOR = 'planuri';
export const PRICING_HREF = `/#${PRICING_ANCHOR}`;

/** Ancre de la section FAQ (§07) ; utilisée par le lien « Întrebări frecvente » du Footer. */
export const FAQ_ANCHOR = 'faq';
export const FAQ_HREF = `/#${FAQ_ANCHOR}`;

/** Espace entre le bas de la barre collante et le haut du contenu ciblé. */
export const ANCHOR_GAP_PX = 32;

/** Attribut posé sur l'en-tête collant (Navbar) pour mesurer sa hauteur. */
export const STICKY_HEADER_ATTR = 'data-sticky-header';

function headerHeight(): number {
  const header = document.querySelector<HTMLElement>(`[${STICKY_HEADER_ATTR}]`);
  return header ? header.getBoundingClientRect().height : 64;
}

function targetTop(el: HTMLElement): number {
  return Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY - headerHeight() - ANCHOR_GAP_PX));
}

/** Défile jusqu'à l'élément `id`. Respecte prefers-reduced-motion. Renvoie false si la cible manque. */
export function scrollToAnchor(id: string, behavior: ScrollBehavior = 'smooth'): boolean {
  if (typeof document === 'undefined' || !id) return false;
  const el = document.getElementById(id);
  if (!el) return false;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const mode: ScrollBehavior = reduce ? 'instant' : behavior;
  window.scrollTo({ top: targetTop(el), behavior: mode });

  // Réalignement final : corrige un éventuel décalage de mise en page survenu pendant l'animation.
  const settle = () => {
    const top = targetTop(el);
    if (Math.abs(window.scrollY - top) > 2) window.scrollTo({ top, behavior: 'instant' });
  };
  if (mode === 'smooth' && 'onscrollend' in window) {
    window.addEventListener('scrollend', settle, { once: true });
  } else {
    window.setTimeout(settle, mode === 'smooth' ? 700 : 0);
  }
  return true;
}
