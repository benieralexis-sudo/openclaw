"use client";

import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";
import type { auth } from "@/server/auth";

// basePath prend en compte le préfixe de déploiement (Phase 1.7 — /preview-v2 sur ifind.fr).
// Quand DNS app-v2.ifind.fr sera en place, on retire ce préfixe.
const APP_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

// On reconstruit l'URL absolue côté client (window dispo) ; côté SSR (build statique),
// on utilise un placeholder qui passe le parsing URL — l'auth client n'est de toute façon
// utilisé qu'en interactif.
const resolvedBaseURL =
  typeof window !== "undefined"
    ? `${window.location.origin}${APP_BASE_PATH}`
    : `http://localhost${APP_BASE_PATH}`;

export const authClient = createAuthClient({
  baseURL: resolvedBaseURL,
  plugins: [inferAdditionalFields<typeof auth>()],
});

export const { signIn, signOut, signUp, useSession, getSession } = authClient;
