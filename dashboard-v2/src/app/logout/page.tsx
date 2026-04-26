"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";

export default function LogoutPage() {
  const router = useRouter();

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await signOut();
      } catch {
        // si la session n'existe plus, on continue le redirect
      }
      if (!cancelled) {
        // window.location pour garantir un reload propre (vide le cache TanStack)
        window.location.href = "/login";
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        <p className="mt-4 text-[13px] text-ink-600">Déconnexion en cours…</p>
      </div>
    </main>
  );
}
