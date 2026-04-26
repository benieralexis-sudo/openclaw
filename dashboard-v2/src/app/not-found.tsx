import Link from "next/link";
import { Search } from "lucide-react";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-md rounded-xl border border-ink-200 bg-white p-8 shadow-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <Search className="h-6 w-6" />
        </div>
        <h1 className="font-display text-[20px] font-semibold tracking-tight text-ink-900">
          Page introuvable
        </h1>
        <p className="mt-2 text-[13px] text-ink-600">
          La page que vous cherchez n'existe pas ou a été déplacée.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex h-9 items-center justify-center rounded-md bg-brand-600 px-4 text-[13px] font-medium text-white shadow-sm hover:bg-brand-700"
        >
          Retour au dashboard
        </Link>
      </div>
    </main>
  );
}
