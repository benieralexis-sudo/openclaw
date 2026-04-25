"use client";

import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";
import type { auth } from "@/server/auth";

// Phase 1.7 — déploiement sous /preview-v2 (en attendant DNS app-v2.ifind.fr).
// Better Auth's `withPath()` ne complète PAS un baseURL qui a déjà un path,
// donc on doit passer l'URL complète des endpoints auth (origine + basePath + /api/auth).
const APP_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

const authBaseURL =
  typeof window !== "undefined"
    ? `${window.location.origin}${APP_BASE_PATH}/api/auth`
    : `http://localhost${APP_BASE_PATH}/api/auth`;

export const authClient = createAuthClient({
  baseURL: authBaseURL,
  plugins: [inferAdditionalFields<typeof auth>()],
});

export const { signIn, signOut, signUp, useSession, getSession } = authClient;
