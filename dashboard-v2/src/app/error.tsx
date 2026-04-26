"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-md rounded-xl border border-ink-200 bg-white p-8 shadow-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h1 className="font-display text-[20px] font-semibold tracking-tight text-ink-900">
          Une erreur s'est produite
        </h1>
        <p className="mt-2 text-[13px] text-ink-600">
          {error.message?.length && error.message.length < 200
            ? error.message
            : "Le dashboard a rencontré un souci. Notre équipe a été notifiée."}
        </p>
        {error.digest && (
          <div className="mt-3 rounded bg-ink-50 px-3 py-1.5 font-mono text-[10.5px] text-ink-500">
            ref · {error.digest}
          </div>
        )}
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button variant="primary" size="md" onClick={reset} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Réessayer
          </Button>
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center justify-center rounded-md border border-ink-200 bg-white px-4 text-[13px] font-medium text-ink-700 shadow-xs hover:bg-ink-50"
          >
            Retour au dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
