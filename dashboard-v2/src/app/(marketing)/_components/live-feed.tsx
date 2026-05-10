import { Briefcase, Zap, Newspaper } from "lucide-react";
import { MOCK_FEED } from "./_data/mock-companies";

export function LiveFeed() {
  return (
    <div className="rounded-xl border border-ink-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 h-10 border-b border-ink-200 bg-ink-50">
        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-ink-700">Flux temps réel</span>
        </div>
        <span className="text-[10px] text-ink-500 font-mono">scan 24/7</span>
      </div>

      <div className="divide-y divide-ink-100">
        {MOCK_FEED.map((item) => {
          const isPepite = item.type === "pepite";
          const isNews = item.type === "news";
          return (
            <div key={item.company} className="flex items-center gap-3 px-4 py-3">
              <div className={`flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center ${isPepite ? "bg-brand-100 text-brand-700" : isNews ? "bg-ink-100 text-ink-600" : "bg-emerald-50 text-emerald-700"}`}>
                {isPepite ? <Zap className="h-3.5 w-3.5" /> : isNews ? <Newspaper className="h-3.5 w-3.5" /> : <Briefcase className="h-3.5 w-3.5" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-ink-900 truncate">{item.company}</span>
                  {isPepite && (
                    <span className="inline-flex items-center px-1.5 py-0 rounded bg-brand-600 text-white text-[9px] font-semibold uppercase tracking-wider">
                      Pépite
                    </span>
                  )}
                </div>
                <p className="text-xs text-ink-500 truncate">{item.signal}</p>
              </div>
              <div className="flex-shrink-0 text-right">
                <p className="text-[10px] text-ink-500">{item.time}</p>
                <p className="text-[9px] text-ink-400 font-mono mt-0.5">{item.source}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
