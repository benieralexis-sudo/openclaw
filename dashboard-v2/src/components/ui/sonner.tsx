"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      theme="light"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-white group-[.toaster]:text-ink-900 group-[.toaster]:border-ink-200 group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-ink-600",
          actionButton:
            "group-[.toast]:bg-brand-600 group-[.toast]:text-white",
          cancelButton:
            "group-[.toast]:bg-ink-100 group-[.toast]:text-ink-700",
        },
      }}
    />
  );
}

export { toast } from "sonner";
