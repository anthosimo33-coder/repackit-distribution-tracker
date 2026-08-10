import { describe, it, expect } from "vitest";
// Module SERVEUR pur (aucun import `_generated`) — chargeable tel quel par vitest.
import {
  claimed,
  decideOnEvent,
  freshWindow,
  isLeadingEdge,
  ORPHAN_MS,
  PENDING_CAP,
  WINDOW_MS,
  type WindowState,
} from "../convex/notificationWindow";

const T0 = Date.UTC(2026, 7, 10, 12, 0, 0);

describe("front montant puis groupage", () => {
  it("aucune fenêtre ouverte → on ouvre ET on envoie tout de suite", () => {
    const d = decideOnEvent(null, "Kelly", T0);
    expect(d.action).toBe("open");
    expect(isLeadingEdge(d)).toBe(true);
  });

  it("fenêtre en cours → on tamponne, on n'envoie rien", () => {
    const win = freshWindow(T0);
    const d = decideOnEvent(win, "Léa", T0 + 1_000);
    expect(d.action).toBe("append");
    expect(isLeadingEdge(d)).toBe(false);
    expect(d.action === "append" && d.state.pending).toEqual(["Léa"]);
  });

  it("le front montant n'est PAS tamponné (il est déjà parti)", () => {
    expect(freshWindow(T0).pending).toEqual([]);
    expect(freshWindow(T0).pendingCount).toBe(0);
  });

  it("cinq soumissions d'affilée → 2 messages, pas 5", () => {
    let win: WindowState | null = null;
    let immediats = 0;
    for (let i = 0; i < 5; i++) {
      const d = decideOnEvent(win, `créatrice ${i}`, T0 + i * 1_000);
      if (d.action === "open") {
        win = freshWindow(T0 + i * 1_000);
        immediats++;
      } else {
        win = d.state;
      }
    }
    expect(immediats).toBe(1); // le front montant
    const groupe = claimed(win);
    expect(groupe.total).toBe(4); // les 4 suivantes, en UN message
    expect(immediats + (groupe.total > 0 ? 1 : 0)).toBe(2);
  });

  it("une soumission isolée reste instantanée (aucun retard de 3 min)", () => {
    const d = decideOnEvent(null, "Kelly", T0);
    expect(isLeadingEdge(d)).toBe(true);
    // Le flush qui suit ne trouve rien à dire → aucun 2e message.
    expect(claimed(freshWindow(T0)).total).toBe(0);
  });
});

describe("tampon — plafond d'échantillon, compteur honnête", () => {
  it("les lignes conservées sont plafonnées", () => {
    let win: WindowState = freshWindow(T0);
    for (let i = 0; i < PENDING_CAP + 40; i++) {
      const d = decideOnEvent(win, `ligne ${i}`, T0 + 1_000);
      if (d.action !== "open") win = d.state;
    }
    expect(win.pending.length).toBe(PENDING_CAP);
  });

  it("le COMPTEUR, lui, n'est jamais plafonné — pas de sous-décompte muet", () => {
    let win: WindowState = freshWindow(T0);
    const n = PENDING_CAP + 40;
    for (let i = 0; i < n; i++) {
      const d = decideOnEvent(win, `ligne ${i}`, T0 + 1_000);
      if (d.action !== "open") win = d.state;
    }
    expect(win.pendingCount).toBe(n);
    expect(claimed(win).total).toBe(n);
  });
});

describe("fenêtre orpheline — un flush perdu ne doit pas bloquer le canal", () => {
  it("passé ORPHAN_MS, on draine au lieu de tamponner indéfiniment", () => {
    const vieille = freshWindow(T0);
    const d = decideOnEvent(vieille, "Kelly", T0 + ORPHAN_MS + 1);
    expect(d.action).toBe("drain");
    expect(d.action === "drain" && d.state.pending).toEqual(["Kelly"]);
  });

  it("juste avant le seuil, on tamponne encore normalement", () => {
    const d = decideOnEvent(freshWindow(T0), "Kelly", T0 + ORPHAN_MS);
    expect(d.action).toBe("append");
  });

  it("le seuil orphelin est franchement plus large que la fenêtre", () => {
    expect(ORPHAN_MS).toBeGreaterThan(WINDOW_MS);
  });
});

// ─── LA COURSE : une soumission qui arrive PILE à la fermeture ───────────────
//
// Petit simulateur déterministe. Les mutations Convex sont SÉRIALISABLES : la
// revendication (lecture + suppression) est UNE transaction, donc elle s'engage
// soit entièrement avant l'ajout, soit entièrement après. On rejoue les deux
// ordonnancements et on exige qu'AUCUNE ligne ne se perde ni ne parte deux fois.

type Store = { win: WindowState | null };

/** Arrivée d'un événement. Rend ce qui part IMMÉDIATEMENT (0 ou 1 ligne). */
function onEvent(store: Store, line: string, now: number): string[] {
  const d = decideOnEvent(store.win, line, now);
  if (d.action === "open") {
    store.win = freshWindow(now);
    return [line]; // front montant
  }
  store.win = d.state;
  return [];
}

/** Flush ATOMIQUE : lecture ET suppression dans la même transaction. */
function claimAtomic(store: Store): string[] {
  const c = claimed(store.win);
  store.win = null;
  return c.lines;
}

describe("course à la fermeture de fenêtre — aucune ligne perdue", () => {
  /** Prépare : A ouvre la fenêtre et part ; B est tamponnée. */
  function amorce(): { store: Store; envoyes: string[] } {
    const store: Store = { win: null };
    const envoyes: string[] = [];
    envoyes.push(...onEvent(store, "A", T0));
    envoyes.push(...onEvent(store, "B", T0 + 100));
    return { store, envoyes };
  }

  it("ordonnancement 1 — le flush s'engage AVANT la soumission C", () => {
    const { store, envoyes } = amorce();
    envoyes.push(...claimAtomic(store)); // B part dans le groupé
    envoyes.push(...onEvent(store, "C", T0 + WINDOW_MS)); // fenêtre disparue → C ouvre et part

    expect(envoyes.sort()).toEqual(["A", "B", "C"]);
    // C a ouvert une NOUVELLE fenêtre : c'est le comportement correct, elle est
    // hors de la fenêtre précédente.
    expect(store.win).not.toBeNull();
    expect(claimAtomic(store)).toEqual([]);
  });

  it("ordonnancement 2 — la soumission C s'engage AVANT le flush", () => {
    const { store, envoyes } = amorce();
    envoyes.push(...onEvent(store, "C", T0 + WINDOW_MS)); // fenêtre encore là → C tamponnée
    envoyes.push(...claimAtomic(store)); // B ET C partent dans le groupé

    expect(envoyes.sort()).toEqual(["A", "B", "C"]);
    expect(store.win).toBeNull();
  });

  it("quel que soit l'ordre, chaque ligne part EXACTEMENT une fois", () => {
    for (const flushDabord of [true, false]) {
      const { store, envoyes } = amorce();
      if (flushDabord) {
        envoyes.push(...claimAtomic(store));
        envoyes.push(...onEvent(store, "C", T0 + WINDOW_MS));
      } else {
        envoyes.push(...onEvent(store, "C", T0 + WINDOW_MS));
        envoyes.push(...claimAtomic(store));
      }
      envoyes.push(...claimAtomic(store)); // flush de la fenêtre éventuellement rouverte
      expect(envoyes.sort()).toEqual(["A", "B", "C"]);
      expect(new Set(envoyes).size).toBe(envoyes.length); // aucun doublon
    }
  });

  it("une rafale entière traverse la course sans perte", () => {
    const store: Store = { win: null };
    const envoyes: string[] = [];
    const lignes = Array.from({ length: 12 }, (_, i) => `L${i}`);
    // 6 avant la fermeture, flush, 6 après.
    for (const l of lignes.slice(0, 6)) {
      envoyes.push(...onEvent(store, l, T0 + 1_000));
    }
    envoyes.push(...claimAtomic(store));
    for (const l of lignes.slice(6)) {
      envoyes.push(...onEvent(store, l, T0 + WINDOW_MS + 1_000));
    }
    envoyes.push(...claimAtomic(store));

    expect(envoyes.sort()).toEqual([...lignes].sort());
  });
});

describe("pourquoi la revendication doit être ATOMIQUE", () => {
  /**
   * Version NAÏVE, volontairement fautive : lecture puis suppression en DEUX
   * temps (ce que donnerait un runQuery suivi d'un runMutation depuis l'action).
   * Ce test EXISTE pour montrer ce que le design évite — si quelqu'un
   * « simplifie » claimWindow en deux étapes, il réintroduit cette perte.
   */
  function claimEnDeuxTemps(store: Store): {
    lu: string[];
    supprimer: () => void;
  } {
    const lu = claimed(store.win).lines;
    return {
      lu,
      supprimer: () => {
        store.win = null;
      },
    };
  }

  it("un ajout intercalé entre la lecture et la suppression SERAIT perdu", () => {
    const store: Store = { win: null };
    const envoyes: string[] = [];
    envoyes.push(...onEvent(store, "A", T0)); // ouvre + part
    envoyes.push(...onEvent(store, "B", T0 + 100)); // tamponnée

    const { lu, supprimer } = claimEnDeuxTemps(store);
    envoyes.push(...onEvent(store, "C", T0 + 150)); // s'insère : écrit dans un doc condamné
    supprimer();
    envoyes.push(...lu);

    expect(envoyes.sort()).toEqual(["A", "B"]);
    expect(envoyes).not.toContain("C"); // ← la perte que l'atomicité évite
  });

  it("… là où la version atomique ne perd rien sur la même séquence", () => {
    const store: Store = { win: null };
    const envoyes: string[] = [];
    envoyes.push(...onEvent(store, "A", T0));
    envoyes.push(...onEvent(store, "B", T0 + 100));
    envoyes.push(...onEvent(store, "C", T0 + 150));
    envoyes.push(...claimAtomic(store));

    expect(envoyes.sort()).toEqual(["A", "B", "C"]);
  });
});
