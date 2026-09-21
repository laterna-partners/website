// Foundations layer: shared page behaviour. Imported once from Base.astro
// (initReveal / initHeroWatch run on DOMContentLoaded); components may
// import copyText directly wherever they need a copy-to-clipboard action.

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const MAX_STAGGER_INDEX = 5; // six siblings: indices 0-5

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Wires up the scroll-triggered fade-and-rise for every element carrying
 * [data-reveal]. Siblings inside a [data-reveal-group] parent are given a
 * --reveal-i custom property (0-5) so the .reveal CSS can stagger them
 * 60ms apart, up to six at a time. Each element reveals once: after it
 * has entered the viewport it is unobserved. Under prefers-reduced-motion
 * this is a no-op beyond marking every element already revealed.
 */
export function initReveal(): void {
  if (typeof document === 'undefined') return;

  const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
  if (elements.length === 0) return;

  document.querySelectorAll<HTMLElement>('[data-reveal-group]').forEach((group) => {
    const siblings = Array.from(group.querySelectorAll<HTMLElement>('[data-reveal]'));
    siblings.forEach((el, index) => {
      el.style.setProperty('--reveal-i', String(Math.min(index, MAX_STAGGER_INDEX)));
    });
  });

  elements.forEach((el) => el.classList.add('reveal'));

  if (prefersReducedMotion()) {
    elements.forEach((el) => el.classList.add('is-in'));
    return;
  }

  if (typeof IntersectionObserver === 'undefined') {
    // No observer support: show everything rather than hide it forever.
    elements.forEach((el) => el.classList.add('is-in'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        obs.unobserve(entry.target);
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
  );

  elements.forEach((el) => observer.observe(el));
}

/**
 * Watches the hero's action row ([data-hero-actions], the Call / WhatsApp
 * buttons) and toggles body.is-past-hero once that row has scrolled up
 * out of the viewport. SiteHeader and StickyCall read this class to decide
 * when to become sticky / slide in.
 */
export function initHeroWatch(): void {
  if (typeof document === 'undefined') return;

  const target = document.querySelector<HTMLElement>('[data-hero-actions]');
  if (!target) return;

  if (typeof IntersectionObserver === 'undefined') return;

  const observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry) return;
      const pastHero = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      document.body.classList.toggle('is-past-hero', pastHero);
    },
    { threshold: 0 },
  );

  observer.observe(target);
}

/**
 * Copies text to the clipboard, preferring the async Clipboard API and
 * falling back to a hidden, selected textarea + execCommand('copy') for
 * contexts where it is unavailable (non-secure context, older browsers).
 * Resolves true only when the copy is believed to have succeeded.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the textarea fallback
    }
  }

  if (typeof document === 'undefined') return false;

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
