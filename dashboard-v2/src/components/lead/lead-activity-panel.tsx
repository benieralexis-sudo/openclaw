"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Circle,
  Clock,
  Mail,
  Linkedin,
  Phone,
  Voicemail,
  Calendar,
  StickyNote,
  Loader2,
  Plus,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { cn, formatRelativeFr } from "@/lib/utils";

interface ActivityCounts {
  EMAIL_SENT?: number;
  EMAIL_REPLY?: number;
  EMAIL_OPEN?: number;
  EMAIL_CLICK?: number;
  EMAIL_BOUNCE?: number;
  LINKEDIN_DM_SENT?: number;
  LINKEDIN_DM_REPLY?: number;
  LINKEDIN_VIEW_PROFILE?: number;
  LINKEDIN_CONNECT?: number;
  CALL_OUTBOUND?: number;
  CALL_INBOUND?: number;
  VOICEMAIL_LEFT?: number;
  MEETING_BOOKED?: number;
  MEETING_HELD?: number;
  MEETING_NO_SHOW?: number;
  NOTE?: number;
}

interface TimelineEntry {
  id: string;
  type: string;
  source: string;
  direction: string;
  occurredAt: string;
  payload: Record<string, unknown> | null;
  user: { id: string; name: string | null; email: string } | null;
}

const TYPE_LABEL: Record<string, string> = {
  EMAIL_SENT: "Email envoyé",
  EMAIL_REPLY: "Reply email",
  EMAIL_OPEN: "Email ouvert",
  EMAIL_CLICK: "Lien cliqué",
  EMAIL_BOUNCE: "Email bounce",
  LINKEDIN_DM_SENT: "LinkedIn DM",
  LINKEDIN_DM_REPLY: "LinkedIn reply",
  LINKEDIN_VIEW_PROFILE: "Vue profil",
  LINKEDIN_CONNECT: "Connect LinkedIn",
  CALL_OUTBOUND: "Appel sortant",
  CALL_INBOUND: "Appel entrant",
  VOICEMAIL_LEFT: "Voicemail laissé",
  MEETING_BOOKED: "RDV booké",
  MEETING_HELD: "RDV tenu",
  MEETING_NO_SHOW: "RDV no-show",
  NOTE: "Note",
};

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  EMAIL_SENT: Mail,
  EMAIL_REPLY: Mail,
  EMAIL_OPEN: Mail,
  EMAIL_CLICK: Mail,
  EMAIL_BOUNCE: Mail,
  LINKEDIN_DM_SENT: Linkedin,
  LINKEDIN_DM_REPLY: Linkedin,
  LINKEDIN_VIEW_PROFILE: Linkedin,
  LINKEDIN_CONNECT: Linkedin,
  CALL_OUTBOUND: Phone,
  CALL_INBOUND: Phone,
  VOICEMAIL_LEFT: Voicemail,
  MEETING_BOOKED: Calendar,
  MEETING_HELD: Calendar,
  MEETING_NO_SHOW: Calendar,
  NOTE: StickyNote,
};

interface ChecklistItem {
  type: keyof ActivityCounts;
  label: string;
  manual?: boolean; // si true, peut être loggué manuellement par bouton
}

const CHECKLIST: ChecklistItem[] = [
  { type: "EMAIL_SENT", label: "Email envoyé", manual: true },
  { type: "EMAIL_OPEN", label: "Email ouvert" },
  { type: "EMAIL_REPLY", label: "Reply reçue" },
  { type: "LINKEDIN_DM_SENT", label: "LinkedIn DM envoyé", manual: true },
  { type: "CALL_OUTBOUND", label: "1er appel passé", manual: true },
  { type: "VOICEMAIL_LEFT", label: "Voicemail laissé", manual: true },
  { type: "MEETING_BOOKED", label: "RDV booké" },
];

export function LeadActivityPanel({ leadId }: { leadId: string }) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{
    counts: ActivityCounts;
    timeline: TimelineEntry[];
  }>({
    queryKey: ["lead-activities", leadId],
    queryFn: async () => {
      const res = await fetch(`/api/leads/${leadId}/activities`);
      if (!res.ok) throw new Error("Failed to fetch activities");
      return res.json();
    },
    refetchInterval: 10_000, // 10s — temps réel
  });

  const logManual = useMutation({
    mutationFn: async (args: { type: string; note?: string }) => {
      const res = await fetch(`/api/leads/${leadId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Erreur");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-activities", leadId] });
      toast.success("Action loggée");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
  });

  const counts = data?.counts ?? {};
  const timeline = data?.timeline ?? [];

  return (
    <Card className="border-ink-200 shadow-xs">
      <CardContent className="space-y-4 p-4">
        {/* Compteurs par canal */}
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-500">
            Activité
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
            <ChannelTile
              icon={Mail}
              label="Email"
              detail={`${counts.EMAIL_SENT ?? 0} envoyés · ${counts.EMAIL_REPLY ?? 0} replies · ${counts.EMAIL_OPEN ?? 0} opens · ${counts.EMAIL_CLICK ?? 0} clics`}
            />
            <ChannelTile
              icon={Linkedin}
              label="LinkedIn"
              detail={`${counts.LINKEDIN_DM_SENT ?? 0} DM · ${counts.LINKEDIN_DM_REPLY ?? 0} reply · ${counts.LINKEDIN_VIEW_PROFILE ?? 0} vues`}
            />
            <ChannelTile
              icon={Phone}
              label="Appels"
              detail={`${counts.CALL_OUTBOUND ?? 0} sortants · ${counts.VOICEMAIL_LEFT ?? 0} voicemails`}
            />
            <ChannelTile
              icon={Calendar}
              label="RDV"
              detail={`${counts.MEETING_BOOKED ?? 0} bookés · ${counts.MEETING_HELD ?? 0} tenus`}
            />
          </div>
        </div>

        {/* Checklist progression */}
        <div className="border-t border-ink-100 pt-3">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-500">
            Progression
          </div>
          <div className="mt-2 space-y-1.5">
            {CHECKLIST.map((item) => {
              const count = counts[item.type] ?? 0;
              const done = count > 0;
              return (
                <div
                  key={item.type}
                  className="flex items-center justify-between rounded-md px-1.5 py-1 text-[12px] hover:bg-ink-50"
                >
                  <div className="flex items-center gap-2">
                    {done ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Circle className="h-3.5 w-3.5 text-ink-300" />
                    )}
                    <span className={cn("text-ink-700", done && "text-ink-900")}>
                      {item.label}
                    </span>
                    {count > 1 && (
                      <Badge variant="info" size="sm">
                        ×{count}
                      </Badge>
                    )}
                  </div>
                  {item.manual && (
                    <button
                      type="button"
                      onClick={() => logManual.mutate({ type: item.type })}
                      disabled={logManual.isPending}
                      className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white px-1.5 py-0.5 text-[10.5px] font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50"
                      title="Logger cette action"
                    >
                      {logManual.isPending ? (
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      ) : (
                        <Plus className="h-2.5 w-2.5" />
                      )}
                      Logger
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Timeline reverse-chrono */}
        <div className="border-t border-ink-100 pt-3">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-500">
            Timeline
          </div>
          <div className="mt-2 space-y-1">
            {isLoading ? (
              <div className="flex items-center gap-2 text-[11.5px] text-ink-400">
                <Loader2 className="h-3 w-3 animate-spin" /> Chargement…
              </div>
            ) : timeline.length === 0 ? (
              <div className="text-[11.5px] italic text-ink-400">
                Aucune activité encore — la timeline se remplira dès le 1er
                envoi/appel/RDV.
              </div>
            ) : (
              timeline.map((entry) => {
                const Icon = TYPE_ICON[entry.type] ?? Clock;
                const label = TYPE_LABEL[entry.type] ?? entry.type;
                const subject =
                  (entry.payload as { subject?: string } | null)?.subject ?? null;
                const note = (entry.payload as { note?: string } | null)?.note ?? null;
                const userLabel = entry.user?.name ?? entry.user?.email ?? "Bot";
                return (
                  <div
                    key={entry.id}
                    className="flex items-start gap-2 rounded-md px-1.5 py-1 text-[12px]"
                  >
                    <Icon className="mt-0.5 h-3 w-3 flex-shrink-0 text-ink-400" />
                    <div className="flex-1">
                      <div className="flex flex-wrap items-baseline gap-1.5">
                        <span className="font-medium text-ink-900">{label}</span>
                        {subject && (
                          <span className="text-ink-600 truncate max-w-[260px]">
                            — {subject}
                          </span>
                        )}
                        <span className="text-[10.5px] text-ink-400">
                          · {formatRelativeFr(entry.occurredAt)}
                        </span>
                      </div>
                      <div className="text-[10.5px] text-ink-500">
                        par {userLabel}
                        {entry.source !== "MANUAL" && (
                          <span className="ml-1 text-ink-400">({entry.source.toLowerCase()})</span>
                        )}
                      </div>
                      {note && (
                        <div className="mt-0.5 text-[11px] italic text-ink-600">
                          “{note}”
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChannelTile({
  icon: Icon,
  label,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-ink-100 bg-ink-50/40 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-600">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-0.5 text-[11px] text-ink-700">{detail}</div>
    </div>
  );
}
