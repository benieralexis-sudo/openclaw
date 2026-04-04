// iFIND v6.0 — Premium interactions
// Glow cards, counters, smooth reveals, pipeline animation
'use strict';

const API_BASE = window.location.pathname.startsWith('/landing') ? '/landing/api' : '/api';

// ===== NAVBAR — blur on scroll =====
const nav = document.getElementById('navbar');
let lastScroll = 0;
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  nav && nav.classList.toggle('scrolled', y > 50);
  lastScroll = y;
}, { passive: true });

// ===== REVEAL ON SCROLL — improved with stagger =====
const revealObs = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('v');
      revealObs.unobserve(e.target);
    }
  });
}, { threshold: 0.08, rootMargin: '0px 0px -60px 0px' });
document.querySelectorAll('.rv,.rv-scale').forEach(el => revealObs.observe(el));

// ===== GLOW CARD — mouse-tracking glow effect =====
document.querySelectorAll('.glow-card').forEach(card => {
  card.addEventListener('mousemove', e => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    card.style.setProperty('--glow-x', x + 'px');
    card.style.setProperty('--glow-y', y + 'px');
    const before = card.querySelector(':scope')
    if (card.style) {
      card.style.cssText += `--glow-x:${x}px;--glow-y:${y}px;`;
    }
  });
});

// Apply glow position via CSS custom properties
const glowStyle = document.createElement('style');
glowStyle.textContent = '.glow-card::before{left:var(--glow-x,50%);top:var(--glow-y,50%)}';
document.head.appendChild(glowStyle);

// ===== COUNTER ANIMATION — easeOutQuart =====
function animateCounters() {
  document.querySelectorAll('[data-count]').forEach(el => {
    if (el.dataset.counted) return;
    el.dataset.counted = '1';
    const target = parseFloat(el.dataset.count);
    const prefix = el.dataset.prefix || '';
    const suffix = el.dataset.suffix || '';
    const decimals = (target % 1 !== 0) ? 1 : 0;
    const start = performance.now();
    const dur = 2000;
    function tick(now) {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 4); // easeOutQuart
      const val = (target * eased).toFixed(decimals);
      el.textContent = prefix + val.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + suffix;
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

const counterObs = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      animateCounters();
      counterObs.unobserve(e.target);
    }
  });
}, { threshold: 0.3 });

// Observe any section with counters
document.querySelectorAll('[data-count]').forEach(el => {
  const section = el.closest('section') || el.parentElement;
  if (section) counterObs.observe(section);
});

// ===== FAQ ACCORDION — smooth animation =====
document.addEventListener('click', e => {
  const q = e.target.closest('.faq-q');
  if (!q) return;
  const item = q.closest('.faq-item');
  const answer = item.querySelector('.faq-a');
  const wasActive = item.classList.contains('active');
  // Close all
  document.querySelectorAll('.faq-item.active').forEach(i => {
    i.classList.remove('active');
    i.querySelector('.faq-a').style.maxHeight = '0';
  });
  // Open clicked (if wasn't already open)
  if (!wasActive) {
    item.classList.add('active');
    answer.style.maxHeight = answer.scrollHeight + 'px';
  }
});

// ===== MOBILE MENU =====
const mmenu = document.getElementById('mm');
document.addEventListener('click', e => {
  if (e.target.closest('.burger')) {
    mmenu && mmenu.classList.add('open');
    document.body.style.overflow = 'hidden';
    return;
  }
  if (e.target.closest('.mmenu-close') || e.target.closest('#mm a')) {
    mmenu && mmenu.classList.remove('open');
    document.body.style.overflow = '';
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && mmenu && mmenu.classList.contains('open')) {
    mmenu.classList.remove('open');
    document.body.style.overflow = '';
  }
});

// ===== SMOOTH SCROLL =====
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const id = a.getAttribute('href');
    if (id === '#' || id.startsWith('#mentions') || id.startsWith('#conf')) return;
    const t = document.querySelector(id);
    if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth' }); }
  });
});

// ===== PRICING CARD — tilt on hover =====
document.querySelectorAll('.pr-card').forEach(card => {
  card.addEventListener('mousemove', e => {
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    card.style.transform = `translateY(-6px) perspective(600px) rotateX(${-y * 4}deg) rotateY(${x * 4}deg)`;
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = '';
  });
});

// ===== PIPELINE DOTS — restart animation on scroll =====
const pipelineObs = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.querySelectorAll('.dot').forEach(dot => {
        dot.style.animation = 'none';
        dot.offsetHeight; // trigger reflow
        dot.style.animation = '';
      });
    }
  });
}, { threshold: 0.5 });
const pipeline = document.querySelector('.pipeline-flow');
if (pipeline) pipelineObs.observe(pipeline);

// ===== TYPING EFFECT — hero subtitle =====
// (subtle: makes the guarantee badge pulse once on load)
setTimeout(() => {
  const badge = document.querySelector('.hero-guarantee');
  if (badge) {
    badge.style.transition = 'all 0.6s var(--ease-spring)';
    badge.style.transform = 'scale(1.05)';
    setTimeout(() => { badge.style.transform = ''; }, 600);
  }
}, 2000);

// ===== LEGAL TOGGLE =====
document.addEventListener('click', e => {
  const a = e.target.closest('a[href="#mentions-legales"],a[href="#confidentialite"]');
  if (!a) return;
  e.preventDefault();
  const id = a.getAttribute('href').substring(1);
  document.querySelectorAll('.legal').forEach(s => s.style.display = 'none');
  const el = document.getElementById(id);
  if (el) { el.style.display = 'block'; el.scrollIntoView({ behavior: 'smooth' }); }
});

// ===== CSRF + FORM =====
function loadCsrf() {
  fetch(API_BASE + '/csrf-token').then(r => r.json()).then(d => {
    const el = document.getElementById('csrf-token');
    if (el && d.token) el.value = d.token;
  }).catch(() => {});
}
loadCsrf();

const form = document.getElementById('reportForm');
if (form) {
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    const fd = new FormData(form);
    const btn = document.getElementById('submitBtn');
    const prenom = form.querySelector('[name="prenom"]');
    const email = form.querySelector('[name="email"]');
    const cible = form.querySelector('[name="cible"]');
    if (prenom.value.trim().length < 2) { prenom.focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { email.focus(); return; }
    if (cible.value.trim().length < 10) { cible.focus(); return; }
    btn.textContent = 'Envoi...'; btn.disabled = true;
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 10000);
    fetch(API_BASE + '/lead-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(fd)), signal: ac.signal })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(() => { btn.textContent = '\u2713 Envoy\u00e9 !'; btn.style.background = 'var(--green)'; form.reset(); loadCsrf(); setTimeout(() => { btn.textContent = 'Recevoir mon rapport'; btn.style.background = ''; btn.disabled = false; }, 4000); })
      .catch(() => { loadCsrf(); btn.textContent = 'Recevoir mon rapport'; btn.disabled = false;
        const p = fd.get('prenom'), em = fd.get('email'), ci = fd.get('cible');
        window.location.href = 'mailto:alexis@getifind.fr?subject=Rapport iFIND&body=Prenom: ' + encodeURIComponent(p) + '%0AEmail: ' + encodeURIComponent(em) + '%0ACible: ' + encodeURIComponent(ci);
      });
  });
}
