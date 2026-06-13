"use client";

import { useMemo, useState } from "react";
import { useProjectQuery } from "@/components/project/use-project-convex";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  ASSIGNMENT_STATUS,
  assignmentUrgency,
  type AssignmentStatus,
} from "@/lib/assignment-status";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "Tous statuts" },
  { value: "todo", label: "À faire" },
  { value: "in_progress", label: "En cours" },
  { value: "submitted", label: "Soumis" },
  { value: "validated", label: "Validé" },
  { value: "rejected", label: "Rejeté" },
  { value: "paid", label: "Payé" },
];

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("fr-FR");
}

export default function AssignmentsPage() {
  const assignments = useProjectQuery(api.assignments.listAssignments, {});
  const [creatorFilter, setCreatorFilter] = useState("all");
  const [formatFilter, setFormatFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);

  const creators = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of assignments ?? []) m.set(a.creatorId, a.creatorName);
    return [...m.entries()].sort((x, y) => x[1].localeCompare(y[1], "fr"));
  }, [assignments]);
  const formats = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of assignments ?? []) m.set(a.formatId, a.formatName);
    return [...m.entries()].sort((x, y) => x[1].localeCompare(y[1], "fr"));
  }, [assignments]);

  const rows = useMemo(() => {
    return (assignments ?? []).filter((a) => {
      if (creatorFilter !== "all" && a.creatorId !== creatorFilter) return false;
      if (formatFilter !== "all" && a.formatId !== formatFilter) return false;
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (
        overdueOnly &&
        assignmentUrgency(a.dueDate, a.status as AssignmentStatus) !== "overdue"
      )
        return false;
      return true;
    });
  }, [assignments, creatorFilter, formatFilter, statusFilter, overdueOnly]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Assignments
        </h1>
        <p className="text-sm text-slate-500">
          {assignments === undefined
            ? "Chargement…"
            : `${rows.length} / ${assignments.length} livrable${assignments.length > 1 ? "s" : ""}`}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={creatorFilter} onValueChange={(v) => v && setCreatorFilter(v)}>
          <SelectTrigger className="w-44" aria-label="Filtrer par créateur">
            <SelectValue>
              {creatorFilter === "all"
                ? "Tous créateurs"
                : (creators.find((c) => c[0] === creatorFilter)?.[1] ?? "Créateur")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous créateurs</SelectItem>
            {creators.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={formatFilter} onValueChange={(v) => v && setFormatFilter(v)}>
          <SelectTrigger className="w-44" aria-label="Filtrer par format">
            <SelectValue>
              {formatFilter === "all"
                ? "Tous formats"
                : (formats.find((f) => f[0] === formatFilter)?.[1] ?? "Format")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous formats</SelectItem>
            {formats.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
          <SelectTrigger className="w-40" aria-label="Filtrer par statut">
            <SelectValue>
              {STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <Checkbox
            checked={overdueOnly}
            onCheckedChange={(c) => setOverdueOnly(c === true)}
          />
          En retard seulement
        </label>
      </div>

      {assignments === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">
            Aucun assignment{assignments.length > 0 ? " pour ce filtre" : ""}.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Créateur</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead>Compte</TableHead>
                  <TableHead>Échéance</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Soumis</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => {
                  const overdue =
                    assignmentUrgency(a.dueDate, a.status as AssignmentStatus) ===
                    "overdue";
                  const st = ASSIGNMENT_STATUS[a.status as AssignmentStatus];
                  return (
                    <TableRow
                      key={a._id}
                      className={cn(overdue && "bg-rose-50/60")}
                    >
                      <TableCell className="font-medium text-slate-900">
                        {a.creatorName}
                      </TableCell>
                      <TableCell className="text-slate-700">
                        {a.formatName}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-slate-500">
                        {a.accountHandle ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className={cn(overdue && "font-semibold text-rose-700")}>
                          {formatDate(a.dueDate)}
                        </span>
                        {overdue && (
                          <span className="ml-1 text-xs font-semibold text-rose-600">
                            (retard)
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                            st.className,
                          )}
                        >
                          {st.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">
                        {a.submittedAt ? formatDate(a.submittedAt) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
