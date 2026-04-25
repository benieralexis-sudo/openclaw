"use client";

import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";
import type { auth } from "@/server/auth";

const APP_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

// L'origine réelle au runtime, fallback sur ifind.fr en SSR (jamais utilisé en pratique car "use client")
const origin =
  typeof window !== "undefined" ? window.location.origin : "https://ifind.fr";

export const authClient = createAuthClient({
  baseURL: origin,
  // basePath = chemin complet où Better Auth est monté (au-dessus du Next.js basePath)
  basePath: `${APP_BASE_PATH}/api/auth`,
  plugins: [inferAdditionalFields<typeof auth>()],
});

export const { signIn, signOut, signUp, useSession, getSession } = authClient;
