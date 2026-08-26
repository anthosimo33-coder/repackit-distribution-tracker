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
import { useTranslations } from "next-intl";

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

// ─── Contenu ────────────────────────────────────────────────────────────────
//
// Le contenu du guide vit dans les CATALOGUES (`warmupGuide.*`), pas ici. C'est
// un document, pas du chrome d'interface : une centaine de puces de prose, dont
// la STRUCTURE (sections → sous-titres → items) fait partie du texte. La sortir
// en clés plates aurait produit ~100 clés au nommage arbitraire, impossibles à
// relire ; en la laissant en arbre, traduire le guide revient à traduire un
// arbre JSON, et la structure est vérifiée par la parité des catalogues.
//
// `t.raw()` rend l'arbre tel quel (next-intl n'interpole que les chaînes
// passées par `t()`), d'où les types explicites ci-dessous.

type SubBlock = { subtitle: string; items: string[] };
type CleanSignal = { platform: string; signal: string; target: string };

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
  const t = useTranslations("warmupGuide");
  // `t.raw` rend la valeur brute du catalogue — ici des tableaux d'objets.
  const raw = <T,>(key: string) => t.raw(key) as T;
  const cleanSignals = raw<CleanSignal[]>("cleanSignals");
  const allThree = t("allThree");

  return (
    <div className="space-y-2">
      <Section
        icon={<ShieldAlertIcon className="size-4" />}
        title={t("section.common")}
      >
        <Bullets items={raw<string[]>("commonRules")} />
      </Section>

      <Section
        icon={<Music2Icon className="size-4" />}
        title={t("section.tiktok", {
          days: WARMUP_DURATION_BY_PLATFORM.TikTok,
        })}
      >
        <SubSections blocks={raw<SubBlock[]>("tiktokBlocks")} />
      </Section>

      <Section
        icon={<CameraIcon className="size-4" />}
        title={t("section.instagram", {
          days: WARMUP_DURATION_BY_PLATFORM.Instagram,
        })}
      >
        <div className="space-y-3">
          <SubSections blocks={raw<SubBlock[]>("igSetup")} />
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-600">
              {t("igPhasesTitle")}
            </p>
            <SubSections blocks={raw<SubBlock[]>("igPhases")} />
          </div>
          <SubSections blocks={raw<SubBlock[]>("igPremier")} />
        </div>
      </Section>

      <Section
        icon={<PlayIcon className="size-4" />}
        title={t("section.youtube", {
          days: WARMUP_DURATION_BY_PLATFORM.YouTube,
        })}
      >
        <div className="space-y-3">
          <p>{t("youtubeIntro")}</p>
          <SubSections blocks={raw<SubBlock[]>("youtubeBlocks")} />
        </div>
      </Section>

      <Section
        icon={<CheckCircle2Icon className="size-4" />}
        title={t("section.checks")}
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-slate-600">
              {t("cleanTitle")}
            </p>
            <div className="overflow-hidden rounded-md border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">
                      {t("table.platform")}
                    </th>
                    <th className="px-3 py-1.5 font-medium">
                      {t("table.signal")}
                    </th>
                    <th className="px-3 py-1.5 font-medium">
                      {t("table.target")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cleanSignals.map((s, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 font-medium text-slate-700">
                        {/* « @allThree » = les trois plateformes à la fois. Un
                            marqueur plutôt qu'un libellé recopié : le nom des
                            plateformes est une marque, « Les 3 » ne l'est pas. */}
                        {s.platform === "@allThree" ? allThree : s.platform}
                      </td>
                      <td className="px-3 py-1.5">{s.signal}</td>
                      <td className="px-3 py-1.5 text-slate-700">{s.target}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-slate-600">
              {t("failedTitle")}
            </p>
            <Bullets items={raw<string[]>("failedSignals")} />
          </div>
        </div>
      </Section>

      <Section
        icon={<RotateCcwIcon className="size-4" />}
        title={t("section.reset")}
      >
        <ol className="list-decimal space-y-1 pl-5">
          {raw<string[]>("resetSteps").map((step, i) => (
            <li key={i}>{renderInline(step)}</li>
          ))}
        </ol>
      </Section>

      <Section
        icon={<BanIcon className="size-4" />}
        title={t("section.dont")}
      >
        <SubSections blocks={raw<SubBlock[]>("dontBlocks")} />
      </Section>
    </div>
  );
}
