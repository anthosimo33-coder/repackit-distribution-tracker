"use client";

import { useState, type ReactNode } from "react";
import {
  ChevronDownIcon,
  ShieldAlertIcon,
  Music2Icon,
  CameraIcon,
  PlayIcon,
  CheckCircle2Icon,
  RotateCcwIcon,
  BanIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { WARMUP_DURATION_BY_PLATFORM } from "@/lib/compte-status";

/**
 * Guide warmup intégré (TikTok / Instagram / YouTube), consultable inline sans
 * quitter le tracker. 7 sections repliables (repliées par défaut). Contenu en
 * data-arrays (markdown léger : **gras** + `code`) rendues en JSX structuré via
 * renderInline (pas de dangerouslySetInnerHTML) ; accordéon maison (useState)
 * plutôt qu'un composant shadcn absent du repo (preset base-nova/base-ui n'a
 * pas d'accordion). Les durées des titres dérivent de WARMUP_DURATION_BY_PLATFORM
 * (source unique, alignée sur le décompte du tracker).
 */

// ─── Rendu inline markdown léger (**gras** + `code`) ─────────────────────────
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.7rem]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

// ─── Contenu (data) ──────────────────────────────────────────────────────────
const COMMON_RULES = [
  "**Email dédié par compte**, pas d'alias `+`",
  "**App mobile native uniquement** pendant warmup + 10 premiers posts (pas de web, pas d'API/scheduler)",
  "**Pas de VPN**, géo-cohérence stricte (device + SIM + IP même pays)",
  "**Profil minimal les premiers jours** : pas de bio commerciale, pas de lien externe agressif",
  "Engagement **exclusivement dans la niche cible** dès J1",
];

type SubBlock = { subtitle: string; items: string[] };

const TIKTOK_BLOCKS: SubBlock[] = [
  {
    subtitle: "Phase de chauffe (J1 → J7) — aucun post",
    items: [
      "**Recherches quotidiennes avec TES mots-clés** dans la barre de recherche",
      "20-30 min/jour de scroll FYP dans ta niche",
      "Watch time complet sur les vidéos de ta niche (pas de scroll rapide)",
      '10-20 likes/jour, 2-3 commentaires authentiques (pas "🔥")',
      "5-10 follows/jour max sur des comptes de ta niche",
      "Compléter bio + photo de profil pendant cette phase",
    ],
  },
  {
    subtitle: "Premier post — J8 (lendemain de la chauffe)",
    items: ["**Aucun post avant J8** : la chauffe dure 7 jours pleins"],
  },
  {
    subtitle: "Montée en cadence (après le 1er post)",
    items: ["1 post/jour pendant 7-10 jours avant d'augmenter la cadence"],
  },
];

const IG_SETUP: SubBlock[] = [
  {
    subtitle: "Setup",
    items: [
      "Créer le compte → profil vide au démarrage",
      "Compléter bio + photo de profil + 1 highlight pendant la chauffe",
    ],
  },
];

// Sous-phases de la CHAUFFE (J1 → J14, aucun post) : montée graduelle de
// l'engagement sans jamais publier.
const IG_PHASES: SubBlock[] = [
  {
    subtitle: "J1 à J3 — observation pure",
    items: [
      "**Recherches quotidiennes avec TES mots-clés**",
      "15-20 min scroll feed + Stories",
      "5-10 likes/jour",
      "**Zéro follow, zéro commentaire**",
    ],
  },
  {
    subtitle: "J4 à J10 — engagement léger",
    items: [
      "Recherches quotidiennes avec tes mots-clés",
      "5-10 follows/jour niche",
      "15-20 likes/jour",
      "2-3 commentaires authentiques",
      "Like et **enregistrement** de Reels de ta niche",
    ],
  },
  {
    subtitle: "J11 à J14 — activité normale",
    items: [
      "15-25 likes/jour, 5-10 commentaires",
      "Saves sur posts pertinents (signal fort)",
      "Premières Stories possibles à partir de J14-15",
    ],
  },
];

const IG_PREMIER: SubBlock[] = [
  {
    subtitle: "Premier Reel — J15 (lendemain de la chauffe)",
    items: ["**Aucun Reel avant J15** : la chauffe dure 14 jours pleins"],
  },
  {
    subtitle: "Montée en cadence (après le 1er Reel)",
    items: ["Montée progressive vers une activité normale"],
  },
];

const YOUTUBE_BLOCKS: SubBlock[] = [
  {
    subtitle: "Setup de la chaîne",
    items: [
      "Bannière, photo de profil, description de chaîne, À propos complet",
      "Créer 1 playlist (même vide)",
      "Lier les réseaux sociaux dans la description",
    ],
  },
  {
    subtitle: "Phase de chauffe (J1 → J7) — aucun post",
    items: [
      "**Recherches quotidiennes avec TES mots-clés**",
      "Visionnage de 5-10 Shorts/jour dans ta niche",
      "1-2 vidéos longues/jour dans ta niche (signal fort pour YT)",
      "Likes + 2-3 commentaires authentiques",
      "10-20 abonnements à des chaînes pertinentes",
    ],
  },
  {
    subtitle: "Premier Short — J8 (lendemain de la chauffe)",
    items: [
      "**Aucun Short avant J8** : la chauffe dure 7 jours pleins",
      "Ensuite, 1 Short/jour, idéalement à la même heure",
    ],
  },
];

const CLEAN_SIGNALS = [
  { plateforme: "TikTok", signal: "Vues 1er post à H+6", cible: "200-500+" },
  {
    plateforme: "TikTok",
    signal: "Source trafic FYP (Analytics → Reach)",
    cible: ">30%, idéalement >50%",
  },
  { plateforme: "Instagram", signal: "Vues Reel à H+24", cible: "200-1000+" },
  { plateforme: "Instagram", signal: "Non-followers reach", cible: ">40%" },
  { plateforme: "YouTube", signal: "Vues Short à H+48", cible: "100-500+" },
  {
    plateforme: "YouTube",
    signal: 'Source "Shorts feed" présente',
    cible: "Oui",
  },
  {
    plateforme: "Les 3",
    signal: "Test hashtag unique",
    cible: "Vidéo trouvable depuis autre compte",
  },
  {
    plateforme: "Les 3",
    signal: "Ton feed perso est devenu niché",
    cible: "Oui",
  },
];

const FAILED_SIGNALS = [
  "Vues bloquées 0-50 ou exactement 200 répété",
  "FYP / Reels feed / Shorts feed traffic = 0% en Analytics",
  'Vidéo "Stuck Processing" >2h',
  'Pop-up "Action blocked" sur Instagram',
  "Posts visibles uniquement par tes followers existants",
  'Notification "Ineligible for FYP" (TikTok)',
  "Drop de 70%+ vs moyenne 28 jours",
];

const RESET_STEPS = [
  "**Stop poster immédiatement** (clé absolue)",
  "Supprimer les vidéos à <50 vues (signal négatif permanent)",
  "Pause 5-7 jours **active** : scroll niche 20-30 min/jour, zéro post",
  "Reposter UNE vidéo, observer",
  "Si toujours 0 vues → abandonner le compte, en créer un neuf",
];

const DONT_BLOCKS: SubBlock[] = [
  {
    subtitle: "Pendant warmup",
    items: [
      "Poster avant la fin du warmup",
      "Suivre 50+ comptes le premier jour",
      'Commentaires génériques ("nice", "🔥") en masse',
      "Engagement hors-niche (confuse l'algo sur ta classification)",
      "Modifier la bio/PP tous les jours",
      "Switch entre VPN / IPs différentes",
    ],
  },
  {
    subtitle: "Au lancement post-warmup",
    items: [
      "Balancer 3 vidéos d'un coup",
      "Utiliser un scheduler/API pour les 10 premiers posts",
      "Hashtags douteux ou bannis (toujours vérifier dans la barre de recherche)",
      'Engagement bait ("like si tu es d\'accord", "follow pour la partie 2") — flag direct en 2026',
      "Musique copyrightée sur compte business",
      "Cross-poster le **même fichier vidéo** sur plusieurs comptes (fingerprint fichier détecté)",
    ],
  },
  {
    subtitle: "En continu",
    items: [
      "Arrêter de scroller la plateforme une fois en mode poster (l'algo track ta consommation aussi)",
      "Spam-poster suite à un succès (passer de 1/jour à 10/jour = flag)",
      "Switcher entre comptes toutes les 10 min",
    ],
  },
];

// ─── Primitives de rendu ─────────────────────────────────────────────────────
function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((it, i) => (
        <li key={i}>{renderInline(it)}</li>
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
        <div className="space-y-3">
          <SubSections blocks={IG_SETUP} />
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-600">
              Chauffe par phases (J1 → J14) — aucun post
            </p>
            <SubSections blocks={IG_PHASES} />
          </div>
          <SubSections blocks={IG_PREMIER} />
        </div>
      </Section>

      <Section
        icon={<PlayIcon className="size-4" />}
        title={`YouTube Shorts — ${WARMUP_DURATION_BY_PLATFORM.YouTube} jours`}
      >
        <div className="space-y-3">
          <p>
            YouTube est bien plus permissif. Le compte est tied à ton Google
            account existant, donc moins de méfiance.
          </p>
          <SubSections blocks={YOUTUBE_BLOCKS} />
        </div>
      </Section>

      <Section
        icon={<CheckCircle2Icon className="size-4" />}
        title="Vérifications post-warmup"
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-slate-600">
              Signaux ✅ compte clean
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
                  {CLEAN_SIGNALS.map((s, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 font-medium text-slate-700">
                        {s.plateforme}
                      </td>
                      <td className="px-3 py-1.5">{s.signal}</td>
                      <td className="px-3 py-1.5 text-slate-700">{s.cible}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-slate-600">
              Signaux 🚨 warmup raté ou shadowban
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
            <li key={i}>{renderInline(step)}</li>
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
