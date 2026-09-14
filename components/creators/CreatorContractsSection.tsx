"use client";

import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import {
  useProjectMutation,
  useProjectQuery,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDateFr } from "@/convex/dateFr";
import { FileTextIcon, Loader2Icon, Trash2Icon, UploadIcon } from "lucide-react";
import {
  CONTRACT_CONTENT_TYPE,
  resolveContractContentType,
  validateContractFile,
} from "@/lib/contract-file";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useConvexError } from "@/lib/use-convex-error";
import { formatBytes } from "@/lib/snytch-drive";

/** Taille lisible — « 340 Ko » / « 340 KB », selon la langue du lecteur. */
function formatSize(bytes: number, locale: string): string {
  return formatBytes(Math.max(bytes, 1024), locale);
}

/**
 * Contrats de la créatrice SUR CE PROJET (fiche admin, onglet Rémunération).
 * Dépôt de PDF (Convex file storage), liste, suppression.
 *
 * L'onglet — et donc cette carte — n'existe que pour qui porte
 * `creators.pay_terms` ; le serveur re-garde de toute façon les trois fonctions.
 *
 * Ce que la créatrice voit de son côté (portail → Profil) est servi par la MÊME
 * lecture serveur : ce qui apparaît ici apparaît là, sans version ni délai
 * intermédiaire — un contrat déposé est un contrat consultable.
 */
export function CreatorContractsSection({
  creatorId,
}: {
  creatorId: Id<"creators">;
}) {
  const showError = useConvexError();
  const loc = useIntlLocale();
  const tr = useTranslations("admin.creators.CreatorContractsSection");
  const tErr = useTranslations("admin.creators.contractError");
  const contracts = useProjectQuery(api.creatorContracts.listCreatorContracts, {
    creatorId,
  });
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);
  const addContract = useProjectMutation(api.creatorContracts.addCreatorContract);
  const removeContract = useProjectMutation(
    api.creatorContracts.deleteCreatorContract,
  );
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [deleting, setDeleting] = useState<Id<"creatorContracts"> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    // Le MIME peut être vide selon l'OS → on retombe sur l'extension avant de
    // refuser quoi que ce soit (lib/contract-file).
    const contentType = resolveContractContentType(file);
    const check = validateContractFile({
      contentType: contentType ?? "",
      size: file.size,
    });
    if (!check.ok) {
      toast.error(tErr(check.error!));
      return;
    }
    setBusy(true);
    try {
      const url = await generateUploadUrl({});
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": CONTRACT_CONTENT_TYPE },
        body: file,
      });
      // i18n-exempt: message technique jamais affiché (le toast rend le repli traduit)
      if (!res.ok) throw new Error(`Upload échoué (HTTP ${res.status}).`);
      const { storageId } = (await res.json()) as {
        storageId: Id<"_storage">;
      };
      await addContract({
        creatorId,
        storageId,
        fileName: file.name,
        contentType: CONTRACT_CONTENT_TYPE,
        size: file.size,
      });
      toast.success(tr("contratDepose"));
    } catch (e) {
      toast.error(showError(e, tr("depotImpossible")));
    } finally {
      setBusy(false);
      // Sans ce reset, redéposer LE MÊME fichier après une erreur ne
      // déclencherait aucun `change` — l'admin cliquerait dans le vide.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(id: Id<"creatorContracts">, fileName: string) {
    if (!window.confirm(tr("supprimerLePdfSeraEfface", { fileName: fileName }))) {
      return;
    }
    setDeleting(id);
    try {
      await removeContract({ id });
      toast.success(tr("contratSupprime"));
    } catch (e) {
      toast.error(showError(e, tr("suppressionImpossible")));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr("contrat")}</CardTitle>
        <CardDescription>
          {tr("leContratSignePourCe")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) void upload(file);
          }}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors",
            dragOver ? "border-primary bg-primary/5" : "border-slate-200",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept={`${CONTRACT_CONTENT_TYPE},.pdf`}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <UploadIcon className="size-5 text-slate-400" />
          <p className="text-sm text-slate-500">
            {tr("glisseLePdfIciOu")}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            data-testid="upload-contract"
          >
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {busy ? tr("depotEnCours") : tr("deposerUnContrat")}
          </Button>
        </div>

        {contracts === undefined ? (
          <Skeleton className="h-16 w-full" />
        ) : contracts.length === 0 ? (
          <p className="text-sm text-slate-400">
            {tr("aucunContratDeposePourCe")}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {contracts.map((c) => (
              <li
                key={c._id}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <FileTextIcon className="size-4 shrink-0 text-slate-400" />
                  <div className="min-w-0">
                    {/* Pas de lien quand l'URL manque : un href vide ouvrirait
                        la page elle-même et ferait passer un blob absent pour
                        un contrat consultable. */}
                    {c.url ? (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-sm font-medium text-slate-900 hover:underline"
                      >
                        {c.fileName}
                      </a>
                    ) : (
                      <p className="truncate text-sm font-medium text-slate-400">
                        {tr("fichierIntrouvable", { fileName: c.fileName })}
                      </p>
                    )}
                    <p className="text-xs text-slate-400">
                      {tr("deposeLe", { date: formatDateFr(c.uploadedAt, loc), value: formatSize(c.size, loc) })}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-slate-400 hover:text-rose-600"
                  disabled={deleting === c._id}
                  onClick={() => void remove(c._id, c.fileName)}
                  aria-label={tr("supprimerLeContrat")}
                >
                  {deleting === c._id ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <Trash2Icon className="size-4" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
