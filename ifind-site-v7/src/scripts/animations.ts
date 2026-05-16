/* ============================================================
 * iFIND v7 — Animations
 * Phase 8 J10 — 3 techniques signature + Lenis smooth scroll.
 *
 * Techniques :
 * 1. Split-text reveals (Éditorial) — H1, manifeste quote, headlines
 * 2. Pinned scroll cinematic (Vérifiable) — section HowItWorks 3 étapes
 * 3. Live counter data hero (Vivant) — triggers panel rotation
 *
 * Respect prefers-reduced-motion (Classroom 03 L6 non-négociable).
 * ============================================================ */

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ────────────────────────────────────────────────────────────
 * 1. LENIS SMOOTH SCROLL (avec sync ScrollTrigger — le gotcha Classroom 03 L3)
 * ──────────────────────────────────────────────────────────── */

function initLenis() {
  if (prefersReducedMotion) return null;

  const lenis = new Lenis({
    duration: 1.2,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    touchMultiplier: 2,
  });

  // Sync Lenis ↔ ScrollTrigger (THE gotcha — Classroom 03)
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  return lenis;
}

/* ────────────────────────────────────────────────────────────
 * 2. SPLIT-TEXT REVEAL (manual wrapping + IntersectionObserver)
 * Plus performant que GSAP SplitText premium et marche partout.
 * ──────────────────────────────────────────────────────────── */

function splitTextReveal() {
  const targets = document.querySelectorAll<HTMLElement>('[data-split]');
  if (!targets.length) return;

  targets.forEach((el) => {
    // Préserver les <em> et autres balises inline en wrappant uniquement les mots
    const html = el.innerHTML;
    // Match les balises HTML OU les mots
    const parts = html.split(/(\s+|<[^>]+>[^<]*<\/[^>]+>)/g).filter(Boolean);
    el.innerHTML = '';
    let wordIndex = 0;

    parts.forEach((part) => {
      if (part.match(/^<[^>]+>/)) {
        // C'est une balise (probablement <em>...</em>) — la wrap entière comme un mot
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = part;
        const node = tempDiv.firstChild;
        if (node && node.nodeType === Node.ELEMENT_NODE) {
          const elem = node as HTMLElement;
          elem.classList.add('split-word');
          elem.style.setProperty('--word-i', String(wordIndex));
          el.appendChild(elem);
          wordIndex++;
        }
      } else if (/\s+/.test(part)) {
        el.appendChild(document.createTextNode(part));
      } else if (part.trim()) {
        const span = document.createElement('span');
        span.className = 'split-word';
        span.textContent = part;
        span.style.setProperty('--word-i', String(wordIndex));
        el.appendChild(span);
        wordIndex++;
      }
    });
  });

  if (prefersReducedMotion) {
    // En reduced-motion, on rend tout visible direct sans animation
    targets.forEach((el) => el.classList.add('in-view'));
    return;
  }

  // IntersectionObserver pour déclencher l'animation au viewport
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: '-50px 0px' }
  );

  targets.forEach((el) => observer.observe(el));
}

/* ────────────────────────────────────────────────────────────
 * 3. PINNED SCROLL CINEMATIC (HowItWorks 3 étapes)
 * GSAP ScrollTrigger pin + scrub. Le moment cinéma du site.
 * ──────────────────────────────────────────────────────────── */

function initPinnedScroll() {
  if (prefersReducedMotion) return;

  const section = document.querySelector<HTMLElement>('[data-pinned]');
  if (!section) return;

  // Wait DOM stable
  const inner = section.querySelector<HTMLElement>('.hiw-pin-inner');
  const visuals = section.querySelectorAll<HTMLElement>('[data-step-visual]');
  const texts = section.querySelectorAll<HTMLElement>('[data-step-text]');
  const stepper = section.querySelectorAll<HTMLElement>('[data-step-indicator]');

  if (!inner || visuals.length !== 3 || texts.length !== 3) return;

  // Set initial state : étape 01 visible, autres cachées
  gsap.set([visuals[1], visuals[2], texts[1], texts[2]], { opacity: 0 });
  gsap.set([visuals[0], texts[0]], { opacity: 1 });

  // Mobile : skip pinned (UX mobile a horreur du pin scrub)
  ScrollTrigger.matchMedia({
    '(min-width: 900px)': () => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: '+=200%',  // 2 viewports de scroll = pour passer les 3 étapes
          scrub: 1,
          pin: true,
          anticipatePin: 1,
        },
      });

      // Étape 01 → 02
      tl.to([visuals[0], texts[0]], { opacity: 0, duration: 0.5 }, 0.4)
        .to(stepper[0], { color: 'var(--color-ink-mute)', duration: 0.3 }, '<')
        .fromTo([visuals[1], texts[1]], { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0.5)
        .fromTo(stepper[1], { color: 'var(--color-ink-mute)' }, { color: 'var(--color-accent)', duration: 0.3 }, '<');

      // Étape 02 → 03
      tl.to([visuals[1], texts[1]], { opacity: 0, duration: 0.5 }, 1.2)
        .to(stepper[1], { color: 'var(--color-ink-mute)', duration: 0.3 }, '<')
        .fromTo([visuals[2], texts[2]], { opacity: 0 }, { opacity: 1, duration: 0.5 }, 1.3)
        .fromTo(stepper[2], { color: 'var(--color-ink-mute)' }, { color: 'var(--color-accent)', duration: 0.3 }, '<');
    },
  });
}

/* ────────────────────────────────────────────────────────────
 * 4. LIVE COUNTER DATA HERO (triggers se renouvellent en boucle)
 * Subtle "le produit est vivant" — toutes les 5s un trigger update
 * ──────────────────────────────────────────────────────────── */

function initLiveCounter() {
  if (prefersReducedMotion) return;

  const triggers = document.querySelectorAll<HTMLElement>('.trigger-list .trigger');
  if (!triggers.length) return;

  // Pool de triggers pour rotation
  const pool = [
    { icon: '€', company: 'Société #412', detail: 'Levée Series A · 12M€ · vient', score: '9.0', level: 'hot' },
    { icon: '+', company: 'Société #098', detail: 'Hire CMO · 1h', score: '8.5', level: 'hot' },
    { icon: '§', company: 'Société #221', detail: 'Dépôt INPI Class 35 · 3h', score: '7.6', level: 'warm' },
    { icon: '▲', company: 'Société #644', detail: 'Acquisition annoncée · 5h', score: '8.2', level: 'hot' },
    { icon: '€', company: 'Société #777', detail: 'Levée Seed · 3M€ · 8h', score: '7.9', level: 'warm' },
    { icon: '+', company: 'Société #312', detail: 'Hire Head of Growth · 10h', score: '7.3', level: 'warm' },
  ];

  let cycleIndex = 0;

  setInterval(() => {
    const target = triggers[cycleIndex % triggers.length];
    if (!target) return;

    const newTrigger = pool[cycleIndex % pool.length];

    // Slide out
    gsap.to(target, {
      x: 8,
      opacity: 0,
      duration: 0.3,
      ease: 'power2.in',
      onComplete: () => {
        // Update content
        target.classList.remove('trigger--hot', 'trigger--warm');
        target.classList.add(`trigger--${newTrigger.level}`);
        target.querySelector('.trigger-icon')!.textContent = newTrigger.icon;
        target.querySelector('.trigger-company')!.textContent = newTrigger.company;
        target.querySelector('.trigger-detail')!.textContent = newTrigger.detail;
        target.querySelector('.trigger-score')!.textContent = newTrigger.score;

        // Slide in
        gsap.fromTo(target,
          { x: -8, opacity: 0 },
          { x: 0, opacity: 1, duration: 0.4, ease: 'power2.out' }
        );
      },
    });

    cycleIndex++;
  }, 4500);  // toutes les 4.5s un trigger se renouvelle
}

/* ────────────────────────────────────────────────────────────
 * INIT — appelé une fois au DOMContentLoaded
 * ──────────────────────────────────────────────────────────── */

export function initAnimations() {
  initLenis();
  splitTextReveal();
  initPinnedScroll();
  initLiveCounter();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAnimations);
} else {
  initAnimations();
}
