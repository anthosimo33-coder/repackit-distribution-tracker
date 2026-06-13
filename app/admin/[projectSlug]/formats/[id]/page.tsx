"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { ArrowLeftIcon, Trash2Icon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { FormatEditor } from "@/components/formats/FormatEditor";
import { FormatBriefPreview } from "@/components/formats/FormatBriefPreview";
import { AssignFormatDialog } from "@/components/admin/AssignFormatDialog";

export default function FormatDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const projectPath = useProjectPath();
  const format = useProjectQuery(api.formats.getFormat, {
    id: id as Id<"formats">,
  });
  const deleteFormat = useProjectMutation(api.formats.deleteFormat);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  useEffect(() => {
    if (format === null) router.replace(projectPath("/formats"));
  }, [format, router, projectPath]);

  async function handleDelete() {
    if (!format) return;
    setDeleting(true);
    try {
      await deleteFormat({ id: format._id });
      toast.success("Format supprimé");
      router.replace(projectPath("/formats"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href={projectPath("/formats")}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
        >
          <ArrowLeftIcon className="size-4" />
          Retour aux formats
        </Link>
        {format && (
          <div className="flex items-center gap-2">
            {format.status !== "archived" && (
              <Button size="sm" onClick={() => setAssignOpen(true)}>
                <UsersIcon className="mr-1.5 size-4" />
                Assigner
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteOpen(true)}
              className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            >
              <Trash2Icon className="mr-1.5 size-4" />
              Supprimer
            </Button>
          </div>
        )}
      </div>

      {format && (
        <AssignFormatDialog
          formatId={format._id}
          formatName={format.name}
          open={assignOpen}
          onOpenChange={setAssignOpen}
        />
      )}

      {format === undefined ? (
        <Skeleton className="h-96 w-full" />
      ) : format === null ? null : (
        <Tabs defaultValue="edit">
          <TabsList>
            <TabsTrigger value="edit">Éditer</TabsTrigger>
            <TabsTrigger value="preview">Aperçu créateur</TabsTrigger>
          </TabsList>
          <TabsContent value="edit" className="mt-6">
            <FormatEditor format={format} />
          </TabsContent>
          <TabsContent value="preview" className="mt-6">
            <FormatBriefPreview format={format} />
          </TabsContent>
        </Tabs>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce format ?</AlertDialogTitle>
            <AlertDialogDescription>
              Action irréversible. Les vidéos exemples uploadées seront aussi
              supprimées du storage. Si le format est utilisé, archive-le plutôt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
