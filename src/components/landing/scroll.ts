/** Scroll progress shared between the page and the 3D stage, outside React. */
export const scroll = { progress: 0, chapter: 0, local: 0 };

/** Section boundaries as page-progress fractions: hero, thrower, machinist, surgeon, pipeline. */
export const CHAPTERS = [0, 0.16, 0.38, 0.6, 0.82, 1];

export function updateScroll() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  scroll.progress = p;
  let c = 0;
  while (c < CHAPTERS.length - 2 && p >= CHAPTERS[c + 1]) c++;
  scroll.chapter = c;
  scroll.local = (p - CHAPTERS[c]) / (CHAPTERS[c + 1] - CHAPTERS[c]);
}
