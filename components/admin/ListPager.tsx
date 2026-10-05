"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { ListPage } from "@/lib/list-page";

/**
 * Pied de liste paginée : la plage affichée (« 101–200 sur 787 ») et les deux
 * gestes Précédente / Suivante. Rien quand tout tient sur une page — un pager
 * « 1 / 1 » ne dirait rien.
 */
export function ListPager({
  view,
  onPage,
}: {
  view: Pick<ListPage<unknown>, "page" | "pageCount" | "from" | "to" | "total">;
  onPage: (page: number) => void;
}) {
  const tr = useTranslations("admin.assignments.ListPager");
  if (view.pageCount <= 1) return null;
  const isFirst = view.page === 0;
  const isLast = view.page >= view.pageCount - 1;
  return (
    <nav
      aria-label={tr("pagination")}
      className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-sm text-slate-600"
    >
      <span className="tabular-nums" data-testid="list-pager-range">
        {tr("plage", { from: view.from, to: view.to, total: view.total })}
      </span>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1"
          disabled={isFirst}
          onClick={() => onPage(view.page - 1)}
        >
          <ChevronLeftIcon className="size-4" />
          {tr("precedente")}
        </Button>
        <span className="px-2 tabular-nums" data-testid="list-pager-page">
          {tr("pageSur", { page: view.page + 1, pageCount: view.pageCount })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1"
          disabled={isLast}
          onClick={() => onPage(view.page + 1)}
        >
          {tr("suivante")}
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>
    </nav>
  );
}
