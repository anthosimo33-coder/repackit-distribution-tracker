"use client";

import { useState } from "react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";

/**
 * P7 — édition du guide « Comment ça marche » (markdown). Ce que voient les
 * créateurs dans /app/guide. Un placeholder est servi tant que rien n'est saisi.
 */
export default function GuideAdminPage() {
  const guide = useProjectQuery(api.guide.getGuideForAdmin, {});
  const update = useProjectMutation(api.guide.updateProjectGuide);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Initialise le brouillon depuis le serveur au 1er chargement.
  const content = draft ?? guide?.content ?? "";

  async function handleSave() {
    setSaving(true);
    try {
      await update({ content });
      toast.success("Guide enregistré");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Comment ça marche
        </h1>
        <p className="text-sm text-slate-500">
          Le guide affiché aux créateurs (le système, pas un format précis).
        </p>
      </header>

      {guide === undefined ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-2">
            <Textarea
              rows={22}
              value={content}
              onChange={(e) => setDraft(e.target.value)}
              className="font-mono text-xs"
            />
            <div className="flex items-center justify-between">
              {guide.isDefault && draft === null && (
                <span className="text-xs text-slate-400">
                  Contenu par défaut (non encore enregistré).
                </span>
              )}
              <Button onClick={handleSave} disabled={saving} className="ml-auto">
                {saving && <Loader2Icon className="mr-2 size-4 animate-spin" />}
                Enregistrer
              </Button>
            </div>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Aperçu créateur</CardTitle>
            </CardHeader>
            <CardContent>
              <SimpleMarkdown content={content} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
