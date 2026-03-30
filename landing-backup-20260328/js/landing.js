// iFIND v2.0 — Minimal interactions
'use strict';

const API_BASE = window.location.pathname.startsWith('/landing') ? '/landing/api' : '/api';

// Navbar scroll
const nav = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  nav && nav.classList.toggle('scrolled', window.scrollY > 50);
}, { passive: true });

// Reveal on scroll
const revealObs = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('v'); revealObs.unobserve(e.target); } });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.rv').forEach(el => revealObs.observe(el));

// FAQ accordion
document.addEventListener('click', e => {
  const q = e.target.closest('.faq-q');
  if (!q) return;
  const item = q.closest('.faq-item');
  const answer = item.querySelector('.faq-a');
  const wasActive = item.classList.contains('active');
  document.querySelectorAll('.faq-item.active').forEach(i => {
    i.classList.remove('active');
    i.querySelector('.faq-a').style.maxHeight = '0';
  });
  if (!wasActive) {
    item.classList.add('active');
    answer.style.maxHeight = answer.scrollHeight + 'px';
  }
});

// Mobile menu
const mmenu = document.getElementById('mm');
document.addEventListener('click', e => {
  if (e.target.closest('.burger')) { mmenu && mmenu.classList.add('open'); return; }
  if (e.target.closest('.mmenu-close')) { mmenu && mmenu.classList.remove('open'); return; }
  if (e.target.closest('#mm a')) { mmenu && mmenu.classList.remove('open'); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && mmenu && mmenu.classList.contains('open')) mmenu.classList.remove('open');
});

// Smooth scroll
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const id = a.getAttribute('href');
    if (id === '#' || id.startsWith('#mentions') || id.startsWith('#conf')) return;
    const t = document.querySelector(id);
    if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth' }); }
  });
});

// Counter animation
let counted = false;
const counterObs = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting && !counted) {
      counted = true;
      document.querySelectorAll('[data-count]').forEach(el => {
        const target = parseInt(el.dataset.count);
        const start = performance.now();
        const dur = 1500;
        function tick(now) {
          const p = Math.min((now - start) / dur, 1);
          el.textContent = Math.round(target * (1 - Math.pow(1 - p, 4)));
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
    }
  });
}, { threshold: 0.3 });
const results = document.getElementById('results');
if (results) counterObs.observe(results);

// Legal toggle
document.addEventListener('click', e => {
  const a = e.target.closest('a[href="#mentions-legales"],a[href="#confidentialite"]');
  if (!a) return;
  e.preventDefault();
  const id = a.getAttribute('href').substring(1);
  document.querySelectorAll('.legal').forEach(s => s.style.display = 'none');
  const el = document.getElementById(id);
  if (el) { el.style.display = 'block'; el.scrollIntoView({ behavior: 'smooth' }); }
});

// CSRF + Form
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
      .then(() => { btn.textContent = '✓ Envoyé !'; btn.style.background = 'var(--green)'; form.reset(); loadCsrf(); setTimeout(() => { btn.textContent = 'Recevoir mon rapport'; btn.style.background = ''; btn.disabled = false; }, 4000); })
      .catch(() => { loadCsrf(); btn.textContent = 'Recevoir mon rapport'; btn.disabled = false;
        const p = fd.get('prenom'), em = fd.get('email'), ci = fd.get('cible');
        window.location.href = 'mailto:alexis@getifind.fr?subject=Rapport iFIND&body=Prenom: ' + encodeURIComponent(p) + '%0AEmail: ' + encodeURIComponent(em) + '%0ACible: ' + encodeURIComponent(ci);
      });
  });
}
