"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  XCircle,
  HelpCircle,
  Copy,
  Check,
  AlertTriangle,
  Sparkles,
  Database,
  ChevronRight,
} from "lucide-react";
import {
  isLeadBriefV2,
  type LeadBriefV2,
  type Risk,
  type SourceRef,
} from "@/lib/lead-brief-v2";

/**
 * Sprint D.4 (07/05/2026) — Vue brief raisonné LeadBriefV2.
 *
 * Render markdown-style d'un LeadBriefV2 issu du judge V2 (qualifyTriggerV2).
 * S'affiche dans le TriggerBriefBoard à côté du verdict v1 + tabs Copy Engine,
 * pour permettre à Fred de comparer side-by-side avant décision shadow vs
 * switch (Sprint D.5).
 *
 * Spécificités :
 *   - Verdict badge coloré (OUI vert, NON rouge, ENRICH ambre)
 *   - Confidence bar 0-100
 *   - Citations [src:#X] dans thesis/risks/opener rendues comme ancres
 *     cliquables vers la section sources (scroll smooth)
 *   - Risks groupés par sévérité (high → medium → low)
 *   - Opener avec bouton copy + comptage mots (cible D.3 ≤250)
 *   - Sources numérotées en bas, ancrables via id="src-N"
 *   - enrichmentNeeded affiché uniquement si verdict=ENRICH
 *
 * Le composant est purement visuel : pas de fetch, pas de mutation. Le
 * brief est passé en prop par le parent (TriggerBriefBoard).
 */

const VERDICT_STYLES: Record<
  LeadBriefV2["verdict"],
  {
    label: string;
    badgeBg: string;
    badgeText: string;
    badgeBorder: string;
    icon: typeof CheckCircle2;
    headline: string;
  }
> = {
  OUI: {
    label: "OUI",
    badgeBg: "bg-emerald-50",
    badgeText: "text-emerald-700",
    badgeBorder: "border-emerald-200",
    icon: CheckCircle2,
    headline: "À attaquer — feu vert commercial",
  },
  NON: {
    label: "NON",
    badgeBg: "bg-rose-50",
    badgeText: "text-rose-700",
    badgeBorder: "border-rose-200",
    icon: XCircle,
    headline: "Ne pas approcher — hors ICP ou red flag",
  },
  ENRICH: {
    label: "ENRICH",
    badgeBg: "bg-amber-50",
    badgeText: "text-amber-700",
    badgeBorder: "border-amber-200",
    icon: HelpCircle,
    headline: "À enrichir avant — donnée critique manquante",
  },
};

const SEVERITY_STYLES: Record<
  Risk["severity"],
  { dot: string; label: string; order: number }
> = {
  high: { dot: "bg-rose-500", label: "Élevé", order: 0 },
  medium: { dot: "bg-amber-500", label: "Moyen", order: 1 },
  low: { dot: "bg-ink-400", label: "Faible", order: 2 },
};

/**
 * Render texte avec citations [src:#X] transformées en ancres cliquables.
 * Réutilisé pour thesis, opener et risk.description.
 */
function renderTextWithCitations(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /\[src:#(\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const id = parseInt(m[1] ?? "0", 10);
    parts.push(
      <a
        key={`cite-${key++}`}
        href={`#src-${id}`}
        onClick={(e) => {
          e.preventDefault();
          const el = document.getElementById(`src-${id}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
        className="inline-flex items-center justify-center align-baseline rounded-full bg-ink-100 px-1.5 py-0 text-[10px] font-mono font-medium text-ink-700 hover:bg-ink-200 transition-colors mx-0.5 leading-tight"
        title={`Voir source #${id}`}
      >
        {id}
      </a>,
    );
    last = m.index + (m[0]?.length ?? 0);
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function CopyButton({ text, label = "Copier" }: { text: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5 h-8"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          toast.success("Copié", { description: `${label} dans le presse-papier` });
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.error("Copie impossible");
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copié" : label}
    </Button>
  );
}

export function LeadBriefV2View({ brief }: { brief: LeadBriefV2 }) {
  const v = VERDICT_STYLES[brief.verdict];
  const Icon = v.icon;
  const wordCount = brief.opener.trim().split(/\s+/).length;
  const overTarget = wordCount > 250;

  // Tri risks par sévérité (high → medium → low)
  const sortedRisks = [...brief.risks].sort(
    (a, b) => SEVERITY_STYLES[a.severity].order - SEVERITY_STYLES[b.severity].order,
  );

  return (
    <Card className="border-ink-200">
      <CardContent className="space-y-5 p-5">
        {/* En-tête : verdict + confidence */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                className={cn(
                  "border gap-1.5 text-[12px] font-semibold px-2.5 py-1",
                  v.badgeBg,
                  v.badgeText,
                  v.badgeBorder,
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
              </Badge>
              <span className="text-[11.5px] font-medium text-ink-600">
                {v.headline}
              </span>
              <Badge variant="outline" className="text-[10.5px] font-mono gap-1 px-1.5 py-0">
                <Sparkles className="h-3 w-3" />
                Judge V2 dormant (D.2)
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">
                Confidence
              </span>
              <div className="w-32 h-1.5 bg-ink-100 rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full transition-all",
                    brief.confidence >= 80
                      ? "bg-emerald-500"
                      : brief.confidence >= 50
                        ? "bg-amber-500"
                        : "bg-rose-400",
                  )}
                  style={{ width: `${Math.max(2, brief.confidence)}%` }}
                />
              </div>
              <span className="text-[12px] font-mono font-semibold text-ink-700 tabular-nums">
                {brief.confidence}/100
              </span>
            </div>
          </div>
        </div>

        {/* Thesis */}
        <section>
          <h4 className="text-[11px] uppercase tracking-wide text-ink-500 font-medium mb-1.5">
            Thèse
          </h4>
          <p className="text-[13px] leading-relaxed text-ink-800">
            {renderTextWithCitations(brief.thesis)}
          </p>
        </section>

        {/* Triggers */}
        <section>
          <h4 className="text-[11px] uppercase tracking-wide text-ink-500 font-medium mb-2">
            Signaux ({brief.triggers.length})
          </h4>
          <ul className="space-y-1.5">
            {brief.triggers.map((t, i) => (
              <li key={i} className="flex items-start gap-2 text-[12.5px]">
                <ChevronRight className="h-3.5 w-3.5 text-ink-400 mt-0.5 shrink-0" />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="font-mono text-[10.5px] bg-ink-100 px-1.5 py-0 rounded text-ink-700">
                      {t.source}
                    </code>
                    <span className="text-[10.5px] text-ink-500 tabular-nums">
                      {t.date}
                    </span>
                  </div>
                  <p className="text-ink-700 leading-snug">{t.relevance}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Risks */}
        <section>
          <h4 className="text-[11px] uppercase tracking-wide text-ink-500 font-medium mb-2 flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3" />
            Risques à anticiper ({brief.risks.length})
          </h4>
          <ul className="space-y-2">
            {sortedRisks.map((r, i) => {
              const sev = SEVERITY_STYLES[r.severity];
              return (
                <li
                  key={i}
                  className="flex items-start gap-2.5 text-[12.5px] rounded-md border border-ink-100 bg-ink-50/40 px-3 py-2"
                >
                  <span
                    className={cn("h-2 w-2 rounded-full mt-1.5 shrink-0", sev.dot)}
                    title={sev.label}
                  />
                  <div className="space-y-0.5 flex-1">
                    <div className="text-[10.5px] uppercase tracking-wide font-semibold text-ink-600">
                      {sev.label}
                    </div>
                    <p className="text-ink-800 leading-snug">
                      {renderTextWithCitations(r.description)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Opener */}
        <section>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h4 className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">
              Opener prêt-à-coller
            </h4>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-[10.5px] font-mono tabular-nums",
                  overTarget ? "text-rose-600 font-semibold" : "text-ink-500",
                )}
                title="Cible Sprint D.3 : ≤ 250 mots"
              >
                {wordCount} mots
              </span>
              <CopyButton text={brief.opener} label="Copier opener" />
            </div>
          </div>
          <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-800 bg-amber-50/60 border border-amber-200 rounded-md p-3.5">
            {renderTextWithCitations(brief.opener)}
          </pre>
        </section>

        {/* enrichmentNeeded — uniquement si verdict=ENRICH */}
        {brief.verdict === "ENRICH" && brief.enrichmentNeeded && brief.enrichmentNeeded.length > 0 && (
          <section>
            <h4 className="text-[11px] uppercase tracking-wide text-ink-500 font-medium mb-2 flex items-center gap-1.5">
              <Database className="h-3 w-3" />
              Données à enrichir
            </h4>
            <ul className="space-y-1">
              {brief.enrichmentNeeded.map((e, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-[12.5px] text-ink-700"
                >
                  <span className="text-amber-600 font-bold mt-0.5">→</span>
                  <span className="leading-snug">{e}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Sources */}
        <section>
          <h4 className="text-[11px] uppercase tracking-wide text-ink-500 font-medium mb-2">
            Sources ({brief.sources.length})
          </h4>
          <ol className="space-y-1.5">
            {brief.sources
              .slice()
              .sort((a, b) => a.id - b.id)
              .map((s) => (
                <li
                  key={s.id}
                  id={`src-${s.id}`}
                  className="flex items-start gap-2 text-[11.5px] scroll-mt-24"
                >
                  <span className="inline-flex items-center justify-center rounded-full bg-ink-100 text-ink-700 font-mono font-semibold w-5 h-5 text-[10px] shrink-0 tabular-nums">
                    {s.id}
                  </span>
                  <div className="space-y-0.5">
                    <code className="font-mono text-[10.5px] bg-ink-50 px-1.5 py-0 rounded text-ink-600">
                      {s.type}
                    </code>
                    <p className="text-ink-700 leading-snug">{s.ref}</p>
                  </div>
                </li>
              ))}
          </ol>
        </section>
      </CardContent>
    </Card>
  );
}

/**
 * Wrapper safe : prend une valeur unknown (typiquement Trigger.briefV2Json
 * issu de Prisma JSON), valide via Zod, et render LeadBriefV2View ou un
 * placeholder si invalide/null.
 */
export function LeadBriefV2ViewSafe({
  raw,
}: {
  raw: unknown | null | undefined;
}) {
  if (!raw) {
    return (
      <Card className="border-dashed border-ink-200 bg-ink-50/30">
        <CardContent className="p-5 flex items-center gap-3 text-[12.5px] text-ink-500">
          <Sparkles className="h-4 w-4 text-ink-400" />
          <div className="space-y-0.5">
            <div className="font-medium text-ink-700">Brief V2 pas encore généré</div>
            <div className="text-[11.5px]">
              Le judge V2 (Sprint D.2) est dormant en prod. Les briefs V2 ne sont
              générés que via le backfill manuel ou les pipelines de test. Visible
              uniquement sur les triggers DTL backfillés Sprint D.6.
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }
  if (!isLeadBriefV2(raw)) {
    return (
      <Card className="border-rose-200 bg-rose-50/30">
        <CardContent className="p-5 flex items-center gap-3 text-[12.5px] text-rose-700">
          <AlertTriangle className="h-4 w-4" />
          <div className="space-y-0.5">
            <div className="font-medium">Brief V2 invalide (Zod)</div>
            <div className="text-[11.5px]">
              Le briefV2Json en DB ne respecte pas le schéma LeadBriefV2. À ré-exécuter
              ou corriger.
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }
  return <LeadBriefV2View brief={raw} />;
}

// Re-export pour faciliter l'import depuis trigger-brief-board.tsx
export type { SourceRef };
