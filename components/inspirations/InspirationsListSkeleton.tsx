"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Batch H — skeleton pour la vue list. Mêmes colonnes que InspirationsList
 * pour cohérence visuelle pendant le fetch.
 */
export function InspirationsListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <Table>
        <TableHeader className="bg-slate-50">
          <TableRow>
            <TableHead className="w-[60px]" />
            <TableHead className="w-[80px]">Type</TableHead>
            <TableHead className="w-[100px]">Plateforme</TableHead>
            <TableHead>Titre</TableHead>
            <TableHead className="w-[140px]">Dossier</TableHead>
            <TableHead className="w-[180px]">Stats</TableHead>
            <TableHead className="w-[50px]" />
            <TableHead className="w-[90px]">Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: count }).map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="size-10 rounded-md" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-14" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-16" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-40" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-20" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-24" />
              </TableCell>
              <TableCell>
                <Skeleton className="size-7" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-14" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
