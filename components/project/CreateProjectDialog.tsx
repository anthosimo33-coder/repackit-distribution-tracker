"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { Loader2Icon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { projectPath } from "@/lib/project-path";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

const DEFAULT_ACCENT = "#FF5200";
const DEFAULT_PAYOUT_DAY = 5;

/** Slugifie un nom : minuscules, alphanumérique + tirets, sans tirets aux bords. */
function slugify(name: string): string {
  // NFD puis suppression des diacritiques combinants (U+0300–U+036F) par
  // codepoint (évite un range de combining marks en littéral regex), puis
  // réduction à [a-z0-9-].
  const stripped = name
    .normalize("NFD")
    .toLowerCase()
    .split("")
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c < 0x300 || c > 0x36f;
    })
    .join("");
  return stripped.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * P3 — modal de création d'un projet vierge (superadmin uniquement, la garde
 * réelle est côté Convex via superadminMutation). Nom + slug (auto-dérivé,
 * éditable) + couleur d'accent (#FF5200 par défaut) + jour de paie (5 par
 * défaut). Au succès : bascule sur le nouveau projet (/admin/<slug>/dashboard).
 */
export function CreateProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const createProject = useMutation(api.projects.createProject);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT);
  const [payoutDay, setPayoutDay] = useState(String(DEFAULT_PAYOUT_DAY));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const effectiveSlug = slugTouched ? slug : slugify(name);

  function handleNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await createProject({
        name: name.trim(),
        slug: effectiveSlug,
        accentColor,
        payoutDay: Number(payoutDay),
      });
      toast.success(`Projet « ${name.trim()} » créé.`);
      onOpenChange(false);
      router.push(projectPath(result.slug, "/dashboard"));
    } catch (err) {
      setError(
        err instanceof ConvexError && typeof err.data === "string"
          ? err.data
          : "Création du projet impossible.",
      );
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Créer un projet</DialogTitle>
            <DialogDescription>
              Un nouvel espace de distribution isolé. Le workspace démarre
              entièrement vide.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="project-name">Nom</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Mon projet"
                required
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="project-slug">Slug</Label>
              <Input
                id="project-slug"
                value={effectiveSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
                placeholder="mon-projet"
                required
              />
              <p className="text-xs text-slate-400">
                URL du projet :{" "}
                <span className="font-mono">/admin/{effectiveSlug || "…"}</span>
              </p>
            </div>

            <div className="flex gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="project-accent">Couleur d&apos;accent</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="project-accent"
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="size-9 cursor-pointer rounded-md border border-slate-200 bg-white p-0.5"
                    aria-label="Couleur d'accent"
                  />
                  <Input
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="w-28 font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="project-payout">Jour de paie</Label>
                <Input
                  id="project-payout"
                  type="number"
                  min={1}
                  max={28}
                  value={payoutDay}
                  onChange={(e) => setPayoutDay(e.target.value)}
                  className="w-24"
                  required
                />
              </div>
            </div>

            {error && (
              <p role="alert" className="text-sm text-rose-600">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2Icon className="size-4 animate-spin" />}
              Créer le projet
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
