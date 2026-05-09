"use client";

import { motion } from "motion/react";

const SOURCES = [
  { name: "BODACC", desc: "Annonces commerciales" },
  { name: "INPI", desc: "Dépôts marques" },
  { name: "Pappers", desc: "SIRENE complet" },
  { name: "France Travail", desc: "Offres tech" },
  { name: "LinkedIn Jobs", desc: "Recrutement live" },
  { name: "Welcome to the Jungle", desc: "Recrutement startups" },
  { name: "JOAFE", desc: "Associations" },
  { name: "Presse Tech FR", desc: "Levées de fonds" },
  { name: "RSS spécialisés", desc: "News sectoriels" },
  { name: "Intent Data B2B", desc: "Signaux d'achat" },
  { name: "Tech Stack Discovery", desc: "Outils installés" },
];

export function SourcesMarquee() {
  return (
    <div className="relative overflow-hidden bg-ink-900 py-10 border-y border-ink-800">
      <div className="text-center mb-8">
        <p className="text-xs uppercase tracking-[0.2em] text-ink-500 font-semibold">
          Détecte les triggers depuis ces 11 sources françaises
        </p>
      </div>
      <div className="relative">
        {/* Fade edges */}
        <div className="absolute left-0 top-0 bottom-0 w-32 bg-gradient-to-r from-ink-900 to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-ink-900 to-transparent z-10 pointer-events-none" />

        <motion.div
          className="flex gap-12"
          animate={{ x: [0, -1500] }}
          transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
        >
          {[...SOURCES, ...SOURCES, ...SOURCES].map((s, i) => (
            <div key={i} className="flex-shrink-0 px-6 py-3 rounded-xl bg-ink-800/50 border border-ink-700 backdrop-blur-sm">
              <p className="font-display text-lg font-bold text-white whitespace-nowrap">{s.name}</p>
              <p className="text-[11px] text-ink-400 whitespace-nowrap">{s.desc}</p>
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
