"use client";

import { useState } from "react";
import Link from "next/link";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PlusIcon, LayersIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatEuros } from "@/lib/format-rate";
import { NewFormatDialog } from "@/components/formats/NewFormatDialog";

const TYPE_LABELS: Record<string, string> = {
  carousel: "Carrousel",
  short: "Short",
  screenrecorder: "ScreenRecorder",
  custom: "Custom",
};

export default function FormatsPage() {
  const formats = useProjectQuery(api.formats.listFormats, {});
  const projectPath = useProjectPath();
  const [newOpen, setNewOpen] = useState(false);

  const subtitle =
    formats === undefined
      ? "Chargement…"
      : `${formats.length} format${formats.length > 1 ? "s" : ""}`;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Formats
          </h1>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        <Button onClick={() => setNewOpen(true)}>
          <PlusIcon className="mr-2 size-4" />
          Nouveau format
        </Button>
      </header>

      {formats === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : formats.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <LayersIcon className="size-14 text-slate-300" strokeWidth={1.5} />
            <p className="text-sm text-slate-500">
              Aucun format. Crée un brief que les créateurs pourront suivre.
            </p>
            <Button onClick={() => setNewOpen(true)}>
              <PlusIcon className="mr-2 size-4" />
              Nouveau format
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Exemples</TableHead>
                  <TableHead>Base / post</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {formats.map((f) => (
                  <TableRow
                    key={f._id}
                    className={cn(f.status === "archived" && "opacity-50")}
                  >
                    <TableCell className="font-medium text-slate-900">
                      <Link
                        href={projectPath(`/formats/${f._id}`)}
                        className="transition-colors hover:text-primary hover:underline"
                      >
                        {f.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {TYPE_LABELS[f.type] ?? f.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {f.status === "archived" ? (
                        <span className="text-slate-400">Archivé</span>
                      ) : (
                        <span className="text-emerald-600">Actif</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums text-slate-700">
                      {f.exampleVideos.length}
                    </TableCell>
                    <TableCell className="tabular-nums text-slate-700">
                      {formatEuros(f.rateModel.basePerPost)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <NewFormatDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}
