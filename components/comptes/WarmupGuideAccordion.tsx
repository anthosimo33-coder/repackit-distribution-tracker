"use client";

import { useState, type ReactNode } from "react";
import {
  ChevronDownIcon,
  ShieldAlertIcon,
  Music2Icon,
  CameraIcon,
  PlayIcon,
  CheckCircle2Icon,
  TriangleAlertIcon,
  RotateCcwIcon,
  BanIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { WARMUP_DURATION_BY_PLATFORM } from "@/lib/compte-status";

/**
 * Guide warmup intégré (TikTok / Instagram / YouTube), consultable inline sans
 * quitter le tracker. 7 sections repliables (repliées par défaut). Contenu en
 * data-arrays rendues en JSX structuré (pas de dangerouslySetInnerHTML) ;
 * accordéon maison (useState) plutôt qu'un composant shadcn absent du repo
 * (preset base-nova/base-ui n'inclut pas d'accordion). Les durées de chaque
 * plateforme dérivent de WARMUP_DURATION_BY_PLATFORM (source unique).
 */

// ─── Contenu (data) ────────────────────────────────────────────────────────
const COMMON_RULES = [
  "Un email dédié par compte — jamais d'alias « + », jamais d'email recyclé.",
  "App mobile native uniquement pendant tout le warmup et les 10 premiers posts (pas de desktop, pas d'émulateur).",
  "Pas de VPN. Géo-cohérence stricte : SIM, IP, langue et fuseau du même pays.",
  "Profil minimal les premiers jours (photo + handle cohérents) ; on étoffe la bio progressivement.",
  "Engagement exclusivement dans la niche cible dès J1 — jamais de contenu hors-niche.",
];

type SubBlock = { subtitle: string; items: string[] };

const TIKTOK_BLOCKS: SubBlock[] = [
  {
    subtitle: "Setup",
    items: [
      "Compte créé via l'app mobile, profil light (photo + @ cohérent).",
      "Aucune bio promotionnelle ni lien externe au démarrage.",
    ],
  },
  {
    subtitle: "Warmup quotidien (J1 → J7)",
    items: [
      "15-25 min/jour sur le FYP de la niche, watch-through complet des vidéos.",
      "10-20 likes ciblés, 2-4 abonnements pertinents, 1-3 commentaires courts et naturels.",
      "Monter en charge progressivement — pas de pic d'activité le 1er jour.",
    ],
  },
  {
    subtitle: "Premier post",
    items: ["J8 minimum — jamais avant que J7 soit révolu."],
  },
];

const INSTAGRAM_BLOCKS: SubBlock[] = [
  {
    subtitle: "Setup",
    items: [
      "Compte via l'app mobile, profil minimal, pas de lien en bio au départ.",
    ],
  },
  {
    subtitle: "Phase 1 — J1-3 (observation pure)",
    items: [
      "Consultation uniquement : scroll feed + reels de la niche.",
      "Aucune interaction (ni like, ni follow, ni commentaire).",
    ],
  },
  {
    subtitle: "Phase 2 — J4-10 (engagement léger)",
    items: [
      "Likes ciblés, quelques abonnements, stories visionnées.",
      "Premiers commentaires sobres et pertinents.",
    ],
  },
  {
    subtitle: "Phase 3 — J11-14 (activité normale)",
    items: [
      "Interactions régulières, enregistrements, DMs légers.",
      "Compléter le profil (bio, highlights).",
    ],
  },
  {
    subtitle: "Premier Reel",
    items: ["J14+."],
  },
];

const YOUTUBE_BLOCKS: SubBlock[] = [
  {
    subtitle: "Setup channel (J1)",
    items: [
      "Création de la chaîne : photo + bannière + description.",
      "Confirmer l'adresse email associée.",
    ],
  },
  {
    subtitle: "Warmup quotidien (J1 → J3)",
    items: [
      "Visionnage de Shorts de la niche, likes, abonnements pertinents.",
      "Quelques commentaires naturels.",
    ],
  },
  {
    subtitle: "Premier Short",
    items: ["J4."],
  },
];

const CLEAN_SIGNALS = [
  { plateforme: "TikTok", signal: "Vues du 1er post à 24h", cible: "> 200" },
  { plateforme: "Instagram", signal: "Reach du 1er Reel", cible: "> 150 comptes" },
  { plateforme: "YouTube", signal: "Impressions du 1er Short", cible: "> 100" },
];

const FAILED_SIGNALS = [
  "Vues bloquées à 0-50 sur plusieurs posts d'affilée.",
  "Les hashtags ne sortent jamais dans la recherche.",
  "Aucune impression « Pour toi » / FYP.",
  "Chute brutale de reach après 2-3 posts.",
];

const RESET_STEPS = [
  "Stopper toute publication pendant 72h.",
  "Vérifier la géo-cohérence : email, SIM, IP, fuseau.",
  "Reprendre un warmup léger 3-5 jours (consultation + engagement uniquement).",
  "Re-tester avec un post neutre, mesurer les vues à 24h.",
  "Toujours bloqué : repartir d'un compte neuf (nouvel email + appareil/réseau propres).",
];

const DONT_BLOCKS: SubBlock[] = [
  {
    subtitle: "Pendant le warmup",
    items: [
      "Pas de post, pas de lien en bio, pas de VPN.",
      "Pas de follow/unfollow massif.",
    ],
  },
  {
    subtitle: "Au lancement post-warmup",
    items: [
      "Pas de spam de hashtags.",
      "Pas de 3 posts le même jour.",
      "Pas de repost cross-plateforme à l'identique.",
    ],
  },
  {
    subtitle: "En continu",
    items: [
      "Pas de changement brusque d'appareil ou de réseau.",
      "Pas d'achat de followers, pas de DMs automatisés.",
    ],
  },
];

// ─── Primitives de rendu ─────────────────────────────────────────────────────
function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

function SubSections({ blocks }: { blocks: SubBlock[] }) {
  return (
    <div className="space-y-3">
      {blocks.map((b) => (
        <div key={b.subtitle} className="space-y-1">
          <p className="text-xs font-medium italic text-slate-500">
            {b.subtitle}
          </p>
          <Bullets items={b.items} />
        </div>
      ))}
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
          {icon}
        </span>
        <span className="flex-1 text-sm font-semibold text-slate-900">
          {title}
        </span>
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-slate-400 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="border-t border-slate-100 px-4 py-3 text-sm leading-relaxed text-slate-600">
          {children}
        </div>
      )}
    </div>
  );
}

export function WarmupGuideAccordion() {
  return (
    <div className="space-y-2">
      <Section
        icon={<ShieldAlertIcon className="size-4" />}
        title="Règles communes (les 3 plateformes)"
      >
        <Bullets items={COMMON_RULES} />
      </Section>

      <Section
        icon={<Music2Icon className="size-4" />}
        title={`TikTok — ${WARMUP_DURATION_BY_PLATFORM.TikTok} jours`}
      >
        <SubSections blocks={TIKTOK_BLOCKS} />
      </Section>

      <Section
        icon={<CameraIcon className="size-4" />}
        title={`Instagram — ${WARMUP_DURATION_BY_PLATFORM.Instagram} jours`}
      >
        <SubSections blocks={INSTAGRAM_BLOCKS} />
      </Section>

      <Section
        icon={<PlayIcon className="size-4" />}
        title={`YouTube Shorts — ${WARMUP_DURATION_BY_PLATFORM.YouTube} jours`}
      >
        <SubSections blocks={YOUTUBE_BLOCKS} />
      </Section>

      <Section
        icon={<CheckCircle2Icon className="size-4" />}
        title="Vérifications post-warmup"
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-xs font-medium italic text-slate-500">
              <CheckCircle2Icon className="size-3.5 text-emerald-500" />
              Signaux — compte clean
            </p>
            <div className="overflow-hidden rounded-md border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Plateforme</th>
                    <th className="px-3 py-1.5 font-medium">Signal</th>
                    <th className="px-3 py-1.5 font-medium">Cible</th>
                  </tr>
                </thead>
                <tbody>
                  {CLEAN_SIGNALS.map((s) => (
                    <tr key={s.plateforme} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 font-medium text-slate-700">
                        {s.plateforme}
                      </td>
                      <td className="px-3 py-1.5">{s.signal}</td>
                      <td className="px-3 py-1.5 font-mono text-slate-700">
                        {s.cible}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-xs font-medium italic text-slate-500">
              <TriangleAlertIcon className="size-3.5 text-rose-500" />
              Signaux — warmup raté ou shadowban
            </p>
            <Bullets items={FAILED_SIGNALS} />
          </div>
        </div>
      </Section>

      <Section
        icon={<RotateCcwIcon className="size-4" />}
        title="Si warmup raté — protocole reset"
      >
        <ol className="list-decimal space-y-1 pl-5">
          {RESET_STEPS.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </Section>

      <Section
        icon={<BanIcon className="size-4" />}
        title="Les trucs à PAS faire"
      >
        <SubSections blocks={DONT_BLOCKS} />
      </Section>
    </div>
  );
}
