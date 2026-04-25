import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "@/lib/db";

const baseUrl =
  process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3100";

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  baseURL: baseUrl,
  // basePath laissé par défaut "/api/auth" — Next.js basePath gère le /preview-v2
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [
    baseUrl,
    "https://ifind.fr",
    "https://app-v2.ifind.fr",
    "http://127.0.0.1:3100",
  ],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30j
    updateAge: 60 * 60 * 24, // 1j
    cookieCache: { enabled: true, maxAge: 60 * 5 }, // 5min
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "CLIENT",
        input: false,
      },
      clientId: {
        type: "string",
        required: false,
        input: false,
      },
      scopeClientIds: {
        type: "string[]",
        defaultValue: [],
        input: false,
      },
      onboardingDone: {
        type: "boolean",
        defaultValue: false,
        input: false,
      },
    },
  },
  advanced: {
    cookiePrefix: "ifind",
    useSecureCookies: process.env.NODE_ENV === "production",
  },
});

export type AuthSession = typeof auth.$Infer.Session;
