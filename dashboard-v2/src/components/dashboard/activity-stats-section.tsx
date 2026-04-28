"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Mail, Linkedin, Phone, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Range = "today" | "7d" | "30d";

const RANGES: { id: Range; label: string; days: number }[] = [
  { id: "today", label: "Aujourd'hui", days: 1 },
  { id: "7d", label: "7 jours", days: 7 },
  { id: "30d", label: "30 jours", days: 30 },
];

interface StatsResponse {
  range: { from: string; to: string };
  total: number;
  byType: Record<string, number>;
  byUser: Array<{
    userId: string | null;
    userName: string | null;
    count: number;
    byType: Record<string, number>;
  }>;
}

export function ActivityStatsSection({ activeClientId }: { activeClientId: string | null }) {
  const [range, setRange] = React.useState<Range>("7d");

  const days = RANGES.find((r) => r.id === range)!.days;
  const from = React.useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    if (days > 1) d.setDate(d.getDate() - (days - 1));
    return d.toISOString();
  }, [days]);

  const { data, isLoading } = useQuery<StatsResponse>({
    queryKey: ["activity-stats", activeClientId, range],
    queryFn: async () => {
      const params = new URLSearchParams({ from });
      if (activeClientId) params.set("clientId", activeClientId);
      const res = await fetch(`/api/activities/stats?${params.toString()}`);
      if (!res.ok) throw new Error("Erreur stats activité");
      return res.json();
    },
    enabled: !!activeClientId,
    refetchInterval: 30_000,
  });

  if (!activeClientId) return null;

  const byType = data?.byType ?? {};
  const emailSent = (byType.EMAIL_SENT ?? 0);
  const emailReply = (byType.EMAIL_REPLY ?? 0);
  const emailOpen = (byType.EMAIL_OPEN ?? 0);
  const linkedinSent = (byType.LINKEDIN_DM_SENT ?? 0);
  const calls = (byType.CALL_OUTBOUND ?? 0) + (byType.VOICEMAIL_LEFT ?? 0);
  const meetings = (byType.MEETING_BOOKED ?? 0);
  const replyRate = emailSent > 0 ? Math.round((emailReply / emailSent) * 100) : 0;

  return (
    <section>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-brand-600" />
            Activité commerciale
          </CardTitle>
          <div className="flex items-center gap-1 rounded-md border border-ink-200 bg-white p-0.5 text-[11.5px]">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className={cn(
                  "rounded px-2 py-1 transition-colors",
                  range === r.id
                    ? "bg-brand-600 text-white"
                    : "text-ink-600 hover:bg-ink-50",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          ) : (
            <>
              {/* Tuiles canaux */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Tile
                  icon={Mail}
                  label="Emails"
                  primary={`${emailSent} envoyés`}
                  detail={`${emailReply} replies (${replyRate}%) · ${emailOpen} opens`}
                  accent="brand"
                />
                <Tile
                  icon={Linkedin}
                  label="LinkedIn"
                  primary={`${linkedinSent} DM envoyés`}
                  detail={`${byType.LINKEDIN_DM_REPLY ?? 0} replies · ${byType.LINKEDIN_VIEW_PROFILE ?? 0} vues`}
                  accent="info"
                />
                <Tile
                  icon={Phone}
                  label="Appels"
                  primary={`${calls} actions`}
                  detail={`${byType.CALL_OUTBOUND ?? 0} appels · ${byType.VOICEMAIL_LEFT ?? 0} voicemails`}
                  accent="warning"
                />
                <Tile
                  icon={Calendar}
                  label="RDV"
                  primary={`${meetings} bookés`}
                  detail={`${byType.MEETING_HELD ?? 0} tenus · ${byType.MEETING_NO_SHOW ?? 0} no-shows`}
                  accent="success"
                />
              </div>

              {/* Par commercial */}
              {data?.byUser && data.byUser.length > 0 && (
                <div className="border-t border-ink-100 pt-3">
                  <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-500">
                    Par commercial
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {data.byUser.map((u) => (
                      <div
                        key={u.userId ?? "_bot"}
                        className="flex items-center justify-between rounded-md border border-ink-100 bg-ink-50/40 px-3 py-2 text-[12px]"
                      >
                        <span className="font-medium text-ink-900">
                          {u.userName ?? (u.userId ? "—" : "Bot / système")}
                        </span>
                        <div className="flex items-center gap-3 font-mono text-[11.5px] text-ink-600">
                          <span>📧 {u.byType.EMAIL_SENT ?? 0}</span>
                          <span>💼 {u.byType.LINKEDIN_DM_SENT ?? 0}</span>
                          <span>📞 {u.byType.CALL_OUTBOUND ?? 0}</span>
                          <span>📅 {u.byType.MEETING_BOOKED ?? 0}</span>
                          <span className="text-ink-900 font-semibold">{u.count}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function Tile({
  icon: Icon,
  label,
  primary,
  detail,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  primary: string;
  detail: string;
  accent: "brand" | "info" | "warning" | "success";
}) {
  const accentBg = {
    brand: "bg-brand-50 text-brand-600",
    info: "bg-cyan-50 text-cyan-600",
    warning: "bg-amber-50 text-amber-600",
    success: "bg-emerald-50 text-emerald-600",
  }[accent];
  return (
    <div className="rounded-md border border-ink-100 bg-white px-3 py-2.5">
      <div className="flex items-center gap-2">
        <div className={cn("flex h-7 w-7 items-center justify-center rounded-md", accentBg)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-500">
          {label}
        </span>
      </div>
      <div className="mt-1.5 text-[15px] font-semibold text-ink-900">{primary}</div>
      <div className="text-[11px] text-ink-500">{detail}</div>
    </div>
  );
}
