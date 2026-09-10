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
import { convexErrorMessage } from "@/lib/convex-error";
import { formatDateFr } from "@/convex/dateFr";
import { FileTextIcon, Loader2Icon, Trash2Icon, UploadIcon } from "lucide-react";
import {
  CONTRACT_CONTENT_TYPE,
  resolveContractContentType,
  validateContractFile,
} from "@/lib/contract-file";

/** Taille lisible — un contrat pèse quelques centaines de Ko, jamais un Go. */
function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
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
      toast.error(check.error);
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
      toast.success("Contrat déposé.");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Dépôt impossible."));
    } finally {
      setBusy(false);
      // Sans ce reset, redéposer LE MÊME fichier après une erreur ne
      // déclencherait aucun `change` — l'admin cliquerait dans le vide.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(id: Id<"creatorContracts">, fileName: string) {
    if (!window.confirm(`Supprimer « ${fileName} » ? Le PDF sera effacé.`)) {
      return;
    }
    setDeleting(id);
    try {
      await removeContract({ id });
      toast.success("Contrat supprimé.");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Suppression impossible."));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contrat</CardTitle>
        <CardDescription>
          Le contrat signé pour ce projet, en PDF (20 Mo max). La créatrice le
          retrouve dans son espace, onglet Profil. Un avenant s&apos;ajoute à la
          liste — il ne remplace pas le précédent.
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
            Glisse le PDF ici, ou choisis-le.
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            data-testid="upload-contract"
          >
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {busy ? "Dépôt en cours…" : "Déposer un contrat"}
          </Button>
        </div>

        {contracts === undefined ? (
          <Skeleton className="h-16 w-full" />
        ) : contracts.length === 0 ? (
          <p className="text-sm text-slate-400">
            Aucun contrat déposé pour ce projet.
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
                        {c.fileName} — fichier introuvable
                      </p>
                    )}
                    <p className="text-xs text-slate-400">
                      Déposé le {formatDateFr(c.uploadedAt)} ·{" "}
                      {formatSize(c.size)}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-slate-400 hover:text-rose-600"
                  disabled={deleting === c._id}
                  onClick={() => void remove(c._id, c.fileName)}
                  aria-label="Supprimer le contrat"
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
