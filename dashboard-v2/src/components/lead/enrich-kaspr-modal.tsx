"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Database,
  ExternalLink,
  Linkedin,
  Loader2,
  Mail,
  Phone,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/sonner";
import { formatRelativeFr } from "@/lib/utils";

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

interface KasprProfilePayload {
  workEmail: string | null;
  personalEmail: string | null;
  phone: string | null;
  title: string | null;
  linkedinUrl: string | null;
  fullName?: string;
}

interface KasprResponse {
  ok: boolean;
  used_cache: boolean;
  enrichedAt?: string;
  profile: KasprProfilePayload;
  credits_remaining?: {
    workEmail: string | null;
    directEmail: string | null;
    phone: string | null;
    export: string | null;
  };
}

interface LeadInfo {
  id: string;
  fullName: string | null;
  firstName?: string | null;
  lastName?: string | null;
  linkedinUrl: string | null;
  kasprEnrichedAt?: string | null;
}

interface EnrichKasprModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: LeadInfo;
}

const LINKEDIN_REGEX = /linkedin\.com\/in\/[^/?#\s]+/i;

// ──────────────────────────────────────────────────────────────────────
// Composant principal
// ──────────────────────────────────────────────────────────────────────

export function EnrichKasprModal({ open, onOpenChange, lead }: EnrichKasprModalProps) {
  const queryClient = useQueryClient();
  const [linkedinUrl, setLinkedinUrl] = React.useState<string>(lead.linkedinUrl ?? "");
  const [result, setResult] = React.useState<KasprResponse | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setLinkedinUrl(lead.linkedinUrl ?? "");
    setResult(null);
  }, [open, lead.linkedinUrl]);

  const isUrlValid = LINKEDIN_REGEX.test(linkedinUrl);

  const alreadyEnriched =
    !!lead.kasprEnrichedAt &&
    Date.now() - new Date(lead.kasprEnrichedAt).getTime() < 7 * 24 * 3600 * 1000;

  const enrich = useMutation({
    mutationFn: async ({ force }: { force?: boolean } = {}) => {
      const url = `/api/leads/${lead.id}/enrich-kaspr${force ? "?force=true" : ""}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedinUrl }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? "Enrichissement Kaspr échoué");
      return json as KasprResponse;
    },
    onSuccess: (json) => {
      setResult(json);
      if (json.used_cache) {
        toast.info("Profil chargé depuis le cache (< 7j)", {
          description: "Cliquez Re-enrichir pour forcer un nouvel appel Kaspr.",
        });
      } else {
        const remaining = json.credits_remaining?.workEmail ?? "?";
        toast.success("Lead enrichi via Kaspr", {
          description: `Crédits work-email restants : ${remaining}`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["trigger-detail"] });
      queryClient.invalidateQueries({ queryKey: ["lead", lead.id] });
    },
    onError: (err: Error) => {
      toast.error("Enrichissement impossible", { description: err.message });
    },
  });

  const handleEnrich = () => enrich.mutate({});
  const handleForce = () => enrich.mutate({ force: true });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-cyan-600" />
            Enrichir avec Kaspr
          </DialogTitle>
          <DialogDescription>
            {lead.fullName ?? "Lead"} — récupère email pro + téléphone + titre depuis LinkedIn.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* URL LinkedIn input */}
          <div className="grid gap-1.5">
            <Label className="flex items-center gap-1.5">
              <Linkedin className="h-3.5 w-3.5 text-[#0A66C2]" />
              URL LinkedIn de la cible
            </Label>
            <Input
              type="url"
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="https://www.linkedin.com/in/marc-dupont/"
              className="font-mono text-[12.5px]"
            />
            {linkedinUrl && !isUrlValid && (
              <p className="text-[11px] text-amber-600">
                URL invalide — attendu : linkedin.com/in/&lt;slug&gt;
              </p>
            )}
            {alreadyEnriched && !result && (
              <p className="text-[11px] text-ink-500">
                Déjà enrichi {formatRelativeFr(lead.kasprEnrichedAt!)}. Cliquer
                &quot;Enrichir&quot; renverra le cache, &quot;Re-enrichir&quot; force un
                nouvel appel Kaspr (consomme 1 crédit).
              </p>
            )}
          </div>

          {/* Résultat */}
          {result && (
            <div className="rounded-md border border-cyan-200 bg-cyan-50/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Badge variant="info" size="sm" className="gap-1">
                  <Sparkles className="h-2.5 w-2.5" />
                  {result.used_cache ? "Cache (< 7j)" : "Enrichi via Kaspr"}
                </Badge>
                {result.credits_remaining?.workEmail && (
                  <span className="font-mono text-[10.5px] text-ink-500">
                    Crédits restants : {result.credits_remaining.workEmail} work,{" "}
                    {result.credits_remaining.phone ?? "?"} phone
                  </span>
                )}
              </div>
              <div className="space-y-1.5 text-[12.5px]">
                {result.profile.title && (
                  <div className="text-ink-700">
                    <span className="text-ink-500">Titre :</span>{" "}
                    <span className="font-medium">{result.profile.title}</span>
                  </div>
                )}
                {result.profile.workEmail && (
                  <div className="flex items-center gap-1.5">
                    <Mail className="h-3 w-3 text-ink-400" />
                    <a
                      href={`mailto:${result.profile.workEmail}`}
                      className="font-mono text-brand-700 hover:underline"
                    >
                      {result.profile.workEmail}
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(result.profile.workEmail!);
                        toast.success("Email copié");
                      }}
                      className="text-[10.5px] text-ink-500 hover:text-ink-800"
                    >
                      copier
                    </button>
                  </div>
                )}
                {result.profile.personalEmail && (
                  <div className="flex items-center gap-1.5">
                    <Mail className="h-3 w-3 text-ink-400" />
                    <span className="font-mono text-ink-700">
                      {result.profile.personalEmail}
                    </span>
                    <span className="text-[10px] text-ink-400">(perso)</span>
                  </div>
                )}
                {result.profile.phone && (
                  <div className="flex items-center gap-1.5">
                    <Phone className="h-3 w-3 text-ink-400" />
                    <a
                      href={`tel:${result.profile.phone}`}
                      className="font-mono text-brand-700 hover:underline"
                    >
                      {result.profile.phone}
                    </a>
                  </div>
                )}
                {result.profile.linkedinUrl && (
                  <div className="flex items-center gap-1.5">
                    <Linkedin className="h-3 w-3 text-[#0A66C2]" />
                    <a
                      href={result.profile.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-700 hover:underline inline-flex items-center gap-0.5"
                    >
                      Profil LinkedIn
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                )}
                {!result.profile.workEmail &&
                  !result.profile.personalEmail &&
                  !result.profile.phone && (
                    <p className="text-[11.5px] italic text-ink-500">
                      Kaspr n&apos;a pas trouvé d&apos;email/téléphone pour ce profil.
                    </p>
                  )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
          {alreadyEnriched && (
            <Button
              variant="secondary"
              size="md"
              onClick={handleForce}
              disabled={!isUrlValid || enrich.isPending}
              className="gap-1.5"
            >
              {enrich.isPending && enrich.variables?.force ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Re-enrichir
            </Button>
          )}
          <Button
            variant="primary"
            size="md"
            onClick={handleEnrich}
            disabled={!isUrlValid || enrich.isPending}
            className="gap-1.5"
          >
            {enrich.isPending && !enrich.variables?.force ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Enrichissement…
              </>
            ) : (
              <>
                <Database className="h-3.5 w-3.5" />
                Enrichir
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
