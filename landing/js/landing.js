// iFIND Landing — Premium dark mode B2B SaaS
'use strict';

const API_BASE = window.location.pathname.startsWith('/landing') ? '/landing/api' : '/api';
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── 1. Cursor Glow (hero only, desktop) ──
(function initCursorGlow() {
  if (prefersReducedMotion || window.matchMedia('(max-width: 768px)').matches) return;
  const glow = document.createElement('div');
  glow.className = 'cursor-glow';
  document.body.appendChild(glow);
  const hero = document.querySelector('.hero');
  if (!hero) return;
  let visible = false;
  document.addEventListener('mousemove', e => {
    const rect = hero.getBoundingClientRect();
    const inside = e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (inside && !visible) { glow.style.opacity = '1'; visible = true; }
    if (!inside && visible) { glow.style.opacity = '0'; visible = false; }
    if (inside) { glow.style.left = e.clientX + 'px'; glow.style.top = e.clientY + 'px'; }
  });
})();

// ── 2. Navbar scroll (glass effect) + mobile CTA visibility ──
const nb = document.getElementById('navbar');
if (nb) {
  window.addEventListener('scroll', () => {
    nb.classList.toggle('scrolled', window.scrollY > 50);
    const fr = document.getElementById('free-report');
    const mc = document.querySelector('.mobile-cta');
    if (fr && mc) {
      const r = fr.getBoundingClientRect();
      const vis = r.top < window.innerHeight && r.bottom > 0;
      mc.style.opacity = vis ? '0' : '1';
      mc.style.pointerEvents = vis ? 'none' : 'auto';
    }
  });
}

// ── 3. Scroll Reveal (IntersectionObserver) ──
const obs = new IntersectionObserver(entries => {
  entries.forEach(x => {
    if (!x.isIntersecting) return;
    x.target.classList.add('v');
    if (x.target.id === 'heroBrowser') animateDashboard();
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.rv').forEach(el => obs.observe(el));
const heroBrowser = document.getElementById('heroBrowser');
if (heroBrowser) obs.observe(heroBrowser);

// ── 4. Counter Animation (ease-out expo, 2s) ──
function animateCounter(el, target) {
  if (prefersReducedMotion) { el.textContent = target; return; }
  const duration = 2000, start = performance.now();
  function update(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 4);
    el.textContent = Math.round(eased * target);
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

// ── 5. Dashboard bars animation ──
let dashAnimated = false;
function animateDashboard() {
  if (dashAnimated) return;
  dashAnimated = true;
  document.querySelectorAll('[data-count]').forEach(el => {
    animateCounter(el, parseInt(el.dataset.count));
  });
  setTimeout(() => {
    document.querySelectorAll('.db-bar').forEach((b, i) => {
      setTimeout(() => b.classList.add('animated'), i * 80);
    });
  }, 200);
}

// ── 6. FAQ Accordion (event delegation + ARIA) ──
document.addEventListener('click', e => {
  const q = e.target.closest('.faq-q');
  if (!q) return;
  const item = q.parentElement;
  const answer = item.querySelector('.faq-a');
  const wasActive = item.classList.contains('active');
  // Close all
  document.querySelectorAll('.faq-i.active').forEach(x => {
    x.classList.remove('active');
    x.querySelector('.faq-a').style.maxHeight = '0';
    const btn = x.querySelector('.faq-q');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
  // Open clicked if it wasn't active
  if (!wasActive) {
    item.classList.add('active');
    answer.style.maxHeight = answer.scrollHeight + 'px';
    q.setAttribute('aria-expanded', 'true');
  }
});

// ── 7. Pricing Toggle (monthly / annual) ──
document.querySelectorAll('.pricing-toggle-option').forEach(opt => {
  opt.addEventListener('click', () => {
    const isAnnual = opt.dataset.period === 'annual';
    document.querySelectorAll('.pricing-toggle-option').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    document.querySelectorAll('[data-monthly]').forEach(price => {
      const monthly = parseInt(price.dataset.monthly);
      const annual = Math.round(monthly * 0.85);
      const amEl = price.querySelector('.am:not(.pr-old)');
      const peEl = price.querySelector('.pe');
      if (amEl) {
        amEl.style.opacity = '0';
        setTimeout(() => {
          amEl.textContent = (isAnnual ? annual : monthly) + '\u20AC';
          amEl.style.opacity = '1';
        }, 150);
      }
      if (peEl) peEl.textContent = isAnnual ? '/ mois (annuel)' : '/ mois';
    });
    // Toggle save badge visibility
    document.querySelectorAll('.save-badge').forEach(b => {
      b.style.display = isAnnual ? 'inline-block' : 'none';
    });
  });
});

// ── 8. Mobile Menu (focus trap + Escape) ──
const mobileMenu = document.getElementById('mm');
const burger = document.querySelector('.burger');
let lastFocusBeforeMenu = null;

function openMobileMenu() {
  if (!mobileMenu || !burger) return;
  lastFocusBeforeMenu = document.activeElement;
  mobileMenu.classList.add('open');
  burger.setAttribute('aria-expanded', 'true');
  const closeBtn = mobileMenu.querySelector('.mobile-close');
  if (closeBtn) closeBtn.focus();
}

function closeMobileMenu() {
  if (!mobileMenu || !burger) return;
  mobileMenu.classList.remove('open');
  burger.setAttribute('aria-expanded', 'false');
  if (lastFocusBeforeMenu) lastFocusBeforeMenu.focus();
}

document.addEventListener('click', e => {
  if (e.target.closest('.burger')) { openMobileMenu(); return; }
  if (e.target.closest('.mobile-close')) { closeMobileMenu(); return; }
  if (e.target.closest('#mm a')) closeMobileMenu();
});

document.addEventListener('keydown', e => {
  if (!mobileMenu || !mobileMenu.classList.contains('open')) return;
  if (e.key === 'Escape') { closeMobileMenu(); return; }
  if (e.key !== 'Tab') return;
  const focusable = mobileMenu.querySelectorAll('button, a[href]');
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

// ── 9. Marquee pause on hover ──
const marqueeTrack = document.querySelector('.marquee-track');
if (marqueeTrack) {
  marqueeTrack.addEventListener('mouseenter', () => { marqueeTrack.style.animationPlayState = 'paused'; });
  marqueeTrack.addEventListener('mouseleave', () => { marqueeTrack.style.animationPlayState = 'running'; });
}

// ── 10. CSRF token loader + Form submit ──
function loadCsrfToken() {
  fetch(API_BASE + '/csrf-token').then(r => r.json()).then(d => {
    const el = document.getElementById('csrf-token');
    if (el && d.token) el.value = d.token;
  }).catch(() => {});
}
loadCsrfToken();

function showFieldError(input, message) {
  const fg = input.closest('.fg');
  if (!fg) return;
  clearFieldError(input);
  fg.classList.add('fg-error');
  const span = document.createElement('span');
  span.className = 'field-error';
  span.textContent = message;
  fg.appendChild(span);
  input.addEventListener('input', function handler() { clearFieldError(input); input.removeEventListener('input', handler); });
}

function clearFieldError(input) {
  const fg = input.closest('.fg');
  if (!fg) return;
  fg.classList.remove('fg-error');
  const err = fg.querySelector('.field-error');
  if (err) err.remove();
}

const reportForm = document.getElementById('reportForm');
if (reportForm) {
  reportForm.addEventListener('submit', function(e) {
    e.preventDefault();
    const f = e.target, d = new FormData(f), b = document.getElementById('submitBtn');
    const prenom = f.querySelector('[name="prenom"]');
    const email = f.querySelector('[name="email"]');
    const cible = f.querySelector('[name="cible"]');
    if (prenom.value.trim().length < 2) { prenom.focus(); showFieldError(prenom, 'Pr\u00e9nom trop court'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { email.focus(); showFieldError(email, 'Email invalide'); return; }
    if (cible.value.trim().length < 10) { cible.focus(); showFieldError(cible, 'D\u00e9crivez votre cible plus pr\u00e9cis\u00e9ment'); return; }

    b.innerHTML = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Envoi en cours...';
    b.style.opacity = '.7'; b.disabled = true;
    const ac = new AbortController(), tid = setTimeout(() => ac.abort(), 10000);

    fetch(API_BASE + '/lead-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(d)), signal: ac.signal })
      .then(r => { clearTimeout(tid); if (!r.ok) throw new Error(); return r.json(); })
      .then(() => {
        b.innerHTML = '\u2713 Demande envoy\u00e9e !'; b.style.background = 'var(--green)'; f.reset(); loadCsrfToken();
        const st = document.getElementById('form-status');
        st.style.display = 'block'; st.style.background = 'rgba(34,197,94,0.1)'; st.style.color = 'var(--green)';
        st.textContent = 'Demande envoy\u00e9e avec succ\u00e8s ! Vous recevrez votre rapport par email.';
        setTimeout(() => {
          b.innerHTML = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Recevoir mon rapport gratuit';
          b.style.opacity = '1'; b.style.background = ''; b.disabled = false; st.style.display = 'none';
        }, 5000);
      })
      .catch(() => {
        clearTimeout(tid); loadCsrfToken();
        const st = document.getElementById('form-status');
        st.style.display = 'block'; st.style.background = 'rgba(239,68,68,0.1)'; st.style.color = 'var(--accent-red,#ef4444)';
        st.textContent = 'Erreur d\u2019envoi. Redirection vers email...';
        const p = d.get('prenom'), em = d.get('email'), ci = d.get('cible');
        setTimeout(() => {
          window.location.href = 'mailto:hello@ifind.fr?subject=Demande rapport iFIND - ' + encodeURIComponent(p) + '&body=Prenom: ' + encodeURIComponent(p) + '%0AEmail: ' + encodeURIComponent(em) + '%0ACible: ' + encodeURIComponent(ci);
        }, 1500);
        b.innerHTML = 'Recevoir mon rapport gratuit'; b.style.opacity = '1'; b.disabled = false;
      });
  });
}

// ── 11. Smooth scroll for anchor links ──
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const id = a.getAttribute('href');
    if (id === '#mentions-legales' || id === '#confidentialite') return; // handled by legal toggle
    const target = document.querySelector(id);
    if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth' }); }
  });
});

// ── 12. Legal pages toggle ──
function showLegal(id) {
  document.querySelectorAll('#mentions-legales, #confidentialite').forEach(s => { s.style.display = 'none'; });
  const el = document.getElementById(id);
  if (el) { el.style.display = 'block'; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}

document.addEventListener('click', e => {
  const a = e.target.closest('a[href="#mentions-legales"], a[href="#confidentialite"]');
  if (a) { e.preventDefault(); showLegal(a.getAttribute('href').substring(1)); }
});
