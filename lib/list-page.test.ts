import { describe, expect, it } from "vitest";
import { LIST_PAGE_SIZE, listPage } from "./list-page";

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("listPage", () => {
  it("787 lignes (Snytch) : 8 pages de 100, la dernière en porte 87", () => {
    const rows = range(787);
    const first = listPage(rows, 0);
    expect(first.pageCount).toBe(8);
    expect(first.items).toHaveLength(LIST_PAGE_SIZE);
    expect([first.from, first.to, first.total]).toEqual([1, 100, 787]);

    const last = listPage(rows, 7);
    expect(last.items).toEqual(range(787).slice(700));
    expect([last.from, last.to]).toEqual([701, 787]);
  });

  it("chaque ligne apparaît sur exactement une page, dans l'ordre", () => {
    const rows = range(250);
    const pages = [0, 1, 2].map((p) => listPage(rows, p, 100).items);
    expect(pages.flat()).toEqual(rows);
  });

  it("une page au-delà de la fin retombe sur la dernière (liste raccourcie)", () => {
    // Page 3 affichée, puis des suppressions ramènent la liste à 120 lignes.
    const p = listPage(range(120), 3, 100);
    expect(p.page).toBe(1);
    expect(p.items).toEqual(range(120).slice(100));
    expect([p.from, p.to]).toEqual([101, 120]);
  });

  it("une page négative ou absurde retombe sur la première", () => {
    expect(listPage(range(30), -2, 10).page).toBe(0);
    expect(listPage(range(30), Number.NaN, 10).page).toBe(0);
  });

  it("liste vide : une seule page, aucun rang", () => {
    expect(listPage([], 4)).toEqual({
      items: [],
      page: 0,
      pageCount: 1,
      from: 0,
      to: 0,
      total: 0,
    });
  });

  it("pile 100 lignes : une seule page (pas de pager)", () => {
    expect(listPage(range(100), 0).pageCount).toBe(1);
    expect(listPage(range(101), 0).pageCount).toBe(2);
  });
});
