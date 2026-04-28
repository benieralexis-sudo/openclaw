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
import { cn, formatNumberFr, formatRelativeFr } from "@/lib/utils";
import { SendEmailModal } from "@/components/lead/send-email-modal";
import { EnrichKasprModal } from "@/components/lead/enrich-kaspr-modal";
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
  } | null;
  client: {
    id: string;
    slug: string;
    name: string;
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

function copyToClipboard(text: string, label = "Copié dans le presse-papiers") {
  navigator.clipboard.writeText(text);
  toast.success(label);
}

// ──────────────────────────────────────────────────────────────────────
// Board principal
// ──────────────────────────────────────────────────────────────────────

export function TriggerBriefBoard({ triggerId }: { triggerId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [sendOpen, setSendOpen] = React.useState(false);
  const [enrichOpen, setEnrichOpen] = React.useState(false);

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

  if (isLoading || !data) return <BoardSkeleton />;

  const { trigger, lead, opportunity } = data;
  const brief = lead?.briefJson ?? null;
  const hasBrief = !!brief;

  return (
    <div className="space-y-5">
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
            <Button
              variant="secondary"
              size="md"
              onClick={() => setEnrichOpen(true)}
              className="gap-1.5"
              title="Enrichir via Kaspr (email pro + tel + titre)"
            >
              <Database className="h-3.5 w-3.5 text-cyan-600" />
              Enrichir Kaspr
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => setSendOpen(true)}
              disabled={!lead.email}
              className="gap-1.5"
              title={lead.email ?? "Pas d'email destinataire enrichi"}
            >
              <Send className="h-3.5 w-3.5" />
              Envoyer email
            </Button>
          </div>
        )}
      </div>

      <TriggerHeader trigger={trigger} lead={lead} opportunity={opportunity} />

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
          <EnrichKasprModal
            open={enrichOpen}
            onOpenChange={setEnrichOpen}
            lead={{
              id: lead.id,
              fullName: lead.fullName,
              firstName: lead.firstName ?? null,
              lastName: lead.lastName ?? null,
              linkedinUrl: lead.linkedinUrl,
              kasprEnrichedAt: lead.kasprEnrichedAt ?? null,
            }}
          />
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Header trigger + lead + opportunity
// ──────────────────────────────────────────────────────────────────────

function TriggerHeader({
  trigger,
  lead,
  opportunity,
}: {
  trigger: TriggerData["trigger"];
  lead: TriggerData["lead"];
  opportunity: TriggerData["opportunity"];
}) {
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
              <Badge variant={scoreVariant} size="md" className="font-mono tabular-nums">
                {trigger.score}/10
              </Badge>
              {trigger.isHot && (
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
            <p className="mt-1 text-[12.5px] text-ink-600">
              {[trigger.industry, trigger.region, trigger.size].filter(Boolean).join(" · ") ||
                "—"}
              {trigger.companySiret && (
                <span className="ml-2 font-mono text-[10.5px] text-ink-400">
                  SIRET {trigger.companySiret.slice(0, 9)}…
                </span>
              )}
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10.5px] uppercase tracking-wider text-ink-400">Détecté</div>
            <div className="font-mono text-[12.5px] tabular-nums text-ink-700">
              {formatRelativeFr(trigger.capturedAt)}
            </div>
          </div>
        </div>

        <div className="rounded-md border border-brand-200 bg-brand-50/40 p-3">
          <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-brand-700">
            <Target className="h-3 w-3" />
            Signal détecté
          </div>
          <div className="mt-0.5 text-[13.5px] font-medium text-ink-900">{trigger.title}</div>
          {trigger.detail && (
            <div className="mt-0.5 text-[12px] leading-relaxed text-ink-600">
              {trigger.detail}
            </div>
          )}
        </div>

        {/* Contact + Opportunité */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {lead && (
            <div className="rounded-md border border-ink-100 bg-white p-3">
              <div className="text-[10.5px] uppercase tracking-wider text-ink-500">
                Contact
              </div>
              <div className="mt-1 text-[13px] font-medium text-ink-900">
                {lead.fullName ?? "À identifier"}
              </div>
              <div className="text-[11.5px] text-ink-600">{lead.jobTitle ?? "—"}</div>
              {lead.email && (
                <a
                  href={`mailto:${lead.email}`}
                  className="mt-1 flex items-center gap-1 font-mono text-[11px] text-brand-700 hover:underline"
                >
                  <Mail className="h-3 w-3" />
                  {lead.email}
                </a>
              )}
              {lead.linkedinUrl && (
                <a
                  href={lead.linkedinUrl}
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
                    <a
                      href={`mailto:${lead.kasprWorkEmail}`}
                      className="flex items-center gap-1 font-mono text-[11px] text-brand-700 hover:underline"
                    >
                      <Mail className="h-3 w-3" />
                      {lead.kasprWorkEmail}
                      <Badge variant="success" size="sm" className="ml-1">Pro</Badge>
                    </a>
                  )}
                  {lead.kasprPersonalEmail && lead.kasprPersonalEmail !== lead.email && (
                    <a
                      href={`mailto:${lead.kasprPersonalEmail}`}
                      className="flex items-center gap-1 font-mono text-[11px] text-brand-700 hover:underline"
                    >
                      <Mail className="h-3 w-3" />
                      {lead.kasprPersonalEmail}
                      <Badge variant="warning" size="sm" className="ml-1">Perso</Badge>
                    </a>
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
                {lead.companyRevenue !== null && lead.companyRevenue !== undefined && (
                  <div className="flex items-center justify-between text-[11.5px]">
                    <span className="text-ink-600">CA dernier exercice</span>
                    <span className="font-mono font-semibold text-ink-900">
                      {(lead.companyRevenue / 1_000_000).toFixed(1)} M€
                    </span>
                  </div>
                )}
                {lead.companyResultNet !== null && lead.companyResultNet !== undefined && (
                  <div className="flex items-center justify-between text-[11.5px]">
                    <span className="text-ink-600">Résultat net</span>
                    <span className={`font-mono font-semibold ${lead.companyResultNet >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                      {lead.companyResultNet >= 0 ? "+" : ""}{(lead.companyResultNet / 1_000_000).toFixed(2)} M€
                    </span>
                  </div>
                )}
                {lead.companyEtabsCount !== null && lead.companyEtabsCount !== undefined && lead.companyEtabsCount > 1 && (
                  <div className="flex items-center justify-between text-[11.5px]">
                    <span className="text-ink-600">Établissements actifs</span>
                    <span className="font-mono text-ink-900">
                      {lead.companyEtabsCount} sites
                      <Badge variant="info" size="sm" className="ml-1">Multi-sites</Badge>
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
        </div>
      </CardContent>
    </Card>
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
}: {
  brief: Brief;
  generatedAt: string | null;
  onRegenerate: () => void;
  regenerating: boolean;
  leadEmail: string | null;
  leadLinkedin: string | null;
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
          <TabsTrigger value="call" className="gap-1.5">
            <PhoneCall className="h-3.5 w-3.5" />
            Script call
          </TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <SummaryTab summary={brief.summary} />
        </TabsContent>
        <TabsContent value="email">
          <EmailTab email={brief.email} leadEmail={leadEmail} />
        </TabsContent>
        <TabsContent value="linkedin">
          <LinkedinTab linkedin={brief.linkedin} leadLinkedin={leadLinkedin} />
        </TabsContent>
        <TabsContent value="call">
          <CallTab callScript={brief.callScript} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tab : Brief stratégique
// ──────────────────────────────────────────────────────────────────────

function SummaryTab({ summary }: { summary: Brief["summary"] }) {
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
            onClick={() => copyToClipboard(allText, "Brief copié")}
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
}: {
  email: Brief["email"];
  leadEmail: string | null;
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
              onClick={() => copyToClipboard(email.subject, "Sujet copié")}
              className="gap-1.5"
            >
              <Copy className="h-3 w-3" />
              Sujet
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyToClipboard(email.body, "Corps copié")}
              className="gap-1.5"
            >
              <Copy className="h-3 w-3" />
              Corps
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => copyToClipboard(fullEmail, "Email complet copié")}
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
            <a
              href={`mailto:${leadEmail}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-[12px] font-medium text-white shadow-sm hover:bg-brand-700 transition-colors"
            >
              <Mail className="h-3 w-3" />
              Ouvrir dans Mail
            </a>
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
}: {
  linkedin: Brief["linkedin"];
  leadLinkedin: string | null;
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
        />

        <MessageBlock
          label={`Follow-up à J+3 (${linkedin.followup.length} caractères)`}
          warning={false}
          text={linkedin.followup}
          copyLabel="Follow-up copié"
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
}: {
  label: string;
  warning: boolean;
  text: string;
  copyLabel: string;
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
          onClick={() => copyToClipboard(text, copyLabel)}
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

function CallTab({ callScript }: { callScript: Brief["callScript"] }) {
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
            onClick={() => copyToClipboard(allText, "Script copié")}
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

