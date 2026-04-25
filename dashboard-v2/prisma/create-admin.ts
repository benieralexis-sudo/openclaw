/**
 * Crée 2 users admin avec le même mot de passe simple :
 *   - alexis@ifind.fr (alias pro)
 *   - benieralexis@gmail.com (perso, depuis memory)
 *
 * Password fixe : ifind2026 (10 chars, tout minuscule, sans symbole)
 *
 * Lancer : npx tsx prisma/create-admin.ts
 */
import { hashPassword } from "@better-auth/utils/password";
import { PrismaClient } from "@prisma/client";

const ADMIN_EMAILS = ["alexis@ifind.fr", "benieralexis@gmail.com"];
const ADMIN_PASSWORD = "ifind2026";
const ADMIN_NAME = "Alexis Bénier";

const db = new PrismaClient();

async function main() {
  const hashed = await hashPassword(ADMIN_PASSWORD);

  for (const email of ADMIN_EMAILS) {
    console.log(`🔐 Setup ${email}...`);

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      await db.account.deleteMany({ where: { userId: existing.id } });
      await db.session.deleteMany({ where: { userId: existing.id } });
      await db.user.delete({ where: { id: existing.id } });
      console.log("  ↪ user existant supprimé");
    }

    const user = await db.user.create({
      data: {
        email,
        name: ADMIN_NAME,
        role: "ADMIN",
        emailVerified: true,
        onboardingDone: true,
        accounts: {
          create: {
            providerId: "credential",
            accountId: email,
            password: hashed,
          },
        },
      },
    });
    console.log(`  ✓ ${email} (${user.id})`);
  }

  console.log("\n=========================================");
  console.log("  ✅ 2 admins créés");
  console.log(`  Email     : alexis@ifind.fr  OU  benieralexis@gmail.com`);
  console.log(`  Password  : ${ADMIN_PASSWORD}`);
  console.log(`  Role      : ADMIN`);
  console.log("=========================================");
}

main()
  .catch((e) => {
    console.error("❌", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
