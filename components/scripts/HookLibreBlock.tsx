import { useTranslations } from "next-intl";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";
import type { HookLibre } from "@/convex/hookLibre";

/**
 * HOOK LIBRE — l'accroche donnée comme une DIRECTION (cf convex/hookLibre.ts) :
 * l'idée à garder, puis des formulations pour s'inspirer. Encadré distinct du
 * texte du script : la créatrice doit voir d'un coup d'œil qu'elle ne récite
 * pas, elle reformule.
 *
 * Réutilisé tel quel par la fiche créatrice, la fiche clippeur et l'aperçu
 * admin, dans les deux affichages (carte unique et deux zones).
 */
export function HookLibreBlock({ hook }: { hook: HookLibre }) {
  const t = useTranslations("portal.script");
  return (
    <div
      className="space-y-2 rounded-lg border border-sky-200 bg-sky-50/60 p-3"
      data-testid="hook-libre"
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-sky-700">
        <span aria-hidden>✍️</span>
        {t("hookLibreTitle")}
      </p>
      {hook.direction && (
        <p className="whitespace-pre-wrap break-words text-base font-medium text-slate-900">
          {hook.direction}
        </p>
      )}
      <div>
        <p className="text-xs text-slate-500">{t("hookLibreExamples")}</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {hook.exemples.map((e) => (
            <li
              key={e}
              className="whitespace-pre-wrap break-words text-sm italic text-slate-700"
            >
              {e}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-sky-800/80">{t("hookLibreHint")}</p>
    </div>
  );
}

/**
 * Le script de la CARTE UNIQUE : le texte figé tel quel, ou — hook libre — le
 * bloc de direction suivi du reste du script (flux puis cta), sans l'exemple
 * principal répété comme s'il fallait le dire.
 */
export function ScriptText({
  text,
  hookLibre,
}: {
  text: string;
  hookLibre: (HookLibre & { reste: string }) | null;
}) {
  if (!hookLibre) return <SimpleMarkdown content={text} />;
  return (
    <>
      <HookLibreBlock hook={hookLibre} />
      {hookLibre.reste.trim() && <SimpleMarkdown content={hookLibre.reste} />}
    </>
  );
}
