"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  Copy,
  ExternalLink,
  FileText,
  Linkedin,
  Loader2,
  Mail,
  PhoneCall,
  RefreshCw,
  Sparkles,
  Target,
  Zap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/sonner";
import { cn, formatNumberFr, formatRelativeFr, gmailComposeUrl, isFrenchMobile, normalizeLinkedinUrl } from "@/lib/utils";
import { computeLeadVerdict, type VerdictResult } from "@/lib/lead-verdict";
import {
  getV2Tier,
  getV2Label,
  getV2Variant,
  formatV2Badge,
  type V2Verdict,
} from "@/lib/score-display";
import { humanizeCompanySize, humanizeRevenue, humanizeResultNet, humanizeEtabsCount } from "@/lib/format-company";
import { simplifyTriggerTitle } from "@/lib/simplify-trigger-title";
import { CheckCircle2, AlertTriangle, XCircle, Info, Clock } from "lucide-react";
import { formatSourceLabel, truncateDetail } from "@/lib/format-trigger-detail";
import { SendEmailModal } from "@/components/lead/send-email-modal";
// UX4 fix 10/05 — EnrichKasprModal supprimée (bouton "Trouver le numéro" retiré)
import { LeadActivityPanel } from "@/components/lead/lead-activity-panel";
import { LeadBriefV2ViewSafe } from "@/components/brief/lead-brief-v2-view";
import { Database, Phone, Send } from "lucide-react";

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

interface TriggerData {
  trigger: {
    id: string;
    clientId: string;
    companyName: string;
    companySiret: string | null;
    companyNaf?: string | null;
    industry: string | null;
    region: string | null;
    size: string | null;
    type: string;
    title: string;
    detail: string | null;
    score: number;
    scoreReason: string | null;
    isHot: boolean;
    isCombo: boolean;
    status: string;
    capturedAt: string;
    sourceUrl?: string | null;
    sourceCode?: string | null;
    /** Sprint D.4 (07/05) — brief raisonné V2 (judge dormant). null tant que
     *  pas backfillé. Validé Zod côté composant LeadBriefV2ViewSafe. */
    briefV2Json?: unknown | null;
  };
  lead: {
    id: string;
    fullName: string | null;
    firstName?: string | null;
    lastName?: string | null;
    jobTitle: string | null;
    linkedinUrl: string | null;
    email: string | null;
    emailStatus: string;
    phone: string | null;
    companyName: string;
    briefJson: Brief | null;
    briefGeneratedAt: string | null;
    // Kaspr enrichment
    kasprEnrichedAt?: string | null;
    kasprWorkEmail?: string | null;
    kasprPersonalEmail?: string | null;
    kasprPhone?: string | null;
    kasprTitle?: string | null;
    // FullEnrich enrichment (waterfall 20+ providers)
    emailFullenrich?: string | null;
    phoneFullenrich?: string | null;
    fullenrichAttemptedAt?: string | null;
    // LinkedIn finder source
    linkedinSource?: string | null;
    // Multi-source emails
    emailRodz?: string | null;
    emailSourceCount?: number;
    emailConfidence?: number | null;
    bouncedAt?: string | null;
    bouncedFromEmail?: string | null;
    // RGPD opt-out
    doNotContact?: boolean;
    doNotContactReason?: string | null;
    doNotContactAt?: string | null;
    // Pappers data
    companyRevenue?: number | null;
    companyResultNet?: number | null;
    companyHasInsolvency?: boolean;
    companyEtabsCount?: number | null;
    companyRecentDepots?: Array<{ date?: string; type?: string; decisions?: string[] }> | null;
    // Dropcontact job moves
    jobMoveDetected?: boolean;
    previousCompany?: string | null;
    previousJob?: string | null;
    // Chantier D2 (01/05) — warmMail (mail post-LinkedIn) du Copy Engine v4.0
    warmMailJson?: { subject: string; body: string } | null;
    warmMailGeneratedAt?: string | null;
    copyGeneratedAt?: string | null;
    // Chantier D9 — Fit Score v4.2 pour le verdict
    fitScore?: number | null;
  } | null;
  client: {
    id: string;
    slug: string;
    name: string;
    icp?: Record<string, unknown> | null;
  } | null;
  opportunity: {
    id: string;
    stage: string;
    meetingDate: string | null;
    dealValueEur: number | null;
  } | null;
}

interface Brief {
  summary: {
    whyNow: string;
    icpMatch: string;
    angle: string;
    objections: Array<{ obj: string; reply: string }>;
    closeLine: string;
  };
  email: {
    subject: string;
    body: string;
  };
  linkedin: {
    connection: string;
    followup: string;
  };
  callScript: {
    intro: string;
    hook: string;
    questions: string[];
    objectionHandling: Array<{ obj: string; response: string }>;
    close: string;
  };
}

interface BriefResponse {
  brief: Brief | null;
  generatedAt: string | null;
  fresh: boolean;
  cached?: boolean;
}

// ──────────────────────────────────────────────────────────────────────
// Helpers UI
// ──────────────────────────────────────────────────────────────────────

function copyToClipboard(
  text: string,
  label = "Copié dans le presse-papiers",
  track?: { leadId: string; kind: import("@/lib/track-lead-interaction").LeadInteractionKind },
) {
  navigator.clipboard.writeText(text);
  toast.success(label);
  // Sprint 7 (05/05) — Track passif les copies pour la boucle outcomes
  // Data-only. Best-effort, silent fail si erreur réseau.
  if (track?.leadId) {
    void import("@/lib/track-lead-interaction").then((m) =>
      m.trackLeadInteraction(track.leadId, track.kind),
    );
  }
}

// ──────────────────────────────────────────────────────────────────────
// Board principal
// ──────────────────────────────────────────────────────────────────────

export function TriggerBriefBoard({ triggerId }: { triggerId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [sendOpen, setSendOpen] = React.useState(false);
  // UX4 fix 10/05 — enrichOpen state supprimé (modal Kaspr manuelle retirée)

  const { data, isLoading } = useQuery<TriggerData>({
    queryKey: ["trigger-detail", triggerId],
    queryFn: async () => {
      const res = await fetch(`/api/triggers/${triggerId}`);
      if (!res.ok) throw new Error("Erreur chargement trigger");
      return res.json();
    },
  });

  const generate = useMutation({
    mutationFn: async ({ force }: { force?: boolean } = {}) => {
      const url = `/api/leads/${data!.lead!.id}/brief${force ? "?force=true" : ""}`;
      const res = await fetch(url, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Erreur génération");
      return body as BriefResponse;
    },
    onSuccess: (res) => {
      queryClient.setQueryData<TriggerData>(["trigger-detail", triggerId], (prev) =>
        prev && prev.lead
          ? {
              ...prev,
              lead: {
                ...prev.lead,
                briefJson: res.brief,
                briefGeneratedAt: res.generatedAt,
              },
            }
          : prev,
      );
      if (!res.cached) {
        toast.success("Brief généré ✨", {
          description: "Email, DM LinkedIn et script de call prêts.",
        });
      }
    },
    onError: (err: Error) => {
      toast.error("Génération impossible", { description: err.message });
    },
  });

  // Chantier D2 (01/05) — Copy Engine v4.0 : génère les 4 contextes
  // (coldMail/warmMail/linkedinDm/callBrief) en 1 seul appel Opus.
  // Branché sur le tab "Warm Mail" pour combler le gap commercial.
  const generateCopy = useMutation({
    mutationFn: async ({ force }: { force?: boolean } = {}) => {
      const url = `/api/leads/${data!.lead!.id}/copy${force ? "?force=true" : ""}`;
      const res = await fetch(url, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Erreur génération copy");
      return body;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["trigger-detail", triggerId] });
      if (!res?.cached) {
        toast.success("Copy 4 contextes générée ✨", {
          description: "Cold mail, warm mail post-LinkedIn, DM et brief call prêts.",
        });
      }
    },
    onError: (err: Error) => {
      toast.error("Génération copy impossible", { description: err.message });
    },
  });

  if (isLoading || !data) return <BoardSkeleton />;

  const { trigger, lead, opportunity, client } = data;
  const brief = lead?.briefJson ?? null;
  const hasBrief = !!brief;

  // Chantier D9 (01/05) — Verdict humain calculé depuis tous les signaux
  const icp = (client?.icp ?? {}) as Record<string, unknown>;
  const icpSizeMin = typeof icp.company_size_min === "number" ? icp.company_size_min : undefined;
  const icpSizeMax = typeof icp.company_size_max === "number" ? icp.company_size_max : undefined;
  // UX2 fix 10/05 — pass V2 verdict pour cohérence "Notre analyse"
  const v2 = (trigger.briefV2Json as { verdict?: V2Verdict; confidence?: number } | null) ?? null;
  const verdict = computeLeadVerdict({
    score: trigger.score,
    priorityScore: (trigger as { priorityScore?: number | null }).priorityScore ?? null,
    fitScore: lead?.fitScore ?? null,
    isHot: trigger.isHot,
    hasContact: !!(lead?.email || lead?.kasprWorkEmail || lead?.emailFullenrich || lead?.kasprPhone || lead?.phoneFullenrich || lead?.phone),
    hasMobile: isFrenchMobile(lead?.kasprPhone) || isFrenchMobile(lead?.phoneFullenrich) || isFrenchMobile(lead?.phone),
    hasLinkedin: !!lead?.linkedinUrl,
    hasFirstName: !!(lead?.firstName ?? lead?.fullName),
    bouncedAt: lead?.bouncedAt ?? null,
    doNotContact: lead?.doNotContact ?? false,
    companyHasInsolvency: lead?.companyHasInsolvency ?? false,
    companyEtabsCount: lead?.companyEtabsCount ?? null,
    companySizeText: trigger.size ?? null,
    icpSizeMin,
    icpSizeMax,
    opportunityStage: opportunity?.stage ?? null,
    contactFullName: lead?.fullName ?? null,
    contactPhone: lead?.kasprPhone ?? lead?.phoneFullenrich ?? lead?.phone ?? null,
    contactJobTitle: lead?.jobTitle ?? null,
    capturedAt: trigger.capturedAt,
    triggerSourceCode: trigger.sourceCode ?? null,
    scoreReason: trigger.scoreReason,
    triggerDetail: trigger.detail,
    v2Verdict: v2?.verdict ?? null,
    v2Confidence: v2?.confidence ?? null,
  });

  return (
    <div className="space-y-5">
      {/* Chantier D9-bis (rectif user 02/05) — la bannière a été retirée pour
          ne pas alourdir la fiche. Le verdict est intégré directement dans
          la section "Notre analyse" en place (TriggerHeader). */}

      {/* Bouton retour + actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-500 hover:text-ink-800 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Retour
        </button>

        {lead && (
          <div className="flex items-center gap-2">
            {/* UX4 fix 10/05 — Bouton téléphone : MOBILE FR uniquement (06/07/+336/+337).
                Avant : 3 cas (mobile / standard 01-05/09 / bouton "Trouver le numéro").
                Maintenant : si mobile FR → bouton "Appeler". Sinon rien — les standards
                01/09 ne sont pas affichés (pas actionnables pour cold call), et le
                bouton manuel "Trouver le numéro" est supprimé car le pipeline auto
                (cron source=all 8h+18h UTC + auto-enrich on lead creation) lance déjà
                Kaspr + FullEnrich + HarvestAPI sur tous les nouveaux leads. */}
            {(() => {
              const mobile = isFrenchMobile(lead.kasprPhone) ? lead.kasprPhone
                : isFrenchMobile(lead.phoneFullenrich) ? lead.phoneFullenrich
                : isFrenchMobile(lead.phone) ? lead.phone
                : null;
              if (mobile) {
                return (
                  <a
                    href={`tel:${mobile}`}
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-[13px] font-medium text-white shadow-sm hover:bg-emerald-700 transition-colors"
                    title="Mobile direct du dirigeant"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    Appeler {mobile}
                  </a>
                );
              }
              return null;
            })()}
            {(() => {
              // Fix H10 (04/05) — Désactive "Envoyer email" si risque deliverability.
              // Avant : seul `!lead.email` désactivait. Mais email pattern guess
              // (confidence=50) ou bounced ou DNC → bouton actif → Fred bulk-send →
              // bounce 15-30% → blacklist Primeforge garantie.
              const hasEmail = !!lead.email;
              // Seuil 70 (industry standard outreach) : <70 = pattern guess
              // ou single-source non vérifié → risque bounce 15-30% → blacklist
              // Primeforge. ≥70 = multi-source ou vérifié SMTP/MillionVerifier.
              const lowConfidence =
                typeof lead.emailConfidence === "number" && lead.emailConfidence < 70;
              const isBounced = !!lead.bouncedAt;
              const isDnc = !!lead.doNotContact;
              const blocked = !hasEmail || lowConfidence || isBounced || isDnc;
              const blockedReason = !hasEmail
                ? "Pas d'email destinataire enrichi"
                : isDnc
                  ? `Désinscrit (${lead.doNotContactReason ?? "manuel"})`
                  : isBounced
                    ? `Email a bouncé (${lead.bouncedFromEmail ?? lead.email})`
                    : lowConfidence
                      ? `Confiance email faible (${lead.emailConfidence}/100) — risque bounce`
                      : (lead.email ?? "");
              return (
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => setSendOpen(true)}
                  disabled={blocked}
                  className="gap-1.5"
                  title={blockedReason}
                >
                  <Send className="h-3.5 w-3.5" />
                  Envoyer email
                </Button>
              );
            })()}
          </div>
        )}
      </div>

      <TriggerHeader trigger={trigger} lead={lead} opportunity={opportunity} brief={brief} verdict={verdict} />

      {/* UX fix 10/05 — Renommé "Brief raisonné V2 (judge dormant)" en
          "Analyse complète du cerveau". Le V2 n'est plus dormant depuis
          le refactor V2-only Session 1 — c'est désormais LE seul cerveau.
          Badge utilise le label localisé (À VÉRIFIER au lieu d'ENRICH). */}
      <details className="group rounded-lg border border-ink-200 bg-white shadow-xs">
        <summary className="flex items-center justify-between gap-2 cursor-pointer px-4 py-3 text-[13px] font-semibold text-ink-800 hover:bg-ink-50/50 transition-colors list-none">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-ink-500" />
            <span>Analyse complète du cerveau</span>
            {Boolean(trigger.briefV2Json) && (() => {
              const v = (trigger.briefV2Json as { verdict?: string } | null)?.verdict;
              const labelMap: Record<string, string> = { OUI: "OUI", NON: "NON", ENRICH: "À VÉRIFIER" };
              return (
                <Badge
                  variant="outline"
                  className="text-[10px] font-mono px-1.5 py-0 border-ink-200 text-ink-600"
                >
                  {v ? (labelMap[v] ?? v) : "?"}
                </Badge>
              );
            })()}
          </div>
          <span className="text-[11px] font-normal text-ink-500 group-open:hidden">
            Voir
          </span>
          <span className="text-[11px] font-normal text-ink-500 hidden group-open:inline">
            Masquer
          </span>
        </summary>
        <div className="px-4 pb-4 pt-1">
          <LeadBriefV2ViewSafe
            raw={trigger.briefV2Json ?? null}
            leadFirstName={
              lead?.firstName ?? lead?.fullName?.split(" ")[0] ?? null
            }
          />
        </div>
      </details>

      {!lead ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-[13px] text-ink-500">
              Pas de contact identifié sur ce trigger — l'enrichissement Pappers/Dropcontact
              n'a pas encore tourné.
            </p>
          </CardContent>
        </Card>
      ) : !hasBrief ? (
        <BriefCallToAction
          onGenerate={() => generate.mutate({})}
          generating={generate.isPending}
        />
      ) : (
        <BriefTabs
          brief={brief}
          generatedAt={lead.briefGeneratedAt}
          onRegenerate={() => generate.mutate({ force: true })}
          regenerating={generate.isPending}
          leadEmail={lead.email}
          leadLinkedin={lead.linkedinUrl}
          warmMail={lead.warmMailJson ?? null}
          warmMailGeneratedAt={lead.warmMailGeneratedAt ?? null}
          onGenerateCopy={() => generateCopy.mutate({ force: true })}
          generatingCopy={generateCopy.isPending}
          leadId={lead.id}
        />
      )}

      {lead && (
        <>
          <SendEmailModal
            open={sendOpen}
            onOpenChange={setSendOpen}
            lead={{
              id: lead.id,
              fullName: lead.fullName,
              email: lead.email,
              companyName: lead.companyName,
              jobTitle: lead.jobTitle,
            }}
          />
          {/* UX4 fix 10/05 — EnrichKasprModal supprimée. Plus de bouton manuel
              "Trouver le numéro". Le pipeline auto (cron source=all 8h+18h UTC +
              auto-enrich on lead creation) lance déjà Kaspr/FullEnrich/HarvestAPI
              sur tous les nouveaux leads. */}
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Header trigger + lead + opportunity
// ──────────────────────────────────────────────────────────────────────

// Helper : strip les prénoms du milieu pour ne garder que prénom+nom usuels.
// "Etienne Manuel Gabriel Poirier" → "Etienne Poirier"
// "Jean-Marc Smith" → "Jean-Marc Smith" (préserve composés)
function simplifyFullName(fullName: string | null): string | null {
  if (!fullName) return null;
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 2) return fullName.trim();
  // Premier prénom + dernier mot (= nom de famille)
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

// Strip le warning "⚠️ 250+p — préférer hiring manager LinkedIn" du jobTitle
// (qui sera ré-affiché proprement dans une sous-ligne).
function cleanJobTitle(jobTitle: string | null): string | null {
  if (!jobTitle) return null;
  return jobTitle.replace(/\s*[⚠️!].*$/u, "").trim() || jobTitle;
}

function TriggerHeader({
  trigger,
  lead,
  opportunity,
  brief,
  verdict,
}: {
  trigger: TriggerData["trigger"];
  lead: TriggerData["lead"];
  opportunity: TriggerData["opportunity"];
  brief: Brief | null;
  verdict: VerdictResult;
}) {
  // Refactor V2-only Session 2 — badge verdict V2 (OUI/ENRICH/NON + conf%)
  // au lieu du score 0-10. Fallback score si V2 absent (anciens triggers).
  const v2 = (trigger.briefV2Json as { verdict?: V2Verdict; confidence?: number } | null) ?? null;
  const v2Tier = getV2Tier({ verdict: v2?.verdict, confidence: v2?.confidence });
  const v2Label = getV2Label(v2Tier);
  const v2Variant = getV2Variant(v2Tier);
  const v2Badge = formatV2Badge({ verdict: v2?.verdict, confidence: v2?.confidence });

  // Fallback score (anciens triggers sans V2)
  const scoreVariant = trigger.isHot
    ? "fire"
    : trigger.score >= 7
      ? "score"
      : trigger.score >= 5
        ? "info"
        : "warning";

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-50 to-brand-100 text-brand-600">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-[20px] font-semibold tracking-tight text-ink-900">
                {trigger.companyName}
              </h1>
              {v2Tier ? (
                <>
                  <Badge variant={v2Variant} size="md" className="font-mono tabular-nums" title={v2Label}>
                    {v2Badge}
                  </Badge>
                  <span className="text-[11px] uppercase tracking-wider text-ink-500">{v2Label}</span>
                </>
              ) : (
                <Badge variant={scoreVariant} size="md" className="font-mono tabular-nums" title="Pas de verdict V2 (lead pre-Sprint 8)">
                  {trigger.score}/10
                </Badge>
              )}
              {trigger.isHot && !v2Tier && (
                <Badge variant="fire" size="sm" className="gap-1">
                  <Zap className="h-2.5 w-2.5" />
                  Hot
                </Badge>
              )}
              {trigger.isCombo && (
                <Badge variant="brand" size="sm" className="gap-1">
                  <Sparkles className="h-2.5 w-2.5" />
                  Combo
                </Badge>
              )}
            </div>
            {/* Ville/région simplifiée (industry + size techniques retirés du header) */}
            {trigger.region && (
              <p className="mt-1 text-[12.5px] text-ink-600">{trigger.region}</p>
            )}
          </div>
          <div className="text-right">
            <div className="text-[10.5px] uppercase tracking-wider text-ink-400">Détecté</div>
            <div className="font-mono text-[12.5px] tabular-nums text-ink-700">
              {formatRelativeFr(trigger.capturedAt)}
            </div>
          </div>
        </div>

        {/* Section "Ce qu'on a détecté" — réécriture commerciale du signal brut */}
        <div className="rounded-md border border-brand-200 bg-brand-50/40 p-3">
          <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-brand-700">
            <Target className="h-3 w-3" />
            Ce qu&apos;on a détecté
          </div>
          {/* Titre simplifié : strip "[client] — ", suffixe société, parens parasites, IDs internes */}
          <div className="mt-1 text-[13.5px] font-medium text-ink-900">
            {simplifyTriggerTitle(trigger.title, trigger.companyName)}
          </div>
          {(() => {
            const t = truncateDetail(trigger.detail);
            if (!t) return null;
            return (
              <div className="mt-1 text-[12px] leading-relaxed text-ink-600">
                {t.text}
                {(t.truncated || trigger.sourceUrl) && trigger.sourceUrl && (
                  <a
                    href={trigger.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 text-brand-600 underline underline-offset-2 hover:text-brand-700"
                  >
                    Voir l&apos;annonce →
                  </a>
                )}
              </div>
            );
          })()}
        </div>

        {/* Section "Notre analyse" — verdict humain inline (remplace "Pourquoi N/10 — IA Opus")
            Couleur dépend du verdict : rouge OFF_TARGET, orange ENRICH, gris HOLD, etc.
            Étape A (04/05) : si briefJson.summary.whyNow + angle existent et sont non-vides,
            on les affiche À LA PLACE des phrases génériques verdict.reason/verdict.action.
            Garde la structure verdict (couleur + label) comme cadre visuel. */}
        {(() => {
          // Use brief Opus content si dispo, fallback verdict sinon.
          // Restriction : pas pour OFF_TARGET / HOLD_LOW_PRIORITY / BOOKED
          // (le verdict y est plus pertinent qu'un angle d'attaque commercial).
          const useBriefContent =
            !!brief?.summary?.whyNow?.trim()
            && !!brief?.summary?.angle?.trim()
            && verdict.kind !== "OFF_TARGET"
            && verdict.kind !== "HOLD_LOW_PRIORITY"
            && verdict.kind !== "BOOKED";
          const reasonText = useBriefContent ? brief!.summary.whyNow : verdict.reason;
          const actionText = useBriefContent ? brief!.summary.angle : verdict.action;
          return (
            <div className={cn(
              "rounded-md border p-3",
              verdict.color === "danger" && "border-red-200 bg-red-50/40",
              verdict.color === "warning" && "border-amber-200 bg-amber-50/40",
              verdict.color === "success" && "border-emerald-200 bg-emerald-50/40",
              verdict.color === "info" && "border-brand-200 bg-brand-50/40",
              verdict.color === "default" && "border-ink-200 bg-ink-50/40",
            )}>
              <div className={cn(
                "flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider",
                verdict.color === "danger" && "text-red-700",
                verdict.color === "warning" && "text-amber-700",
                verdict.color === "success" && "text-emerald-700",
                verdict.color === "info" && "text-brand-700",
                verdict.color === "default" && "text-ink-600",
              )}>
                <span>🎯</span>
                Notre analyse
                {useBriefContent && (
                  <span className="ml-1 rounded bg-white/60 px-1 py-0.5 text-[9px] font-medium text-ink-500">
                    Opus
                  </span>
                )}
              </div>
              <div className="mt-1 text-[13px] font-medium leading-relaxed text-ink-900">
                {verdict.label}
              </div>
              <div className="mt-1 text-[12.5px] leading-relaxed text-ink-700">
                {reasonText}
              </div>
              <div className="mt-2 text-[12.5px] leading-relaxed text-ink-800">
                <span className="font-semibold">→ </span>{actionText}
              </div>
            </div>
          );
        })()}

        {/* Contact + Opportunité */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {lead && (
            <div className="rounded-md border border-ink-100 bg-white p-3">
              <div className="text-[10.5px] uppercase tracking-wider text-ink-500">
                Contact identifié
              </div>
              <div className="mt-1 text-[13px] font-medium text-ink-900">
                {simplifyFullName(lead.fullName) ?? "À identifier"}
              </div>
              <div className="text-[11.5px] text-ink-600">{cleanJobTitle(lead.jobTitle) ?? "—"}</div>
              {/* Warning "trop haut placé" en sous-ligne lisible (au lieu d'inline jobTitle) */}
              {verdict.flags.includes("decideur_juridique_pas_hiring") && (
                <div className="mt-1.5 text-[11.5px] leading-relaxed text-amber-700">
                  ⚠️ Trop haut placé pour cette boîte. Cherche le bon contact technique sur LinkedIn de l&apos;annonce.
                </div>
              )}
              {lead.email && (
                <div className="mt-1 flex items-center gap-2">
                  <a
                    href={`mailto:${lead.email}`}
                    className="flex items-center gap-1 font-mono text-[11px] text-brand-700 hover:underline"
                  >
                    <Mail className="h-3 w-3" />
                    {lead.email}
                  </a>
                  <a
                    href={gmailComposeUrl({
                      to: lead.email,
                      subject: brief?.email?.subject,
                      body: brief?.email?.body,
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={brief?.email ? "Ouvrir Gmail avec pitch pré-rempli" : "Ouvrir dans Gmail"}
                    className="rounded bg-ink-50 px-1.5 py-0.5 text-[10px] font-medium text-ink-700 hover:bg-ink-100"
                  >
                    Gmail{brief?.email ? " ✨" : ""}
                  </a>
                </div>
              )}
              {lead.linkedinUrl && normalizeLinkedinUrl(lead.linkedinUrl) && (
                <a
                  href={normalizeLinkedinUrl(lead.linkedinUrl)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 flex items-center gap-1 text-[11px] text-brand-700 hover:underline"
                >
                  <Linkedin className="h-3 w-3" />
                  LinkedIn
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
              {lead.kasprEnrichedAt && (
                <div className="mt-2 border-t border-ink-100 pt-2 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="info" size="sm" className="gap-1">
                      <Database className="h-2.5 w-2.5" />
                      Kaspr
                    </Badge>
                    <span className="text-[10px] text-ink-400">
                      {formatRelativeFr(lead.kasprEnrichedAt)}
                    </span>
                  </div>
                  {lead.kasprTitle && (
                    <div className="text-[11px] text-ink-700">{lead.kasprTitle}</div>
                  )}
                  {lead.kasprWorkEmail && lead.kasprWorkEmail !== lead.email && (
                    <div className="flex items-center gap-2">
                      <a
                        href={`mailto:${lead.kasprWorkEmail}`}
                        className="flex items-center gap-1 font-mono text-[11px] text-brand-700 hover:underline"
                      >
                        <Mail className="h-3 w-3" />
                        {lead.kasprWorkEmail}
                        <Badge variant="success" size="sm" className="ml-1">Pro</Badge>
                      </a>
                      <a
                        href={gmailComposeUrl({
                          to: lead.kasprWorkEmail,
                          subject: brief?.email?.subject,
                          body: brief?.email?.body,
                        })}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={brief?.email ? "Ouvrir Gmail avec pitch pré-rempli" : "Ouvrir dans Gmail"}
                        className="rounded bg-ink-50 px-1.5 py-0.5 text-[10px] font-medium text-ink-700 hover:bg-ink-100"
                      >
                        Gmail{brief?.email ? " ✨" : ""}
                      </a>
                    </div>
                  )}
                  {lead.kasprPersonalEmail && lead.kasprPersonalEmail !== lead.email && (
                    <div className="flex items-center gap-2">
                      <a
                        href={`mailto:${lead.kasprPersonalEmail}`}
                        className="flex items-center gap-1 font-mono text-[11px] text-brand-700 hover:underline"
                      >
                        <Mail className="h-3 w-3" />
                        {lead.kasprPersonalEmail}
                        <Badge variant="warning" size="sm" className="ml-1">Perso</Badge>
                      </a>
                      <a
                        href={gmailComposeUrl({
                          to: lead.kasprPersonalEmail,
                          subject: brief?.email?.subject,
                          body: brief?.email?.body,
                        })}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={brief?.email ? "Ouvrir Gmail avec pitch pré-rempli" : "Ouvrir dans Gmail"}
                        className="rounded bg-ink-50 px-1.5 py-0.5 text-[10px] font-medium text-ink-700 hover:bg-ink-100"
                      >
                        Gmail{brief?.email ? " ✨" : ""}
                      </a>
                    </div>
                  )}
                  {lead.kasprPhone && (
                    <a
                      href={`tel:${lead.kasprPhone}`}
                      className="flex items-center gap-1 font-mono text-[11px] text-brand-700 hover:underline"
                    >
                      <Phone className="h-3 w-3" />
                      {lead.kasprPhone}
                    </a>
                  )}
                </div>
              )}
              {/* FullEnrich enrichment (waterfall 20+ providers, audit 30/04) */}
              {lead.fullenrichAttemptedAt && (lead.emailFullenrich || lead.phoneFullenrich) && (
                <div className="mt-2 border-t border-ink-100 pt-2 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="info" size="sm" className="gap-1 bg-purple-100 text-purple-800 border-purple-200">
                      <Database className="h-2.5 w-2.5" />
                      FullEnrich
                    </Badge>
                    <span className="text-[10px] text-ink-400">
                      {formatRelativeFr(lead.fullenrichAttemptedAt)}
                    </span>
                    <span className="text-[10px] text-ink-400">· waterfall 20+ sources</span>
                  </div>
                  {lead.emailFullenrich && lead.emailFullenrich !== lead.email && lead.emailFullenrich !== lead.kasprWorkEmail && (
                    <div className="flex items-center gap-2">
                      <a
                        href={`mailto:${lead.emailFullenrich}`}
                        className="flex items-center gap-1 font-mono text-[11px] text-brand-700 hover:underline"
                      >
                        <Mail className="h-3 w-3" />
                        {lead.emailFullenrich}
                        <Badge variant="success" size="sm" className="ml-1">FE</Badge>
                      </a>
                      <a
                        href={gmailComposeUrl({
                          to: lead.emailFullenrich,
                          subject: brief?.email?.subject,
                          body: brief?.email?.body,
                        })}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={brief?.email ? "Ouvrir Gmail avec pitch pré-rempli" : "Ouvrir dans Gmail"}
                        className="rounded bg-ink-50 px-1.5 py-0.5 text-[10px] font-medium text-ink-700 hover:bg-ink-100"
                      >
                        Gmail{brief?.email ? " ✨" : ""}
                      </a>
                    </div>
                  )}
                  {lead.phoneFullenrich && lead.phoneFullenrich !== lead.kasprPhone && lead.phoneFullenrich !== lead.phone && (
                    <a
                      href={`tel:${lead.phoneFullenrich}`}
                      className="flex items-center gap-1 font-mono text-[11px] text-brand-700 hover:underline"
                    >
                      <Phone className="h-3 w-3" />
                      {lead.phoneFullenrich}
                      <Badge variant="success" size="sm" className="ml-1">FE Mobile</Badge>
                    </a>
                  )}
                </div>
              )}
              {/* RGPD opt-out badge (audit 30/04 — l'IMAP a détecté "stop"/"unsubscribe") */}
              {lead.doNotContact && (
                <div className="mt-2 rounded-md border border-red-300 bg-red-100 px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="danger" size="sm">🚫 Ne pas contacter</Badge>
                    <span className="text-[10.5px] text-red-900 font-medium">
                      {lead.doNotContactReason === "auto_imap_unsub"
                        ? "Désabonnement détecté"
                        : lead.doNotContactReason === "auto_imap_stop"
                        ? "Réponse 'stop' détectée"
                        : lead.doNotContactReason === "auto_imap_remove"
                        ? "Demande de suppression"
                        : `Opt-out (${lead.doNotContactReason ?? "manual"})`}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-red-800">
                    Lead exclu de tous les bulk-send-email (RGPD).
                  </div>
                </div>
              )}
              {/* Bounce alert (Resend a remonté un bounce — l'email a été marqué) */}
              {lead.bouncedAt && lead.bouncedFromEmail && (
                <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="danger" size="sm">⚠️ Bounce</Badge>
                    <span className="text-[10.5px] text-red-800">
                      Email rejeté : {lead.bouncedFromEmail}
                    </span>
                  </div>
                </div>
              )}
              {/* UX3 fix 10/05 — Multi-source badge nuancé :
                  - Si emails Kaspr + FullEnrich identiques → "✓ Email confirmé" (success vert)
                  - Si emails DIFFÉRENTS → "2 candidats à vérifier" (warning orange)
                  Avant : badge "✓ Email confirmé par N sources" affiché dès N>=2 même
                  si les emails étaient différents → faux signal de confiance. */}
              {lead.emailSourceCount !== undefined && lead.emailSourceCount >= 2 && (() => {
                // UX fix 10/05 v3 — Double filtre intelligent pour éviter les
                // faux warnings "à vérifier".
                //
                // AVANT : un email d'ex-employeur stocké (Rodz jls@gmao.com pour
                // DimoMaint) OU un alias de la même personne (paul@ + paul.vidal@
                // pour Collective.work) déclenchait "⚠️ 2 candidats" alors qu'en
                // réalité c'est résolu (un mauvais à ignorer / des alias OK).
                //
                // MAINTENANT : 2 filtres successifs :
                //   1. Filtre DOMAIN — vire les emails ex-employeurs (domain ≠ boîte)
                //   2. Filtre PRÉNOM — vire les emails de gens différents
                //      (local-part ne contient pas le prénom du lead)
                // Si ce qui reste = 0 → pas de badge
                // Si ce qui reste = 1 email unique OU plusieurs alias même persona → ✓ Confirmé
                // Si ce qui reste = vraiment plusieurs personnes différentes → ⚠️ à vérifier
                const companyName = lead.companyName ?? trigger.companyName ?? "";
                const companyTokens = companyName
                  .toLowerCase()
                  .normalize("NFD").replace(/\p{Mn}/gu, "")
                  .split(/[^a-z0-9]+/)
                  .filter((w) => w.length >= 3 && !["sas","sarl","sa","sci","sasu"].includes(w));
                const emailMatchesCompany = (e: string): boolean => {
                  if (!companyTokens.length) return true;
                  const domain = e.split("@")[1]?.toLowerCase() ?? "";
                  return companyTokens.some((tok) => domain.includes(tok));
                };
                // Prénom du lead (firstName, fallback fullName 1er mot)
                const firstName = ((lead.firstName ?? lead.fullName?.split(" ")[0] ?? "") || "")
                  .toLowerCase()
                  .normalize("NFD").replace(/\p{Mn}/gu, "")
                  .trim();
                const emailMatchesPersona = (e: string): boolean => {
                  if (!firstName || firstName.length < 2) return true; // pas de check possible
                  const localPart = (e.split("@")[0] ?? "")
                    .toLowerCase()
                    .normalize("NFD").replace(/\p{Mn}/gu, "");
                  return localPart.includes(firstName);
                };
                const kasprEmail = lead.kasprWorkEmail ?? lead.kasprPersonalEmail ?? null;
                const feEmail = lead.emailFullenrich ?? null;
                const rodzEmail = lead.emailRodz ?? null;
                const allEmails = [kasprEmail, feEmail, rodzEmail].filter(Boolean) as string[];
                // Double filtre : domain matche la boîte + local-part matche le prénom
                const cleanEmails = allEmails
                  .filter(emailMatchesCompany)
                  .filter(emailMatchesPersona);
                const distinct = [...new Set(cleanEmails.map((e) => e.toLowerCase().trim()))];
                // 0 email valide après filtres → pas de badge
                if (cleanEmails.length === 0) return null;
                // 1 seul email distinct (qu'il vienne d'1 ou plusieurs sources) → ✓ Confirmé
                // (cas : Kaspr=paul.vidal@ + FE=paul.vidal@ ; OU Kaspr=paul@ + FE=paul.vidal@ tous "paul")
                if (distinct.length === 1) {
                  // Si seulement 1 source → pas besoin de badge "confirmé" (rien à confirmer)
                  if (cleanEmails.length === 1) return null;
                  return (
                    <div className="mt-2 flex items-center gap-1.5">
                      <Badge variant="success" size="sm">
                        ✓ Email confirmé par {cleanEmails.length} sources
                      </Badge>
                    </div>
                  );
                }
                // Plusieurs emails distincts qui passent les 2 filtres : alias possibles
                // de la même personne (paul@ + paul.vidal@). On confirme aussi.
                // C'est très rare d'avoir 2 vraies personnes différentes qui passent
                // domain + prénom du lead — donc on fait confiance au système.
                return (
                  <div className="mt-2 flex items-center gap-1.5">
                    <Badge variant="success" size="sm">
                      ✓ Email confirmé ({cleanEmails.length} alias trouvés)
                    </Badge>
                  </div>
                );
              })()}
              {/* Job Move badge (Dropcontact a détecté changement de poste <6m) */}
              {lead.jobMoveDetected && (
                <div className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="warning" size="sm">🔥 Job Move</Badge>
                    <span className="text-[10.5px] text-orange-800">
                      Changement de poste récent
                    </span>
                  </div>
                  {lead.previousCompany && (
                    <div className="mt-0.5 text-[11px] text-ink-700">
                      Avant : <span className="font-medium">{lead.previousJob ?? "?"}</span>
                      {lead.previousCompany && (
                        <span className="text-ink-500"> chez {lead.previousCompany}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {/* Carte "Données Société" — Pappers + Dropcontact */}
          {lead && (lead.companyRevenue || lead.companyResultNet || lead.companyHasInsolvency || lead.companyEtabsCount || (lead.companyRecentDepots && lead.companyRecentDepots.length > 0)) && (
            <div className={`rounded-md border p-3 ${lead.companyHasInsolvency ? "border-red-200 bg-red-50" : "border-ink-100 bg-white"}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10.5px] uppercase tracking-wider text-ink-500">
                  Données Société (Pappers)
                </div>
                {lead.companyHasInsolvency && (
                  <Badge variant="danger" size="sm">⚠️ Procédure collective</Badge>
                )}
              </div>
              <div className="space-y-1.5">
                {/* Chantier D9 — humanizers : "63 M€ — solide" au lieu de "63.0 M€" brut */}
                {lead.companyRevenue !== null && lead.companyRevenue !== undefined && (
                  <div className="flex items-center justify-between text-[11.5px] gap-2">
                    <span className="text-ink-600 shrink-0">Chiffre d'affaires</span>
                    <span className="text-ink-900 text-right">
                      {humanizeRevenue(lead.companyRevenue)}
                    </span>
                  </div>
                )}
                {lead.companyResultNet !== null && lead.companyResultNet !== undefined && (
                  <div className="flex items-center justify-between text-[11.5px] gap-2">
                    <span className="text-ink-600 shrink-0">Résultat net</span>
                    <span className={`text-right ${lead.companyResultNet >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                      {humanizeResultNet(lead.companyResultNet)}
                    </span>
                  </div>
                )}
                {lead.companyEtabsCount !== null && lead.companyEtabsCount !== undefined && lead.companyEtabsCount > 1 && (
                  <div className="flex items-center justify-between text-[11.5px] gap-2">
                    <span className="text-ink-600 shrink-0">Établissements</span>
                    <span className="text-ink-900 text-right">
                      {humanizeEtabsCount(lead.companyEtabsCount)}
                    </span>
                  </div>
                )}
              </div>
              {lead.companyRecentDepots && lead.companyRecentDepots.length > 0 && (
                <div className="mt-2 border-t border-ink-100 pt-2">
                  <div className="text-[10.5px] uppercase tracking-wider text-ink-500 mb-1">
                    Dépôts d'actes RCS &lt; 90j
                  </div>
                  <ul className="space-y-0.5">
                    {lead.companyRecentDepots.slice(0, 3).map((d, i) => (
                      <li key={i} className="text-[11px] text-ink-700">
                        <span className="text-ink-400">{d.date?.slice(0, 10)}</span> · {d.type ?? "Acte RCS"}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {opportunity && (
            <div className="rounded-md border border-ink-100 bg-white p-3">
              <div className="text-[10.5px] uppercase tracking-wider text-ink-500">
                Opportunité
              </div>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant="brand" size="sm">
                  {opportunity.stage.replace("_", " ")}
                </Badge>
                {opportunity.dealValueEur !== null && (
                  <span className="font-mono text-[12px] tabular-nums text-ink-900">
                    {formatNumberFr(opportunity.dealValueEur)} €
                  </span>
                )}
              </div>
              {opportunity.meetingDate && (
                <div className="mt-1 text-[11px] text-ink-600">
                  RDV {formatRelativeFr(opportunity.meetingDate)}
                </div>
              )}
            </div>
          )}
          {/* Activité multi-canal : email + LinkedIn + appels + RDV + checklist */}
          {lead && <LeadActivityPanel leadId={lead.id} />}
        </div>

        {/* Footer technique discret : SIRET + NAF + source (info utile mais pas commerciale) */}
        <div className="mt-2 border-t border-ink-100 pt-2 flex flex-wrap items-center gap-3 text-[10.5px] text-ink-400 font-mono">
          {trigger.companySiret && <span>SIRET {trigger.companySiret.slice(0, 9)}</span>}
          {trigger.companyNaf && <span>NAF {trigger.companyNaf}</span>}
          {formatSourceLabel(trigger.sourceCode) && (
            <span className="ml-auto">Source : {formatSourceLabel(trigger.sourceCode)}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Email activity timeline
// ──────────────────────────────────────────────────────────────────────

function EmailActivitySection({ leadId }: { leadId: string }) {
  const { data } = useQuery<{
    activity: Array<{
      id: string;
      direction: "SENT" | "RECEIVED";
      subject: string;
      sentAt: string;
      template?: string | null;
      replyClassification?: string | null;
    }>;
    eventCounts: {
      delivered: number;
      opened: number;
      clicked: number;
      bounced: number;
      complained: number;
      unsubscribed: number;
    };
    isWarm: boolean;
  }>({
    queryKey: ["lead-email-activity", leadId],
    queryFn: async () => {
      const res = await fetch(`/api/leads/${leadId}/email-activity?limit=10`);
      if (!res.ok) return { activity: [], eventCounts: { delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, unsubscribed: 0 }, isWarm: false };
      return res.json();
    },
    refetchInterval: 60 * 1000,
  });

  const activity = data?.activity ?? [];
  const counts = data?.eventCounts;
  const hasContent = activity.length > 0 || (counts && (counts.opened + counts.clicked + counts.bounced) > 0);
  if (!hasContent) return null;

  const classificationVariant: Record<string, "success" | "warning" | "danger" | "info" | "default"> = {
    positive: "success",
    negative: "danger",
    neutral: "info",
    ooo: "warning",
    unsubscribe: "danger",
  };

  return (
    <div className="rounded-md border border-ink-100 bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10.5px] uppercase tracking-wider text-ink-500">
          Activité email
        </div>
        {data?.isWarm && (
          <Badge variant="fire" size="sm">🔥 Warm</Badge>
        )}
      </div>
      {counts && (counts.opened > 0 || counts.clicked > 0 || counts.bounced > 0) && (
        <div className="flex flex-wrap gap-1.5 mb-2 text-[11px]">
          {counts.opened > 0 && (
            <Badge variant="success" size="sm">📭 {counts.opened} ouvert{counts.opened > 1 ? "s" : ""}</Badge>
          )}
          {counts.clicked > 0 && (
            <Badge variant="brand" size="sm">🔗 {counts.clicked} clic{counts.clicked > 1 ? "s" : ""}</Badge>
          )}
          {counts.bounced > 0 && (
            <Badge variant="danger" size="sm">⚠️ {counts.bounced} bounce{counts.bounced > 1 ? "s" : ""}</Badge>
          )}
          {counts.unsubscribed > 0 && (
            <Badge variant="warning" size="sm">🚫 désinscrit</Badge>
          )}
        </div>
      )}
      {activity.length > 0 && (
        <ul className="space-y-1.5">
          {activity.slice(0, 5).map((a) => {
            const isSent = a.direction === "SENT";
            const cls = a.replyClassification?.toLowerCase();
            return (
              <li key={a.id} className="flex items-start gap-2 text-[11px]">
                <span className={`mt-0.5 ${isSent ? "text-brand-600" : "text-emerald-600"}`}>
                  {isSent ? "→" : "←"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-ink-700 truncate">{a.subject}</span>
                    {cls && classificationVariant[cls] && (
                      <Badge variant={classificationVariant[cls]} size="sm">{cls}</Badge>
                    )}
                  </div>
                  <span className="text-ink-400">{formatRelativeFr(a.sentAt)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// CTA "Générer le brief" (avant 1ère génération)
// ──────────────────────────────────────────────────────────────────────

function BriefCallToAction({
  onGenerate,
  generating,
}: {
  onGenerate: () => void;
  generating: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 text-brand-600 shadow-sm">
          <Sparkles className="h-6 w-6" />
        </div>
        <div>
          <h2 className="font-display text-[18px] font-semibold tracking-tight text-ink-900">
            Brief commercial Opus
          </h2>
          <p className="mt-1 max-w-md text-[13px] text-ink-600">
            Claude Opus 4.7 va analyser ce trigger + l'ICP du client, puis vous livrer en
            10-15 secondes : email cold prêt à envoyer, message LinkedIn, script de call
            personnalisé et résumé stratégique.
          </p>
        </div>
        <Button
          variant="primary"
          size="lg"
          onClick={onGenerate}
          disabled={generating}
          className="gap-1.5"
        >
          {generating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Opus en cours…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Générer le brief
            </>
          )}
        </Button>
        {generating && (
          <p className="text-[11px] italic text-ink-400">
            Compte 10 à 20 secondes — Opus rédige les 4 contenus en un seul passage.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tabs (brief existe)
// ──────────────────────────────────────────────────────────────────────

function BriefTabs({
  brief,
  generatedAt,
  onRegenerate,
  regenerating,
  leadEmail,
  leadLinkedin,
  warmMail,
  warmMailGeneratedAt,
  onGenerateCopy,
  generatingCopy,
  leadId,
}: {
  brief: Brief;
  generatedAt: string | null;
  onRegenerate: () => void;
  regenerating: boolean;
  leadEmail: string | null;
  leadLinkedin: string | null;
  warmMail: { subject: string; body: string } | null;
  warmMailGeneratedAt: string | null;
  onGenerateCopy: () => void;
  generatingCopy: boolean;
  leadId: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11.5px] text-ink-500">
          {generatedAt
            ? `Généré ${formatRelativeFr(generatedAt)} par Claude Opus 4.7`
            : "Cache"}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRegenerate}
          disabled={regenerating}
          className="gap-1.5"
        >
          {regenerating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Régénérer
        </Button>
      </div>

      <Tabs defaultValue="summary" className="space-y-3">
        <TabsList className="bg-white border border-ink-200 shadow-xs">
          <TabsTrigger value="summary" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Brief
          </TabsTrigger>
          <TabsTrigger value="email" className="gap-1.5">
            <Mail className="h-3.5 w-3.5" />
            Email
          </TabsTrigger>
          <TabsTrigger value="linkedin" className="gap-1.5">
            <Linkedin className="h-3.5 w-3.5" />
            LinkedIn
          </TabsTrigger>
          <TabsTrigger value="warm" className="gap-1.5" title="Mail à envoyer APRÈS un échange LinkedIn (réf. à la conversation)">
            <Sparkles className="h-3.5 w-3.5" />
            Warm mail
          </TabsTrigger>
          <TabsTrigger value="call" className="gap-1.5">
            <PhoneCall className="h-3.5 w-3.5" />
            Script call
          </TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <SummaryTab summary={brief.summary} leadId={leadId} />
        </TabsContent>
        <TabsContent value="email">
          <EmailTab email={brief.email} leadEmail={leadEmail} leadId={leadId} />
        </TabsContent>
        <TabsContent value="linkedin">
          <LinkedinTab linkedin={brief.linkedin} leadLinkedin={leadLinkedin} leadId={leadId} />
        </TabsContent>
        <TabsContent value="warm">
          <WarmMailTab
            warmMail={warmMail}
            warmMailGeneratedAt={warmMailGeneratedAt}
            leadEmail={leadEmail}
            onGenerate={onGenerateCopy}
            generating={generatingCopy}
            leadId={leadId}
          />
        </TabsContent>
        <TabsContent value="call">
          <CallTab callScript={brief.callScript} leadId={leadId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tab : Brief stratégique
// ──────────────────────────────────────────────────────────────────────

function SummaryTab({ summary, leadId }: { summary: Brief["summary"]; leadId: string }) {
  const sections: Array<{ label: string; content: React.ReactNode; copy?: string }> = [
    { label: "Pourquoi maintenant", content: summary.whyNow, copy: summary.whyNow },
    { label: "Match ICP", content: summary.icpMatch, copy: summary.icpMatch },
    { label: "Angle d'attaque", content: summary.angle, copy: summary.angle },
  ];

  const allText = `Pourquoi maintenant : ${summary.whyNow}\n\nMatch ICP : ${summary.icpMatch}\n\nAngle : ${summary.angle}\n\nObjections probables :\n${summary.objections
    .map((o) => `- ${o.obj} → ${o.reply}`)
    .join("\n")}\n\nClose : ${summary.closeLine}`;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink-900">
            Brief stratégique
          </h3>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              copyToClipboard(allText, "Brief copié", { leadId, kind: "copy_brief" })
            }
            className="gap-1.5"
          >
            <Copy className="h-3 w-3" />
            Copier le brief
          </Button>
        </div>

        {sections.map((s) => (
          <div key={s.label} className="space-y-1">
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-500">
              {s.label}
            </div>
            <div className="text-[13px] leading-relaxed text-ink-800">{s.content}</div>
          </div>
        ))}

        <div>
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-500">
            Objections probables ({summary.objections.length})
          </div>
          <ul className="space-y-2">
            {summary.objections.map((o, idx) => (
              <li
                key={idx}
                className="rounded-md border border-amber-200 bg-amber-50/50 p-3"
              >
                <div className="text-[12.5px] font-medium text-amber-900">
                  ⚠️ {o.obj}
                </div>
                <div className="mt-1 text-[12.5px] leading-relaxed text-ink-700">
                  ↳ {o.reply}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-emerald-700">
            Phrase de close
          </div>
          <div className="mt-0.5 text-[13.5px] font-medium text-ink-900">
            {summary.closeLine}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tab : Email
// ──────────────────────────────────────────────────────────────────────

function EmailTab({
  email,
  leadEmail,
  leadId,
}: {
  email: Brief["email"];
  leadEmail: string | null;
  leadId: string;
}) {
  const fullEmail = `Sujet : ${email.subject}\n\n${email.body}`;
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink-900">
            Email cold
          </h3>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                copyToClipboard(email.subject, "Sujet copié", { leadId, kind: "copy_email" })
              }
              className="gap-1.5"
            >
              <Copy className="h-3 w-3" />
              Sujet
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                copyToClipboard(email.body, "Corps copié", { leadId, kind: "copy_email" })
              }
              className="gap-1.5"
            >
              <Copy className="h-3 w-3" />
              Corps
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                copyToClipboard(fullEmail, "Email complet copié", { leadId, kind: "copy_email" })
              }
              className="gap-1.5"
            >
              <Copy className="h-3 w-3" />
              Tout
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-500">
            Sujet ({email.subject.length} caractères)
          </div>
          <div className="rounded-md border border-ink-200 bg-white p-3 font-mono text-[12.5px] text-ink-900 shadow-xs">
            {email.subject}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-500">
            Corps ({email.body.length} caractères)
          </div>
          <div className="rounded-md border border-ink-200 bg-white p-4 text-[13px] leading-relaxed text-ink-800 shadow-xs whitespace-pre-wrap">
            {email.body}
          </div>
        </div>

        {leadEmail && (
          <div className="flex items-center justify-between rounded-md border border-ink-100 bg-ink-50/40 p-3">
            <div className="text-[11.5px] text-ink-600">
              Destinataire :{" "}
              <span className="font-mono font-medium text-ink-800">{leadEmail}</span>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={gmailComposeUrl({ to: leadEmail, subject: email.subject, body: email.body })}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-[12px] font-medium text-white shadow-sm hover:bg-brand-700 transition-colors"
              >
                <Mail className="h-3 w-3" />
                Ouvrir dans Gmail
              </a>
              <a
                href={`mailto:${leadEmail}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-white px-3 py-1.5 text-[12px] font-medium text-ink-700 shadow-xs hover:bg-ink-50 transition-colors"
              >
                <Mail className="h-3 w-3" />
                Mail système
              </a>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tab : LinkedIn
// ──────────────────────────────────────────────────────────────────────

function LinkedinTab({
  linkedin,
  leadLinkedin,
  leadId,
}: {
  linkedin: Brief["linkedin"];
  leadLinkedin: string | null;
  leadId: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink-900">
            Messages LinkedIn
          </h3>
          {leadLinkedin && (
            <a
              href={leadLinkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-white px-3 py-1.5 text-[12px] font-medium text-ink-700 shadow-xs hover:bg-ink-50"
            >
              <Linkedin className="h-3 w-3" />
              Ouvrir profil
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>

        <MessageBlock
          label={`Demande de connexion (${linkedin.connection.length} caractères / 300 max)`}
          warning={linkedin.connection.length > 280}
          text={linkedin.connection}
          copyLabel="Connexion copiée"
          leadId={leadId}
          kind="copy_linkedin"
        />

        <MessageBlock
          label={`Follow-up à J+3 (${linkedin.followup.length} caractères)`}
          warning={false}
          text={linkedin.followup}
          copyLabel="Follow-up copié"
          leadId={leadId}
          kind="copy_linkedin"
        />

        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800">
          <span className="mt-0.5">⚠️</span>
          <span>
            <strong>LinkedIn = MANUEL UNIQUEMENT</strong>. Copiez et envoyez vous-même
            depuis votre compte. Aucune automation autorisée (risque ban).
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function MessageBlock({
  label,
  warning,
  text,
  copyLabel,
  leadId,
  kind,
}: {
  label: string;
  warning: boolean;
  text: string;
  copyLabel: string;
  leadId?: string;
  kind?: import("@/lib/track-lead-interaction").LeadInteractionKind;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div
          className={cn(
            "text-[10.5px] font-semibold uppercase tracking-wider",
            warning ? "text-red-600" : "text-ink-500",
          )}
        >
          {label}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            copyToClipboard(text, copyLabel, leadId && kind ? { leadId, kind } : undefined)
          }
          className="gap-1.5"
        >
          <Copy className="h-3 w-3" />
          Copier
        </Button>
      </div>
      <div className="rounded-md border border-ink-200 bg-white p-4 text-[13px] leading-relaxed text-ink-800 shadow-xs whitespace-pre-wrap">
        {text}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tab : Script call
// ──────────────────────────────────────────────────────────────────────

function CallTab({
  callScript,
  leadId,
}: {
  callScript: Brief["callScript"];
  leadId: string;
}) {
  const allText = `INTRO : ${callScript.intro}\n\nHOOK : ${callScript.hook}\n\nQUESTIONS :\n${callScript.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nOBJECTIONS :\n${callScript.objectionHandling
    .map((o) => `- ${o.obj} → ${o.response}`)
    .join("\n")}\n\nCLOSE : ${callScript.close}`;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink-900">
            Script de call
          </h3>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              copyToClipboard(allText, "Script copié", { leadId, kind: "copy_callscript" })
            }
            className="gap-1.5"
          >
            <Copy className="h-3 w-3" />
            Copier le script
          </Button>
        </div>

        <ScriptBlock label="Intro (30s max)" text={callScript.intro} icon="🎬" />
        <ScriptBlock label="Hook trigger" text={callScript.hook} icon="🎯" />

        <div className="space-y-2">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-500">
            Questions ouvertes ({callScript.questions.length})
          </div>
          <ol className="space-y-2">
            {callScript.questions.map((q, idx) => (
              <li
                key={idx}
                className="flex gap-3 rounded-md border border-ink-100 bg-white p-3"
              >
                <span className="font-mono text-[11px] font-semibold text-brand-600">
                  Q{idx + 1}
                </span>
                <span className="text-[13px] leading-relaxed text-ink-800">{q}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="space-y-2">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-500">
            Traitement des objections ({callScript.objectionHandling.length})
          </div>
          <ul className="space-y-2">
            {callScript.objectionHandling.map((o, idx) => (
              <li
                key={idx}
                className="rounded-md border border-amber-200 bg-amber-50/50 p-3"
              >
                <div className="text-[12.5px] font-medium text-amber-900">⚠️ {o.obj}</div>
                <div className="mt-1 text-[12.5px] leading-relaxed text-ink-700">
                  ↳ {o.response}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-emerald-700">
            Close
          </div>
          <div className="mt-0.5 text-[13.5px] font-medium text-ink-900">
            {callScript.close}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ScriptBlock({ label, text, icon }: { label: string; text: string; icon: string }) {
  return (
    <div className="rounded-md border border-ink-100 bg-white p-3">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-500">
        {icon} {label}
      </div>
      <div className="mt-1 text-[13px] leading-relaxed text-ink-800 whitespace-pre-wrap">
        {text}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tab : Warm Mail (post-LinkedIn) — chantier D2 (01/05/2026)
// ──────────────────────────────────────────────────────────────────────

function WarmMailTab({
  warmMail,
  warmMailGeneratedAt,
  leadEmail,
  onGenerate,
  generating,
  leadId,
}: {
  warmMail: { subject: string; body: string } | null;
  warmMailGeneratedAt: string | null;
  leadEmail: string | null;
  onGenerate: () => void;
  generating: boolean;
  leadId: string;
}) {
  // Pas encore généré → CTA pour appeler /api/leads/[id]/copy (4 contextes en 1 appel)
  if (!warmMail) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-purple-100 to-pink-100">
            <Sparkles className="h-5 w-5 text-purple-600" />
          </div>
          <div className="space-y-1">
            <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink-900">
              Mail post-LinkedIn pas encore généré
            </h3>
            <p className="max-w-md text-[13px] text-ink-600">
              Le warm mail référence votre échange LinkedIn préalable (ton plus
              direct, plus court). Génère aussi le cold mail, DM LinkedIn et
              brief call optimisés en 1 seul appel Opus.
            </p>
          </div>
          <Button
            variant="primary"
            size="md"
            onClick={onGenerate}
            disabled={generating}
            className="gap-2"
          >
            {generating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Génération en cours (~30s)...
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Générer copy 4 contextes
              </>
            )}
          </Button>
          <div className="text-[11px] text-ink-400">
            ~$0.19 par lead · 1 appel Opus 4.7 · cache 7 jours
          </div>
        </CardContent>
      </Card>
    );
  }

  const fullEmail = `Sujet : ${warmMail.subject}\n\n${warmMail.body}`;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="space-y-0.5">
            <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink-900">
              Warm mail (post-LinkedIn)
            </h3>
            <p className="text-[11.5px] text-ink-500">
              ⚠️ À utiliser uniquement APRÈS un échange LinkedIn préalable (like, réponse, visite profil)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                copyToClipboard(warmMail.subject, "Sujet copié", { leadId, kind: "copy_email" })
              }
              className="gap-1.5"
            >
              <Copy className="h-3 w-3" />
              Sujet
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                copyToClipboard(warmMail.body, "Corps copié", { leadId, kind: "copy_email" })
              }
              className="gap-1.5"
            >
              <Copy className="h-3 w-3" />
              Corps
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                copyToClipboard(fullEmail, "Email complet copié", { leadId, kind: "copy_email" })
              }
              className="gap-1.5"
            >
              <Copy className="h-3 w-3" />
              Tout
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-500">
            Sujet ({warmMail.subject.length} caractères)
          </div>
          <div className="rounded-md border border-purple-200 bg-purple-50/30 p-3 font-mono text-[12.5px] text-ink-900 shadow-xs">
            {warmMail.subject}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-500">
            Corps ({warmMail.body.length} caractères) — plus court que cold mail (référence implicite à l'échange LI)
          </div>
          <div className="rounded-md border border-purple-200 bg-purple-50/30 p-4 text-[13px] leading-relaxed text-ink-800 shadow-xs whitespace-pre-wrap">
            {warmMail.body}
          </div>
        </div>

        {leadEmail && (
          <div className="flex items-center justify-between rounded-md border border-ink-100 bg-ink-50/40 p-3">
            <div className="text-[11.5px] text-ink-600">
              Destinataire :{" "}
              <span className="font-mono font-medium text-ink-800">{leadEmail}</span>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={gmailComposeUrl({ to: leadEmail, subject: warmMail.subject, body: warmMail.body })}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-[12px] font-medium text-white shadow-sm hover:bg-purple-700 transition-colors"
              >
                <Mail className="h-3 w-3" />
                Ouvrir dans Gmail
              </a>
              <a
                href={`mailto:${leadEmail}?subject=${encodeURIComponent(warmMail.subject)}&body=${encodeURIComponent(warmMail.body)}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-white px-3 py-1.5 text-[12px] font-medium text-ink-700 shadow-xs hover:bg-ink-50 transition-colors"
              >
                <Mail className="h-3 w-3" />
                Mail système
              </a>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-ink-100 pt-3">
          <div className="text-[10.5px] text-ink-400">
            {warmMailGeneratedAt
              ? `Généré ${formatRelativeFr(warmMailGeneratedAt)} · Copy Engine v4.0`
              : "Cache"}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onGenerate}
            disabled={generating}
            className="gap-1.5"
          >
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Régénérer copy
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Lead Verdict Banner — chantier D9 (01/05/2026)
// Phrase humaine + action recommandée + flags warnings
// ──────────────────────────────────────────────────────────────────────

const VERDICT_STYLES: Record<VerdictResult["color"], { bg: string; border: string; text: string; icon: typeof CheckCircle2 }> = {
  success: { bg: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-900", icon: CheckCircle2 },
  info: { bg: "bg-brand-50", border: "border-brand-300", text: "text-brand-900", icon: Info },
  warning: { bg: "bg-amber-50", border: "border-amber-300", text: "text-amber-900", icon: AlertTriangle },
  danger: { bg: "bg-red-50", border: "border-red-300", text: "text-red-900", icon: XCircle },
  default: { bg: "bg-ink-50", border: "border-ink-200", text: "text-ink-700", icon: Clock },
};

const FLAG_LABELS: Record<string, string> = {
  societe_trop_grosse: "Société plus grosse que ta cible ICP",
  decideur_juridique_pas_hiring: "Le contact identifié est juridique (DG/Gérant) — pas le décideur opérationnel du recrutement",
  hors_icp_taille: "Taille hors cible",
  rgpd_opt_out: "Contact en opt-out RGPD",
  email_bounced: "Email cassé / boîte invalide",
  insolvency: "Procédure collective en cours",
};

function LeadVerdictBanner({ verdict }: { verdict: VerdictResult }) {
  const style = VERDICT_STYLES[verdict.color];
  const Icon = style.icon;
  return (
    <div className={cn("rounded-lg border-2 p-4 shadow-sm", style.bg, style.border)}>
      <div className="flex items-start gap-3">
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white shadow-xs", style.text)}>
          <Icon className="h-5 w-5" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className={cn("font-display text-[16px] font-semibold tracking-tight leading-tight", style.text)}>
            {verdict.label}
          </h2>
          <p className={cn("text-[12.5px] leading-relaxed", style.text, "opacity-80")}>
            <span className="font-medium">Pourquoi : </span>{verdict.reason}
          </p>
          <div className={cn("mt-2 rounded-md border bg-white/80 px-3 py-2 text-[13px] font-medium", style.border, style.text)}>
            <span className="text-[10.5px] uppercase tracking-wider opacity-60">À faire maintenant</span>
            <div className="mt-0.5">{verdict.action}</div>
          </div>
          {verdict.flags.length > 0 && (
            <ul className="mt-2 space-y-1">
              {verdict.flags.map((flag) => (
                <li key={flag} className={cn("flex items-start gap-1.5 text-[11.5px]", style.text, "opacity-80")}>
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                  <span>{FLAG_LABELS[flag] ?? flag}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Skeleton
// ──────────────────────────────────────────────────────────────────────

function BoardSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-5 w-20" />
      <Skeleton className="h-[200px] w-full rounded-xl" />
      <Skeleton className="h-[400px] w-full rounded-xl" />
    </div>
  );
}

