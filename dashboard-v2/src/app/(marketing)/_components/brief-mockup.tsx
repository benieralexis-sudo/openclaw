import { Brain, MessageSquare, Target, TrendingUp } from "lucide-react";
import { MOCK_BRIEF } from "./_data/mock-companies";

export function BriefMockup() {
  const brief = MOCK_BRIEF;
  return (
    <div className="rounded-xl border border-ink-200 bg-white shadow-sm overflow-hidden">
      {/* Header sobre */}
      <div className="flex items-center justify-between px-5 h-12 border-b border-ink-200 bg-ink-50">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-brand-600" />
          <p className="text-[11px] font-medium uppercase tracking-wider text-ink-700">Brief Opus 4.7</p>
        </div>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-brand-600 text-white text-[10px] font-semibold uppercase tracking-wider">
          Pépite · 9/10
        </span>
      </div>

      <div className="p-6 space-y-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500 mb-2">Société</p>
          <p className="text-sm font-display font-semibold text-ink-900">{brief.company}</p>
          <p className="text-xs text-ink-500 mt-0.5">SIRET {brief.siret} · {brief.location} · {brief.size}</p>
        </div>

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
          <div className="bg-ink-50 rounded-md p-3 border border-ink-200 italic text-ink-700 text-sm leading-relaxed">
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
        <div className="text-ink-500">{icon}</div>
        <p className="text-[10px] font-semibold text-ink-500 uppercase tracking-wider">{title}</p>
      </div>
      <div className="text-sm text-ink-700 leading-relaxed">{children}</div>
    </div>
  );
}

function Stat({ value, label, highlight }: { value: string; label: string; highlight?: boolean }) {
  return (
    <div>
      <div className={`font-display text-lg font-semibold tabular-nums ${highlight ? "text-brand-700" : "text-ink-900"}`}>{value}</div>
      <div className="text-[10px] text-ink-500 uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}
