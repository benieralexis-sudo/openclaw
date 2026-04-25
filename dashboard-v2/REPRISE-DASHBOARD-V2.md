# Reprise Dashboard v2 — checklist 30s

## URL & accès
- **URL prod** : https://app.ifind.fr
- **Email** : `benieralexis@gmail.com` ou `alexis@ifind.fr`
- **Password** : `ifind2026`
- **Postgres** : 127.0.0.1:5433 (Docker container `ifind-postgres`, password dans `.env`)

## Vérifier que tout tourne
```bash
curl -sI https://app.ifind.fr/login        # → 200
pgrep -af "next start"                     # → process visible
docker ps | grep ifind-postgres             # → Up
```

## Si Next.js est tombé (reboot VPS)
```bash
cd /opt/moltbot/dashboard-v2
nohup npx next start -H 127.0.0.1 -p 3100 > /tmp/dashboard-v2.log 2>&1 &
```

## Phase 1 done (25/04/2026)
- ✅ Next.js 15 + TS strict + Tailwind v4 + Shadcn UI (15+ composants)
- ✅ Postgres 16 + Prisma 6 + schéma multi-tenant 12 modèles
- ✅ Better Auth + sessions + rôles ADMIN/COMMERCIAL/CLIENT/EDITOR/VIEWER
- ✅ Sidebar + Topbar + ScopeSwitcher + ⌘K command palette
- ✅ 2 pages : /dashboard (KPIs+pépites+pipeline) + /triggers (DataTable)
- ✅ 5 API routes scopées : /api/auth, /api/me, /api/clients, /api/triggers, /api/dashboard

## Phase 2 à faire (priorité 1)
1. `/pipeline` — Kanban drag & drop (`@dnd-kit/core` à installer) — 2-3j
2. `/unibox` — Inbox réponses email — 2-3j
3. `/clients` — Gestion comptes — 1-2j
4. `/onboarding` — Wizard 5min — 1-2j (critique DigitestLab)
5. `/settings` — ICP, notifs, intégrations — 1j
6. `/system` — Santé moteur (admin) — 1j

## Phase 3 à faire
- Migration data réelle depuis ancien backend
- WebSocket live updates
- Décommission ancien dashboard

## Phase 4 — excellence
- Framer Motion animations
- Mobile PWA
- ⌘K command palette enrichie
- PDF reports
- Performance Lighthouse

## Rollback ancien dashboard si besoin
```bash
cp /etc/nginx/sites-available/app-ifind.backup-pre-v2 /etc/nginx/sites-available/app-ifind
systemctl reload nginx
```

## Tag git de cette session
`v2.1-dashboard-phase1` (sur GitHub)
