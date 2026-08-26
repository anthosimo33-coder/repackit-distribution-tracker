"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  BellRingIcon,
  CheckCircle2Icon,
  CheckIcon,
  CopyIcon,
  Loader2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useConvexError } from "@/lib/use-convex-error";
import { useTranslations } from "next-intl";

/**
 * P5 — bloc « Bio à mettre » d'un compte côté portail créateur. Affiche la bio à
 * recopier (avec bouton Copier). En "to_apply" : encart ambre « Bio à mettre à
 * jour » + bouton « J'ai appliqué cette bio ». En "applied" : rappel discret
 * « Bio actuelle à maintenir ». Rien si aucune bio n'est définie (le parent ne
 * le rend de toute façon que si bioToApply est présent).
 */
export function AccountBioPanel({
  compte,
  projectId,
  readOnly = false,
}: {
  compte: Doc<"comptes">;
  projectId: Id<"projects">;
  /** Admin view-as : masque le bouton de confirmation (lecture seule). */
  readOnly?: boolean;
}) {
  const showError = useConvexError();
  const tbio = useTranslations("portal.bio");
  const confirmApplied = useMutation(api.comptes.confirmAccountBioApplied);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  const bio = compte.bioToApply;
  if (!bio) return null;
  const pending = compte.bioStatus === "to_apply";

  async function copy() {
    try {
      await navigator.clipboard.writeText(bio!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard indisponible — le texte reste sélectionnable */
    }
  }

  async function handleConfirm() {
    setSubmitting(true);
    try {
      await confirmApplied({ projectId, id: compte._id });
      toast.success(tbio("confirmed"));
    } catch (e) {
      toast.error(showError(e, tbio("error")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-testid="bio-panel"
      className={cn(
        "space-y-3 rounded-lg border p-3",
        pending
          ? "border-amber-300 bg-amber-50/60"
          : "border-slate-200 bg-slate-50/60",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        {pending ? (
          <span
            data-testid="bio-pending-badge"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700"
          >
            <BellRingIcon className="size-3.5" />{tbio("toUpdate")}</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <CheckCircle2Icon className="size-3.5" />{tbio("toKeep")}</span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0"
          onClick={copy}
          aria-label={tbio("copy")}
        >
          {copied ? (
            <CheckIcon className="mr-1.5 size-3.5 text-emerald-600" />
          ) : (
            <CopyIcon className="mr-1.5 size-3.5" />
          )}
          Copier
        </Button>
      </div>

      <p className="whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-white p-2.5 text-sm text-slate-800">
        {bio}
      </p>

      {pending && !readOnly && (
        <Button
          onClick={handleConfirm}
          disabled={submitting}
          className="w-full"
        >
          {submitting ? (
            <Loader2Icon className="mr-2 size-4 animate-spin" />
          ) : (
            <CheckCircle2Icon className="mr-2 size-4" />
          )}
          J&apos;ai appliqué cette bio
        </Button>
      )}
    </div>
  );
}
