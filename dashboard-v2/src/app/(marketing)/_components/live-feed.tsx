"use client";

import { motion } from "motion/react";
import { Sparkles, Briefcase, Zap, Newspaper } from "lucide-react";
import { MOCK_FEED } from "./_data/mock-companies";

const ITEMS = MOCK_FEED;

export function LiveFeed() {
  return (
    <div className="relative rounded-2xl bg-ink-950 border border-ink-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-ink-800 bg-ink-900/50">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-xs font-bold text-white uppercase tracking-wider">Live feed</span>
          <span className="text-xs text-ink-500">— Pépites & qualifs détectées en temps réel</span>
        </div>
        <span className="text-[10px] text-ink-500 font-mono">{new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
      </div>

      {/* Feed */}
      <div className="p-3 space-y-1.5 max-h-[420px] overflow-hidden">
        {ITEMS.map((item, i) => {
          const isPepite = item.type === "pepite";
          const isNews = item.type === "news";
          return (
            <motion.div
              key={item.company}
              initial={{ opacity: 1, x: 0 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${isPepite ? "bg-gradient-to-r from-amber-500/10 to-transparent border-amber-500/30" : "bg-ink-900/50 border-ink-800"}`}
            >
              <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${isPepite ? "bg-gradient-to-br from-amber-400 to-amber-600 shadow-md shadow-amber-500/30" : isNews ? "bg-ink-800" : "bg-brand-600/20"}`}>
                {isPepite ? <Zap className="h-3.5 w-3.5 text-white" /> : isNews ? <Newspaper className="h-3.5 w-3.5 text-ink-400" /> : <Briefcase className="h-3.5 w-3.5 text-brand-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-sm font-bold ${isPepite ? "text-white" : "text-ink-200"}`}>{item.company}</span>
                  {isPepite && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-400/20 text-amber-300 text-[9px] font-bold">
                      <Sparkles className="h-2 w-2" />
                      PÉPITE
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-ink-400 truncate">{item.signal}</p>
              </div>
              <div className="flex-shrink-0 text-right">
                <p className="text-[10px] text-ink-500">{item.time}</p>
                <p className="text-[9px] text-ink-600 font-mono">{item.source}</p>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Bottom gradient fade */}
      <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-ink-950 to-transparent pointer-events-none" />
    </div>
  );
}
