// Audit E2E navigateur — Phase 2.7 final
// Lance Chromium headless et teste les 6 actions identifiées comme
// non-cURLisables : drag&drop, wizard, chips, switch digest, dialog
// invite, mobile responsive.
//
// Lancer : node tests/e2e-audit.mjs

import { chromium, devices } from "playwright";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const BASE = "https://app.ifind.fr";
const ADMIN = { email: "alexis@ifind.fr", password: "ifind2026" };
const EDITOR = { email: "frederic@digitestlab.fr", password: "ifind2026" };

const SCREENSHOTS = "/tmp/e2e-audit";
mkdirSync(SCREENSHOTS, { recursive: true });

let pass = 0;
let fail = 0;
const issues = [];

function ok(label) {
  console.log(`  ✅ ${label}`);
  pass += 1;
}
function ko(label, detail = "") {
  console.log(`  ❌ ${label}${detail ? ` → ${detail}` : ""}`);
  issues.push({ label, detail });
  fail += 1;
}

async function login(page, creds) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', creds.email);
  await page.fill('input[type="password"]', creds.password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle");
}

// ──────────────────────────────────────────────────────────────────────
// TEST 1 — Drag & drop Kanban
// ──────────────────────────────────────────────────────────────────────

async function testDragDrop(browser) {
  console.log("\n[1/6] Drag & drop Kanban /pipeline");
  // Reset une opp en CONTACTED pour tester le drag
  execSync(
    `docker exec ifind-postgres psql -U ifind -d ifind -c "UPDATE \\"Opportunity\\" SET stage='CONTACTED' WHERE id=(SELECT id FROM \\"Opportunity\\" LIMIT 1);"`,
    { stdio: "ignore" },
  );

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await login(page, ADMIN);
    await page.goto(`${BASE}/pipeline`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    // Vérifie que les colonnes sont bien là
    const colCount = await page.locator('div:has-text("Identifié")').count();
    if (colCount > 0) ok("Colonnes Kanban rendues");
    else ko("Colonnes Kanban absentes");

    // Compte les cards (pour vérifier que la data charge)
    const cardCount = await page.locator(".cursor-grab").count();
    if (cardCount >= 5) ok(`${cardCount} cards opportunités visibles`);
    else ko(`Trop peu de cards (${cardCount})`);

    // Test drag : on prend la 1ère card et on la déplace vers la colonne "Engagé"
    // dnd-kit utilise PointerSensor donc on doit simuler avec mouse.move() + delay
    const firstCard = page.locator(".cursor-grab").first();
    const engagedColumn = page.locator('[data-rbd-droppable-id="ENGAGED"], div').filter({ hasText: "Engagé" }).first();

    const cardBox = await firstCard.boundingBox();
    if (!cardBox) {
      ko("Première card sans bounding box");
    } else {
      // Drop target — la 3ème colonne ENGAGED
      const dropTarget = await page.locator('div').filter({ hasText: /^Engagé/ }).nth(0).boundingBox();
      if (!dropTarget) {
        ko("Drop target ENGAGED introuvable");
      } else {
        await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
        await page.mouse.down();
        // Petit shift pour passer le seuil PointerSensor (6px)
        await page.mouse.move(cardBox.x + 50, cardBox.y + 50, { steps: 5 });
        await page.mouse.move(dropTarget.x + 100, dropTarget.y + 200, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(1500);

        // Vérifier toast sonner ou check DB
        const stageNow = execSync(
          `docker exec ifind-postgres psql -U ifind -d ifind -tA -c "SELECT stage FROM \\"Opportunity\\" WHERE id=(SELECT id FROM \\"Opportunity\\" ORDER BY \\"updatedAt\\" DESC LIMIT 1);"`,
        )
          .toString()
          .trim();
        if (stageNow !== "CONTACTED") {
          ok(`Drag&drop appliqué — stage = ${stageNow}`);
        } else {
          ko("Drag&drop non appliqué", "stage reste CONTACTED");
        }
      }
    }

    await page.screenshot({ path: `${SCREENSHOTS}/01-pipeline.png`, fullPage: true });
  } catch (e) {
    ko("Exception", e.message);
  } finally {
    await ctx.close();
  }
}

// ──────────────────────────────────────────────────────────────────────
// TEST 2 — Wizard onboarding (frédéric EDITOR)
// ──────────────────────────────────────────────────────────────────────

async function testOnboardingWizard(browser) {
  console.log("\n[2/6] Wizard onboarding (frédéric EDITOR)");

  // Reset frédéric en onboardingDone=false + DigitestLab en PROSPECT
  execSync(
    `cd /opt/moltbot/dashboard-v2 && npx tsx prisma/create-onboarding-user.ts 2>&1`,
    { stdio: "ignore" },
  );

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await login(page, EDITOR);

    // Devrait auto-rediriger vers /onboarding
    await page.waitForURL(/\/onboarding/, { timeout: 5000 });
    ok("Auto-redirect /onboarding pour EDITOR sans onboarding fini");

    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);

    // Étape 1 — Société : nom doit être pré-rempli
    const nameInput = page.locator('input#name');
    const nameVal = await nameInput.inputValue();
    if (nameVal && nameVal.length > 0) ok(`Étape 1 pré-remplie : nom = "${nameVal}"`);
    else ko("Nom société non pré-rempli");

    // Modifier le nom et passer à l'étape 2
    await nameInput.fill("Digidemat");
    await page.click('button:has-text("Continuer")');
    await page.waitForTimeout(400);

    // Étape 2 — ICP : tester ChipField
    // Vérifier que des industries apparaissent
    const industriesField = page.locator('label:has-text("Industries cibles") + div');
    const chipsCount = await industriesField.locator(".rounded-full").count();
    if (chipsCount >= 2) ok(`Étape 2 ICP — ${chipsCount} industries pré-remplies en chips`);
    else ko(`Étape 2 ICP — chips industries (${chipsCount})`);

    // Test ajout de chip via Enter
    const chipInput = industriesField.locator('input[type="text"]').first();
    await chipInput.fill("Test custom industry");
    await chipInput.press("Enter");
    await page.waitForTimeout(200);
    const chipsAfter = await industriesField.locator(".rounded-full").count();
    if (chipsAfter > chipsCount) ok("Ajout de chip via Enter fonctionne");
    else ko("Ajout de chip via Enter échoué");

    // Test Backspace pour retirer (input vide)
    await chipInput.press("Backspace");
    await page.waitForTimeout(200);
    const chipsAfter2 = await industriesField.locator(".rounded-full").count();
    if (chipsAfter2 < chipsAfter) ok("Suppression chip via Backspace fonctionne");
    else ko("Backspace ne supprime pas la chip");

    // Slider minScore
    const slider = page.locator('#minScore');
    const sliderExists = (await slider.count()) > 0;
    if (sliderExists) ok("Slider minScore présent");
    else ko("Slider minScore absent");

    await page.click('button:has-text("Continuer")');
    await page.waitForTimeout(400);

    // Étape 3 — Plan : 2 cards doivent être présentes
    const planCards = await page.locator('button:has-text("€")').count();
    if (planCards >= 2) ok(`Étape 3 Plan — ${planCards} offres affichées`);
    else ko(`Étape 3 Plan — ${planCards} offres seulement`);

    // Sélectionner Full Service
    await page.click('button:has-text("Full Service")');
    await page.waitForTimeout(200);
    await page.click('button:has-text("Continuer")');
    await page.waitForTimeout(400);

    // Étape 4 — Récap
    const recapVisible = await page.locator('h2:has-text("Récap")').count();
    if (recapVisible > 0) ok("Étape 4 Récap affichée");
    else ko("Étape 4 Récap absente");

    // Cliquer Activer
    await page.screenshot({ path: `${SCREENSHOTS}/02-wizard-recap.png`, fullPage: true });
    await page.click('button:has-text("Activer mon compte")');
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });
    ok("Activation finale → redirect /dashboard");

    await page.screenshot({ path: `${SCREENSHOTS}/02-after-onboarding.png`, fullPage: true });
  } catch (e) {
    ko("Exception wizard", e.message);
    await page.screenshot({ path: `${SCREENSHOTS}/02-error.png`, fullPage: true });
  } finally {
    await ctx.close();
  }
}

// ──────────────────────────────────────────────────────────────────────
// TEST 3 — Toggle digest hebdo /settings
// ──────────────────────────────────────────────────────────────────────

async function testSettingsDigest(browser) {
  console.log("\n[3/6] Toggle digest hebdo /settings");
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await login(page, ADMIN);
    await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    // Trouver le switch "Digest hebdomadaire"
    const digestRow = page.locator('div:has-text("Digest hebdomadaire")').first();
    const found = await digestRow.count();
    if (found > 0) ok("Toggle Digest hebdomadaire visible");
    else ko("Toggle Digest absent");

    // Click le switch (state actuel)
    const digestSwitch = digestRow.locator('button[role="switch"]').first();
    const stateBefore = await digestSwitch.getAttribute("data-state");

    await digestSwitch.click();
    await page.waitForTimeout(400);
    const stateAfter = await digestSwitch.getAttribute("data-state");

    if (stateBefore !== stateAfter) {
      ok(`Switch toggle ${stateBefore} → ${stateAfter}`);
    } else {
      ko("Switch ne change pas d'état");
    }

    // Si activé, le bloc jour/heure doit apparaître
    if (stateAfter === "checked") {
      const dayPicker = await page.locator('select#digestDay').count();
      if (dayPicker > 0) ok("Sélecteur Jour révélé quand digest=ON");
      else ko("Sélecteur Jour absent quand digest=ON");
    } else {
      // Re-cocher pour vérifier
      await digestSwitch.click();
      await page.waitForTimeout(300);
      const dayPicker = await page.locator('select#digestDay').count();
      if (dayPicker > 0) ok("Sélecteur Jour révélé après re-toggle");
      else ko("Sélecteur Jour absent après re-toggle");
    }

    await page.screenshot({ path: `${SCREENSHOTS}/03-settings-digest.png`, fullPage: true });
  } catch (e) {
    ko("Exception settings digest", e.message);
  } finally {
    await ctx.close();
  }
}

// ──────────────────────────────────────────────────────────────────────
// TEST 4 — Dialog Invite + tempPassword
// ──────────────────────────────────────────────────────────────────────

async function testInviteDialog(browser) {
  console.log("\n[4/6] Dialog Invite équipe");
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await login(page, ADMIN);
    await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    // Click sur l'onglet Équipe
    await page.click('[role="tab"]:has-text("Équipe")');
    await page.waitForTimeout(500);

    // Click Inviter
    await page.click('button:has-text("Inviter")');
    await page.waitForTimeout(400);

    // Dialog ouvert
    const dialog = page.locator('[role="dialog"]');
    const dialogVisible = await dialog.count();
    if (dialogVisible > 0) ok("Dialog Invite ouvert");
    else ko("Dialog Invite ne s'ouvre pas");

    // Remplir
    const testEmail = `e2e-test-${Date.now()}@example.com`;
    await page.fill('input#invite-email', testEmail);
    await page.fill('input#invite-name', "E2E Test");
    await page.selectOption('select#invite-role', "VIEWER");

    // Sélectionner DigitestLab dans le select client
    const clientSelect = page.locator('select#invite-client');
    if ((await clientSelect.count()) > 0) {
      const options = await clientSelect.locator('option').allTextContents();
      const digi = options.find((o) => o.includes("DigitestLab"));
      if (digi) await clientSelect.selectOption({ label: digi });
    }

    await page.click('[role="dialog"] button:has-text("Inviter")');
    await page.waitForTimeout(2000);

    // Le dialog tempPassword doit apparaître
    const tempPasswordDialog = await page.locator('h2:has-text("Utilisateur créé")').count();
    if (tempPasswordDialog > 0) ok("Dialog tempPassword affiché");
    else ko("Dialog tempPassword absent");

    const tempPwdCode = await page.locator('code').first().textContent();
    if (tempPwdCode && tempPwdCode.length >= 14) ok(`tempPassword affiché : ${tempPwdCode.slice(0, 4)}…`);
    else ko("tempPassword vide ou trop court");

    await page.screenshot({ path: `${SCREENSHOTS}/04-invite-temp-pwd.png`, fullPage: true });

    // Cleanup : supprimer le user créé
    execSync(
      `docker exec ifind-postgres psql -U ifind -d ifind -c "DELETE FROM \\"User\\" WHERE email='${testEmail}';"`,
      { stdio: "ignore" },
    );
  } catch (e) {
    ko("Exception invite", e.message);
    await page.screenshot({ path: `${SCREENSHOTS}/04-invite-error.png`, fullPage: true });
  } finally {
    await ctx.close();
  }
}

// ──────────────────────────────────────────────────────────────────────
// TEST 5 — Chips ICP /clients/[id]
// ──────────────────────────────────────────────────────────────────────

async function testChipsICP(browser) {
  console.log("\n[5/6] Chips ICP /clients/[id]");
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await login(page, ADMIN);
    await page.goto(`${BASE}/clients`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    // Click sur la 1ère row de la table
    const firstRow = page.locator('tbody tr').first();
    if ((await firstRow.count()) === 0) {
      ko("Aucune row de clients");
      await ctx.close();
      return;
    }
    await firstRow.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);

    // Onglet Profil ICP devrait être actif par défaut
    const minScoreSlider = await page.locator('#minScore').count();
    if (minScoreSlider > 0) ok("Onglet Profil ICP affiché");
    else ko("Onglet Profil ICP non affiché");

    // Industries chips
    const industriesField = page.locator('label:has-text("Industries cibles")').locator('xpath=..//div[contains(@class, "rounded-md")]').first();
    const chipsBefore = await industriesField.locator(".rounded-full").count();

    // Ajout via Enter
    const chipInput = industriesField.locator('input').first();
    await chipInput.fill("Test E2E sector");
    await chipInput.press("Enter");
    await page.waitForTimeout(200);
    const chipsAfter = await industriesField.locator(".rounded-full").count();
    if (chipsAfter === chipsBefore + 1) ok("Ajout chip ICP via Enter OK");
    else ko(`Chip ICP non ajoutée (avant=${chipsBefore} après=${chipsAfter})`);

    // Bouton Enregistrer doit être actif (dirty)
    const saveBtn = page.locator('button:has-text("Enregistrer ICP")');
    const disabled = await saveBtn.isDisabled();
    if (!disabled) ok("Bouton Enregistrer actif quand dirty");
    else ko("Bouton Enregistrer reste disabled malgré modif");

    // Cliquer Annuler pour ne pas polluer
    await page.click('button:has-text("Annuler")');
    await page.waitForTimeout(200);
    const chipsAfterCancel = await industriesField.locator(".rounded-full").count();
    if (chipsAfterCancel === chipsBefore) ok("Bouton Annuler restaure les chips");
    else ko("Annuler ne restaure pas l'état initial");

    await page.screenshot({ path: `${SCREENSHOTS}/05-clients-icp.png`, fullPage: true });
  } catch (e) {
    ko("Exception ICP chips", e.message);
  } finally {
    await ctx.close();
  }
}

// ──────────────────────────────────────────────────────────────────────
// TEST 6 — Mobile responsive
// ──────────────────────────────────────────────────────────────────────

async function testMobile(browser) {
  console.log("\n[6/6] Mobile responsive (iPhone 12)");
  const iphone = devices["iPhone 12"];
  const ctx = await browser.newContext({ ...iphone });
  const page = await ctx.newPage();
  try {
    await login(page, ADMIN);
    await page.waitForLoadState("networkidle");

    // Sidebar (240px) doit être masquée sur mobile (< 768px)
    const sidebar = page.locator('aside').first();
    const sidebarVisible = await sidebar.isVisible().catch(() => false);
    if (!sidebarVisible) ok("Sidebar masquée sur mobile (md:flex)");
    else ko("Sidebar VISIBLE sur mobile — non responsive");

    // Topbar doit être présent
    const topbar = await page.locator('header').first().isVisible();
    if (topbar) ok("Topbar visible sur mobile");
    else ko("Topbar absent sur mobile");

    // Aller sur /pipeline mobile
    await page.goto(`${BASE}/pipeline`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SCREENSHOTS}/06-mobile-pipeline.png` });

    // Aller sur /unibox mobile
    await page.goto(`${BASE}/unibox`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SCREENSHOTS}/06-mobile-unibox.png` });

    // /dashboard mobile
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SCREENSHOTS}/06-mobile-dashboard.png` });
    ok("Screenshots mobile capturés (dashboard, pipeline, unibox)");
  } catch (e) {
    ko("Exception mobile", e.message);
  } finally {
    await ctx.close();
  }
}

// ──────────────────────────────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("================ AUDIT E2E NAVIGATEUR ================");
  console.log(`Base : ${BASE}`);
  console.log(`Screenshots : ${SCREENSHOTS}\n`);

  const browser = await chromium.launch({ headless: true });

  await testDragDrop(browser);
  await testOnboardingWizard(browser);
  await testSettingsDigest(browser);
  await testInviteDialog(browser);
  await testChipsICP(browser);
  await testMobile(browser);

  await browser.close();

  console.log("\n================ RÉSULTATS ================");
  console.log(`✅ ${pass} passés · ❌ ${fail} échoués`);
  if (issues.length > 0) {
    console.log("\nÉchecs :");
    issues.forEach((i) => console.log(`  - ${i.label}${i.detail ? ` (${i.detail})` : ""}`));
  }
  console.log(`\nScreenshots : ${SCREENSHOTS}/`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
