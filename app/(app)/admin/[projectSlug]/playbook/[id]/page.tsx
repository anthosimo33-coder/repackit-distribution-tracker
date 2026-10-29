"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeftIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectMutation, useProjectQuery } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { usePermissions } from "@/components/project/use-permissions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { JournalFiche } from "@/components/playbook/JournalFiche";
import { PostsFiche } from "@/components/playbook/PostsFiche";
import { StatutFiche } from "@/components/playbook/StatutFiche";
import { useConvexError } from "@/lib/use-convex-error";
import {
  CHAMPS_TEXTE,
  MAX_MOTIF,
  MAX_TITRE,
  STATUTS_FICHE,
  titreValide,
  type ChampTexte,
  type ContenuFiche,
  type StatutFiche as Statut,
} from "@/convex/playbookFiche";

/**
 * Une FICHE de playbook : le format, son statut, ce qu'on refait, la preuve, ce
 * qui contredit, les règles et la prochaine question ; à côté, les posts de
 * preuve relus en direct et le journal. Un enregistrement porte un MOTIF (« A/B
 * tour 2 lu à J+7 »), gardé au journal avec le changement.
 */
export default function PlaybookFichePage() {
  const params = useParams<{ id: string }>();
  const id = params.id as Id<"playbookFiches">;
  const tr = useTranslations("admin.scripts.PlaybookFichePage");
  const projectPath = useProjectPath();
  const { has, chargement } = usePermissions();
  const fiche = useProjectQuery(api.playbook.getFiche, has("scripts.manage") ? { id } : "skip");

  if (chargement || fiche === undefined) return <Skeleton className="h-96 w-full" />;
  if (fiche === null) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-slate-500">{tr("introuvable")}</CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <Link
        href={projectPath("/playbook")}
        prefetch={false}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeftIcon className="size-4" />
        {tr("retour")}
      </Link>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* Après un enregistrement, la base REJOINT la saisie : rien à remonter.
            Remonter à chaque version perdrait une saisie en cours dès qu'un post
            est ajouté. */}
        <Editeur key={fiche._id} fiche={fiche} />
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <PostsFiche ficheId={fiche._id} posts={fiche.posts} />
          <JournalFiche lignes={fiche.journal} />
        </div>
      </div>
    </div>
  );
}

type Fiche = ContenuFiche & { _id: Id<"playbookFiches"> };

const AIDE: Record<ChampTexte, "recetteAide" | "preuvesAide" | "contrePreuveAide" | "reglesAide" | "aTesterAide"> = {
  recette: "recetteAide",
  preuves: "preuvesAide",
  contrePreuve: "contrePreuveAide",
  regles: "reglesAide",
  aTester: "aTesterAide",
};

function Editeur({ fiche }: { fiche: Fiche }) {
  const tr = useTranslations("admin.scripts.PlaybookFichePage");
  const tChamp = useTranslations("admin.scripts.playbookChamp");
  const tStatut = useTranslations("admin.scripts.playbookStatut");
  const showError = useConvexError();
  const router = useRouter();
  const projectPath = useProjectPath();
  const modifier = useProjectMutation(api.playbook.modifierFiche);
  const supprimer = useProjectMutation(api.playbook.supprimerFiche);
  const [titre, setTitre] = useState(fiche.titre);
  const [statut, setStatut] = useState<Statut>(fiche.statut);
  const [textes, setTextes] = useState<Record<ChampTexte, string>>(() => ({
    recette: fiche.recette,
    preuves: fiche.preuves,
    contrePreuve: fiche.contrePreuve,
    regles: fiche.regles,
    aTester: fiche.aTester,
  }));
  const [motif, setMotif] = useState("");
  const [busy, setBusy] = useState(false);
  const [suppression, setSuppression] = useState(false);

  const changes: Partial<ContenuFiche> = {
    ...(titre.trim() !== fiche.titre ? { titre } : {}),
    ...(statut !== fiche.statut ? { statut } : {}),
    ...Object.fromEntries(CHAMPS_TEXTE.filter((c) => textes[c].trim() !== fiche[c]).map((c) => [c, textes[c]])),
  };
  const modifie = Object.keys(changes).length > 0;
  const titreOk = titreValide(titre) !== null;

  async function enregistrer() {
    if (!modifie || !titreOk) return;
    setBusy(true);
    try {
      await modifier({ id: fiche._id, ...changes, ...(motif.trim() ? { motif } : {}) });
      setMotif("");
      toast.success(tr("enregistre"));
    } catch (e) {
      toast.error(showError(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmerSuppression() {
    try {
      await supprimer({ id: fiche._id });
      toast.success(tr("supprimee"));
      router.push(projectPath("/playbook"));
    } catch (e) {
      toast.error(showError(e));
    }
  }

  return (
    <section className="space-y-4" aria-label={fiche.titre}>
      <header className="space-y-3">
        <div className="flex items-center gap-2">
          <StatutFiche statut={fiche.statut} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="playbook-fiche-titre">{tr("titre")}</Label>
          <Input
            id="playbook-fiche-titre"
            value={titre}
            maxLength={MAX_TITRE}
            onChange={(e) => setTitre(e.target.value)}
            className="text-base font-semibold"
            aria-invalid={!titreOk}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="playbook-fiche-statut">{tr("statut")}</Label>
          <Select value={statut} onValueChange={(v) => v && setStatut(v as Statut)}>
            <SelectTrigger id="playbook-fiche-statut" className="h-9 w-44" data-testid="playbook-statut-select">
              <SelectValue>{tStatut(statut)}</SelectValue>
            </SelectTrigger>
            <SelectContent align="start">
              {STATUTS_FICHE.map((s) => (
                <SelectItem key={s} value={s}>
                  {tStatut(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      {CHAMPS_TEXTE.map((c) => (
        <div key={c} className="space-y-1.5">
          <Label htmlFor={`playbook-fiche-${c}`}>{tChamp(c)}</Label>
          <p className="text-xs text-slate-400">{tr(AIDE[c])}</p>
          <Textarea
            id={`playbook-fiche-${c}`}
            value={textes[c]}
            onChange={(e) => setTextes((t) => ({ ...t, [c]: e.target.value }))}
            className="min-h-24 text-sm leading-relaxed"
            data-testid={`playbook-champ-${c}`}
          />
        </div>
      ))}

      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="space-y-1.5">
          <Label htmlFor="playbook-fiche-motif">{tr("motif")}</Label>
          <Input
            id="playbook-fiche-motif"
            value={motif}
            maxLength={MAX_MOTIF}
            onChange={(e) => setMotif(e.target.value)}
            placeholder={tr("motifExemple")}
          />
          <p className="text-xs text-slate-400">{tr("motifAide")}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="outline"
            className="text-rose-600 hover:text-rose-700"
            onClick={() => setSuppression(true)}
            data-testid="playbook-supprimer"
          >
            <Trash2Icon className="mr-2 size-4" />
            {tr("supprimer")}
          </Button>
          <div className="flex items-center gap-3">
            {modifie && <span className="text-xs text-amber-700">{tr("nonEnregistre")}</span>}
            <Button onClick={enregistrer} disabled={!modifie || !titreOk || busy} data-testid="playbook-enregistrer">
              {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              {tr("enregistrer")}
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={suppression} onOpenChange={setSuppression}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("supprimerTitre")}</AlertDialogTitle>
            <AlertDialogDescription>{tr("supprimerTexte")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("annuler")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmerSuppression()} className="bg-rose-600 hover:bg-rose-700">
              {tr("supprimer")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
