import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CopyButton } from "@/components/ui/CopyButton";
import { BlockInstruction } from "@/components/scripts/ScriptDestinationZones";
import { useTranslations } from "next-intl";

/**
 * La NOTIF d'une vidéo — le texte de la notification à afficher à l'écran
 * (brique optionnelle d'une campagne, cf convex/scriptNotif).
 *
 * Carte À PART du script, et pas un bloc de plus dans la zone 🎬 : la notif
 * existe que la fiche soit en deux zones ou en bloc unique, et elle se RECOPIE
 * mot pour mot (d'où la bulle façon notification et le bouton copier) — c'est
 * ce texte exact que l'analytics mesure.
 *
 * Réutilisée telle quelle par la fiche créatrice, la fiche clip et l'aperçu
 * admin (« ce que verra la créatrice »).
 */
export function ScriptNotifCard({
  text,
  instruction = null,
  className,
}: {
  text: string;
  /** Consigne de la brique (absente = aucun encart). */
  instruction?: string | null;
  className?: string;
}) {
  const t = useTranslations("portal.script");
  return (
    <Card className={className} data-testid="script-notif">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span aria-hidden>🔔</span>
          {t("notifTitle")}
        </CardTitle>
        <CardDescription>{t("notifHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p
          className="whitespace-pre-wrap break-words rounded-2xl bg-slate-100 px-4 py-3 text-sm font-medium text-slate-900 shadow-sm ring-1 ring-slate-200"
          data-testid="script-notif-text"
        >
          {text}
        </p>
        <BlockInstruction text={instruction} label={t("instruction")} />
        <CopyButton
          text={text}
          label={t("copyNotif")}
          className="h-11 w-full text-base sm:h-9 sm:w-auto sm:text-sm"
        />
      </CardContent>
    </Card>
  );
}
