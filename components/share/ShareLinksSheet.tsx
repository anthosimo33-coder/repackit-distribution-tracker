"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ExternalLinkIcon, LinkIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  useProjectMutation,
  useProjectQuery,
} from "@/components/project/use-project-convex";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/CopyButton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useConvexError } from "@/lib/use-convex-error";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { cn } from "@/lib/utils";

/**
 * Les liens publics du projet : qui les a ouverts, quand, et le bouton pour
 * les couper. Révoquer est immédiat — la page publique est réactive et passe
 * sur « lien plus disponible » chez un visiteur déjà dessus.
 */
export function ShareLinksSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations("admin.dashboard.ShareLinks");
  const loc = useIntlLocale();
  const errorText = useConvexError();
  const shares = useProjectQuery(api.publicShares.listShares, open ? {} : "skip");
  const revoke = useProjectMutation(api.publicShares.revokeShare);
  const [confirming, setConfirming] = useState<string | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const fmt = (ts: number) =>
    new Date(ts).toLocaleDateString(loc, { day: "numeric", month: "short", year: "numeric" });

  async function doRevoke(shareId: Id<"publicShares">) {
    try {
      await revoke({ shareId });
      toast.success(t("revoked"));
    } catch (e) {
      toast.error(errorText(e, t("revokeError")));
    } finally {
      setConfirming(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md" data-testid="share-links-sheet">
        <SheetHeader className="border-b border-slate-100 p-4">
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto">
          {shares === undefined ? null : shares.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <LinkIcon className="mx-auto size-6 text-slate-300" aria-hidden />
              <p className="mt-3 text-sm text-slate-500">{t("empty")}</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {shares.map((s) => {
                const url = `${origin}/s/${s.token}`;
                const status = s.status;
                return (
                  <li key={s._id} className="space-y-2 px-4 py-3" data-testid="share-link-row">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{s.name}</p>
                        <p className="text-xs text-slate-500">
                          {[
                            s.audience === "creator"
                              ? t("audienceCreator", { name: s.creatorName ?? "—" })
                              : t("audienceBrand"),
                            t("createdOn", { date: fmt(s.createdAt) }),
                          ].join(" · ")}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                          status === "active" && "bg-emerald-50 text-emerald-700",
                          (status === "expired" || status === "unavailable") &&
                            "bg-slate-100 text-slate-500",
                          status === "revoked" && "bg-red-50 text-red-700",
                        )}
                      >
                        {t(`status.${status}`)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {s.openCount === 0
                        ? t("neverOpened")
                        : t("opens", {
                            count: s.openCount,
                            date: s.lastOpenedAt !== null ? fmt(s.lastOpenedAt) : "—",
                          })}
                      {s.expiresAt !== null && status === "active"
                        ? ` · ${t("expiresOn", { date: fmt(s.expiresAt) })}`
                        : ""}
                    </p>
                    {status === "active" && (
                      <div className="flex flex-wrap items-center gap-2">
                        <CopyButton text={url} label={t("copy")} copiedLabel={t("copied")} />
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                        >
                          <ExternalLinkIcon className="size-3.5" aria-hidden />
                          {t("open")}
                        </a>
                        <span className="flex-1" />
                        {confirming === s._id ? (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                              {t("cancel")}
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => doRevoke(s._id)}>
                              {t("confirmRevoke")}
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setConfirming(s._id)}>
                            {t("revoke")}
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
