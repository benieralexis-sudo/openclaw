import { Brain, MessageSquare, Target, TrendingUp, MapPin, Building2, Users } from "lucide-react";
import { MOCK_BRIEF } from "./_data/mock-companies";

export function BriefMockup() {
  const brief = MOCK_BRIEF;
  return (
    <div className="rounded-2xl border border-ink-200 bg-white shadow-lg overflow-hidden">
      {/* Header gradient brand */}
      <div className="relative bg-gradient-to-br from-brand-700 to-brand-900 text-white px-5 py-4">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl pointer-events-none" />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-white/15 backdrop-blur-sm border border-white/20 flex items-center justify-center">
              <Brain className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.15em] font-semibold text-brand-200">Brief Opus 4.7</p>
              <p className="text-sm font-semibold leading-tight">{brief.company}</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/15 backdrop-blur-sm border border-white/20 text-[11px] font-semibold text-white">
            Pépite · 9/10
          </span>
        </div>
      </div>

      {/* Meta company */}
      <div className="px-5 py-3 bg-ink-50/60 border-b border-ink-100 flex items-center gap-3 text-[11px] text-ink-600 flex-wrap">
        <span className="font-mono text-ink-500">SIRET {brief.siret}</span>
        <span className="text-ink-300">·</span>
        <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{brief.location}</span>
        <span className="text-ink-300">·</span>
        <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{brief.size}</span>
        <span className="text-ink-300">·</span>
        <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{brief.industry}</span>
      </div>

      <div className="p-6 space-y-5">
        <Section icon={<Target className="h-3.5 w-3.5" />} title="Contexte">
          <p>{brief.contextLine1}</p>
          <p className="mt-1.5">
            <strong className="text-ink-900">{brief.contextLine2Bold}</strong>{brief.contextLine2Suffix}
          </p>
        </Section>

        <Section icon={<TrendingUp className="h-3.5 w-3.5" />} title="Signal d'achat">
          <p>{brief.signalLine}</p>
          <p className="mt-1.5 text-ink-900 font-medium">{brief.signalEmphasis}</p>
        </Section>

        <Section icon={<MessageSquare className="h-3.5 w-3.5" />} title="Pitch suggéré">
          <div className="bg-brand-50/60 rounded-md p-3.5 border border-brand-100 italic text-ink-700 text-sm leading-relaxed">
            « {brief.pitch} »
          </div>
        </Section>

        <div className="grid grid-cols-3 gap-3 pt-4 border-t border-ink-100">
          <Stat value="92%" label="Match ICP" />
          <Stat value="9/10" label="Score Opus" highlight />
          <Stat value="2 h" label="Détecté" />
        </div>
      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-5 h-5 rounded bg-brand-50 text-brand-700 border border-brand-100 flex items-center justify-center">{icon}</div>
        <p className="text-[10px] font-semibold text-ink-500 uppercase tracking-[0.15em]">{title}</p>
      </div>
      <div className="text-sm text-ink-700 leading-relaxed pl-7">{children}</div>
    </div>
  );
}

function Stat({ value, label, highlight }: { value: string; label: string; highlight?: boolean }) {
  return (
    <div>
      <div className={`font-display text-lg font-semibold tabular-nums ${highlight ? "bg-gradient-to-br from-brand-700 to-brand-900 bg-clip-text text-transparent" : "text-ink-900"}`}>
        {value}
      </div>
      <div className="text-[10px] text-ink-500 uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}
