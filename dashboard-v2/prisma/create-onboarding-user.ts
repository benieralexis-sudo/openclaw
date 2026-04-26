/**
 * Phase 2.4 — Crée un user CLIENT avec onboardingDone=false pour
 * tester le wizard end-to-end (Frédéric Flandrin / DigitestLab).
 *
 * Reset son client en PROSPECT pour que le wizard ait du sens.
 *
 * Lancer : npx tsx prisma/create-onboarding-user.ts
 */
import { hashPassword } from "@better-auth/utils/password";
import { PrismaClient } from "@prisma/client";

const EMAIL = "frederic@digitestlab.fr";
const PASSWORD = "ifind2026";
const NAME = "Frédéric Flandrin";

const db = new PrismaClient();

async function main() {
  const client = await db.client.findUnique({ where: { slug: "digitestlab" } });
  if (!client) {
    throw new Error("Client digitestlab introuvable — lancer seed-clients-icp d'abord");
  }

  const existing = await db.user.findUnique({ where: { email: EMAIL } });
  if (existing) {
    await db.account.deleteMany({ where: { userId: existing.id } });
    await db.session.deleteMany({ where: { userId: existing.id } });
    await db.user.delete({ where: { id: existing.id } });
    console.log("  ↪ user existant supprimé");
  }

  const hashed = await hashPassword(PASSWORD);

  const user = await db.user.create({
    data: {
      email: EMAIL,
      name: NAME,
      role: "EDITOR",
      emailVerified: true,
      onboardingDone: false,
      clientId: client.id,
      accounts: {
        create: {
          providerId: "credential",
          accountId: EMAIL,
          password: hashed,
        },
      },
    },
  });

  // Reset DigitestLab en PROSPECT pour que le wizard fasse sens
  await db.client.update({
    where: { id: client.id },
    data: {
      status: "PROSPECT",
      activatedAt: null,
    },
  });

  console.log(`✅ User onboarding créé : ${EMAIL} / ${PASSWORD} (${user.id})`);
  console.log(`   → Client DigitestLab repassé en PROSPECT pour test wizard`);
}

main()
  .catch((e) => {
    console.error("❌", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
