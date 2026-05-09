import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { magicLink } from "better-auth/plugins";
import { db } from "@/lib/db";
import { sendEmailViaResend } from "@/lib/delivery-sender";

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
    // Bloque le signup public — bug detecte 09/05 (curl POST /api/auth/sign-up/email
    // creait des comptes role=CLIENT sans aucune verification). Onboarding nouveaux
    // utilisateurs : passe par une route admin-only POST /api/users (a creer Sprint 4).
    disableSignUp: true,
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
  // Sprint 8 (10/05/2026) — Magic-link pour onboarding sans mot de passe.
  // Utilise par POST /api/users/[id]/send-magic-link (admin/editor invite
  // un user existant ou nouveau, qui clique le lien dans son email pour
  // creer sa session sans jamais saisir de mot de passe).
  // Token TTL 30 min (default 5 min trop court pour un email transactionnel).
  plugins: [
    magicLink({
      expiresIn: 60 * 30,
      disableSignUp: true, // signups passent par /api/users (admin route)
      sendMagicLink: async ({ email, url }) => {
        const subject = "Votre lien de connexion iFIND";
        const html = `
<div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #0d3b66;">Bienvenue sur iFIND</h2>
  <p>Cliquez sur le bouton ci-dessous pour vous connecter (lien valable 30 minutes) :</p>
  <p style="margin: 32px 0;">
    <a href="${url}" style="background: #0d3b66; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Se connecter a iFIND</a>
  </p>
  <p style="color: #666; font-size: 13px;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br><span style="word-break: break-all;">${url}</span></p>
  <p style="color: #999; font-size: 12px; margin-top: 32px;">Si vous n'avez pas demande ce lien, ignorez cet email.</p>
</div>`.trim();
        const text = `Bienvenue sur iFIND\n\nCliquez sur ce lien pour vous connecter (valable 30 minutes) :\n${url}\n\nSi vous n'avez pas demande ce lien, ignorez cet email.`;
        const res = await sendEmailViaResend({ to: email, subject, html, text });
        if (!res.ok) {
          console.error(`[auth.magic-link] sendEmailViaResend failed: ${res.error}`);
          throw new Error(res.error ?? "Email send failed");
        }
        console.log(`[auth.magic-link] sent to=${email} emailId=${res.emailId}`);
      },
    }),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
