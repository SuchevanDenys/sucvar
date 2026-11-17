// app/lib/theme/motion.ts
// Micro-interacțiuni tactile comune (Tailwind v4: `translate` / `scale` sunt proprietăți CSS separate de
// `transform`, deci trebuie numite explicit în lista de tranziție). Clase complete, ca Tailwind să le vadă.

/** Ușurare „arhitecturală”: pornire fermă, așezare lungă și moale. */
const EASE = 'ease-[cubic-bezier(.2,.7,.2,1)]';

/**
 * Card / pastilă interactivă: ridicare 2px la hover, apăsare 0.99 la click. Fără mișcare pentru
 * reduced-motion sau elemente dezactivate. Combinați cu culorile de hover ale bordurii/inelului.
 */
export const TACTILE =
  `transition-[color,background-color,border-color,box-shadow,translate,scale] duration-300 ${EASE} ` +
  'hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] ' +
  'motion-reduce:transition-colors motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100 ' +
  'disabled:hover:translate-y-0 disabled:active:scale-100';

/** Doar apăsarea (fără ridicare): pentru controale compacte în bare segmentate. */
export const PRESS =
  `transition-[color,background-color,border-color,box-shadow,scale] duration-200 ${EASE} ` +
  'active:scale-[0.99] motion-reduce:active:scale-100 disabled:active:scale-100';
