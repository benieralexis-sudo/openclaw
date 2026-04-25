/**
 * Crée le user admin Alexis avec un mot de passe hashé via Better Auth.
 * Lancer : npx tsx prisma/create-admin.ts
 */
import { hashPassword } from "@better-auth/utils/password";
import { PrismaClient } from "@prisma/client";

const ADMIN_EMAIL = "alexis@ifind.fr";
const ADMIN_PASSWORD = "iFind2026!Admin";
const ADMIN_NAME = "Alexis Bénier";

const db = new PrismaClient();

async function main() {
  console.log(`🔐 Setup admin ${ADMIN_EMAIL}...`);

  // Soft-clean : supprime tout user existant pour repartir clean
  const existing = await db.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (existing) {
    await db.account.deleteMany({ where: { userId: existing.id } });
    await db.session.deleteMany({ where: { userId: existing.id } });
    await db.user.delete({ where: { id: existing.id } });
    console.log("  ↪ User existant supprimé");
  }

  const hashed = await hashPassword(ADMIN_PASSWORD);

  const user = await db.user.create({
    data: {
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
      role: "ADMIN",
      emailVerified: true,
      onboardingDone: true,
      accounts: {
        create: {
          providerId: "credential",
          accountId: ADMIN_EMAIL,
          password: hashed,
        },
      },
    },
  });

  console.log("\n✅ Admin créé :");
  console.log(`   Email    : ${ADMIN_EMAIL}`);
  console.log(`   Password : ${ADMIN_PASSWORD}`);
  console.log(`   Role     : ADMIN`);
  console.log(`   ID       : ${user.id}`);
}

main()
  .catch((e) => {
    console.error("❌", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
