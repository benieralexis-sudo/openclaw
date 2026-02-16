// iFIND Landing — External JS (zero inline handlers)
'use strict';

// --- API base path detection ---
const API_BASE = window.location.pathname.startsWith('/landing') ? '/landing/api' : '/api';

// --- Legal pages toggle ---
function showLegal(id){
  document.querySelectorAll('#mentions-legales,#confidentialite').forEach(s=>s.style.display='none');
  const el=document.getElementById(id);
  if(el){el.style.display='block';el.scrollIntoView({behavior:'smooth',block:'start'})}
}

// Handle legal anchor clicks
document.addEventListener('click',e=>{
  const a=e.target.closest('a[href="#mentions-legales"],a[href="#confidentialite"]');
  if(a){e.preventDefault();showLegal(a.getAttribute('href').substring(1))}
});

// --- Navbar scroll ---
const nb=document.getElementById('navbar');
if(nb){
  window.addEventListener('scroll',()=>{
    nb.classList.toggle('scrolled',window.scrollY>50);
    const fr=document.getElementById('free-report');
    const mc=document.querySelector('.mobile-cta');
    if(fr&&mc){const r=fr.getBoundingClientRect();mc.style.opacity=r.top<window.innerHeight&&r.bottom>0?'0':'1';mc.style.pointerEvents=r.top<window.innerHeight&&r.bottom>0?'none':'auto'}
  });
}

// --- Reveal on scroll ---
const obs=new IntersectionObserver(e=>e.forEach(x=>{if(x.isIntersecting){x.target.classList.add('v');if(x.target.id==='heroBrowser')animateDashboard()}}),{threshold:.1,rootMargin:'0px 0px -40px 0px'});
document.querySelectorAll('.rv').forEach(el=>obs.observe(el));
const heroBrowser=document.getElementById('heroBrowser');
if(heroBrowser)obs.observe(heroBrowser);

// --- Counter animation ---
let dashAnimated=false;
function animateDashboard(){
  if(dashAnimated)return;dashAnimated=true;
  document.querySelectorAll('[data-count]').forEach(el=>{
    const target=parseInt(el.dataset.count);
    const duration=1200;const start=performance.now();
    function tick(now){
      const p=Math.min((now-start)/duration,1);
      const eased=1-Math.pow(1-p,3);
      el.textContent=Math.round(target*eased);
      if(p<1)requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
  setTimeout(()=>{
    document.querySelectorAll('.db-bar').forEach((b,i)=>{
      setTimeout(()=>b.classList.add('animated'),i*80);
    });
  },200);
}

// --- FAQ toggle (event delegation + ARIA) ---
document.addEventListener('click',e=>{
  const q=e.target.closest('.faq-q');
  if(!q)return;
  const i=q.parentElement,a=i.querySelector('.faq-a'),active=i.classList.contains('active');
  // Close all
  document.querySelectorAll('.faq-i.active').forEach(x=>{
    x.classList.remove('active');
    x.querySelector('.faq-a').style.maxHeight='0';
    const btn=x.querySelector('.faq-q');
    if(btn)btn.setAttribute('aria-expanded','false');
  });
  // Open clicked (if wasn't active)
  if(!active){
    i.classList.add('active');
    a.style.maxHeight=a.scrollHeight+'px';
    q.setAttribute('aria-expanded','true');
  }
});

// --- Mobile menu (event delegation + focus trap + Escape) ---
const mobileMenu=document.getElementById('mm');
const burger=document.querySelector('.burger');
let lastFocusBeforeMenu=null;

function openMobileMenu(){
  if(!mobileMenu||!burger)return;
  lastFocusBeforeMenu=document.activeElement;
  mobileMenu.classList.add('open');
  burger.setAttribute('aria-expanded','true');
  // Focus the close button
  const closeBtn=mobileMenu.querySelector('.mobile-close');
  if(closeBtn)closeBtn.focus();
}

function closeMobileMenu(){
  if(!mobileMenu||!burger)return;
  mobileMenu.classList.remove('open');
  burger.setAttribute('aria-expanded','false');
  // Restore focus
  if(lastFocusBeforeMenu)lastFocusBeforeMenu.focus();
}

document.addEventListener('click',e=>{
  if(e.target.closest('.burger')){openMobileMenu();return}
  if(e.target.closest('.mobile-close')){closeMobileMenu();return}
  if(e.target.closest('#mm a')){closeMobileMenu()}
});

// Escape key closes mobile menu
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&mobileMenu&&mobileMenu.classList.contains('open')){
    closeMobileMenu();
  }
});

// Focus trap inside mobile menu
document.addEventListener('keydown',e=>{
  if(e.key!=='Tab'||!mobileMenu||!mobileMenu.classList.contains('open'))return;
  const focusable=mobileMenu.querySelectorAll('button,a[href]');
  if(focusable.length===0)return;
  const first=focusable[0],last=focusable[focusable.length-1];
  if(e.shiftKey){
    if(document.activeElement===first){e.preventDefault();last.focus()}
  }else{
    if(document.activeElement===last){e.preventDefault();first.focus()}
  }
});

// --- CSRF token loader ---
function loadCsrfToken(){
  fetch(API_BASE+'/csrf-token').then(r=>r.json()).then(d=>{
    const el=document.getElementById('csrf-token');
    if(el&&d.token)el.value=d.token;
  }).catch(()=>{});
}
loadCsrfToken();

// --- Field error helper ---
function showFieldError(input, message) {
  const fg = input.closest('.fg');
  if (!fg) return;
  // Remove any existing error on this field
  clearFieldError(input);
  fg.classList.add('fg-error');
  const span = document.createElement('span');
  span.className = 'field-error';
  span.textContent = message;
  fg.appendChild(span);
  // Clear error when user types
  input.addEventListener('input', function handler() {
    clearFieldError(input);
    input.removeEventListener('input', handler);
  });
}

function clearFieldError(input) {
  const fg = input.closest('.fg');
  if (!fg) return;
  fg.classList.remove('fg-error');
  const existing = fg.querySelector('.field-error');
  if (existing) existing.remove();
}

// --- Form submit ---
const reportForm=document.getElementById('reportForm');
if(reportForm){
  reportForm.addEventListener('submit',function(e){
    e.preventDefault();
    const f=e.target,d=new FormData(f),b=document.getElementById('submitBtn');

    // --- Client-side validation ---
    const prenom = f.querySelector('[name="prenom"]');
    const email = f.querySelector('[name="email"]');
    const cible = f.querySelector('[name="cible"]');

    // Validation prénom : min 2 caractères
    if (prenom.value.trim().length < 2) {
      prenom.focus();
      showFieldError(prenom, 'Prénom trop court');
      return;
    }

    // Validation email : regex basique
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.value.trim())) {
      email.focus();
      showFieldError(email, 'Email invalide');
      return;
    }

    // Validation cible : min 10 caractères
    if (cible.value.trim().length < 10) {
      cible.focus();
      showFieldError(cible, 'Décrivez votre cible plus précisément');
      return;
    }

    b.innerHTML='<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Envoi en cours...';b.style.opacity='.7';b.disabled=true;
    const ac=new AbortController();const tid=setTimeout(()=>ac.abort(),10000);
    fetch(API_BASE+'/lead-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(d)),signal:ac.signal})
    .then(r=>{clearTimeout(tid);if(!r.ok)throw new Error();return r.json()})
    .then(()=>{
      b.innerHTML='\u2713 Demande envoy\u00e9e !';b.style.background='var(--green)';f.reset();loadCsrfToken();
      const st=document.getElementById('form-status');st.style.display='block';st.style.background='rgba(34,197,94,0.1)';st.style.color='var(--green)';st.textContent='Demande envoy\u00e9e avec succ\u00e8s ! Vous recevrez votre rapport par email.';
      setTimeout(()=>{b.innerHTML='<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Recevoir mon rapport gratuit';b.style.opacity='1';b.style.background='';b.disabled=false;st.style.display='none'},5000);
    })
    .catch(()=>{
      clearTimeout(tid);loadCsrfToken();
      const st=document.getElementById('form-status');st.style.display='block';st.style.background='rgba(239,68,68,0.1)';st.style.color='var(--accent-red,#ef4444)';st.textContent='Erreur d\u2019envoi. Redirection vers email...';
      const p=d.get('prenom'),em=d.get('email'),ci=d.get('cible');
      setTimeout(()=>{window.location.href='mailto:hello@ifind.fr?subject=Demande rapport iFIND - '+encodeURIComponent(p)+'&body=Prenom: '+encodeURIComponent(p)+'%0AEmail: '+encodeURIComponent(em)+'%0ACible: '+encodeURIComponent(ci)},1500);
      b.innerHTML='Recevoir mon rapport gratuit';b.style.opacity='1';b.disabled=false;
    });
  });
}
