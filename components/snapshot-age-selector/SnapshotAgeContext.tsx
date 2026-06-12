"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { coerceSnapshotAge, type SnapshotAge } from "@/lib/snapshot-matching";

/**
 * Période d'âge de snapshot sélectionnée par projet (J+1 … Latest / Custom).
 * Pilote les métriques affichées (displayMetrics) et le verdict partout
 * (dashboard, tracker, analytics, biblio-hooks). Persisté en localStorage.
 *
 * P3 Multi-tenant — la clé est SUFFIXÉE par le slug du projet
 * (`tracker.snapshot-age:<slug>`) : deux projets peuvent vivre à des périodes
 * différentes. Le provider est monté avec `key={slug}` dans le layout
 * `/admin/[projectSlug]`, donc remonté au changement de projet (relecture du
 * bon localStorage). `sidebar-collapsed` et les filterPresets restent globaux.
 *
 * ⚠️ À ne pas confondre avec ChartPeriodToggle (fenêtre glissante de l'axe X
 * du graphe d'évolution).
 */

const STORAGE_KEY_BASE = "tracker.snapshot-age";
const DEFAULT_CUSTOM_DAY = 7;

type SnapshotAgeState = { age: SnapshotAge; customDay: number };

type SnapshotAgeContextValue = SnapshotAgeState & {
  setAge: (age: SnapshotAge, customDay?: number) => void;
  setCustomDay: (day: number) => void;
};

const SnapshotAgeContext = createContext<SnapshotAgeContextValue | null>(null);

function readStored(storageKey: string): SnapshotAgeState {
  if (typeof window === "undefined") {
    return { age: "latest", customDay: DEFAULT_CUSTOM_DAY };
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return { age: "latest", customDay: DEFAULT_CUSTOM_DAY };
    const parsed = JSON.parse(raw) as Partial<SnapshotAgeState>;
    return {
      age: coerceSnapshotAge(parsed.age),
      customDay:
        typeof parsed.customDay === "number" && parsed.customDay >= 0
          ? parsed.customDay
          : DEFAULT_CUSTOM_DAY,
    };
  } catch {
    return { age: "latest", customDay: DEFAULT_CUSTOM_DAY };
  }
}

export function SnapshotAgeProvider({
  children,
  storageSuffix,
}: {
  children: ReactNode;
  /** Slug du projet courant → clé localStorage scopée. */
  storageSuffix?: string;
}) {
  const storageKey = storageSuffix
    ? `${STORAGE_KEY_BASE}:${storageSuffix}`
    : STORAGE_KEY_BASE;

  // Default "latest" sur le 1er rendu (serveur + hydratation) puis lecture
  // localStorage après mount → pas de mismatch d'hydratation.
  const [state, setState] = useState<SnapshotAgeState>({
    age: "latest",
    customDay: DEFAULT_CUSTOM_DAY,
  });
  // Garde d'hydratation : l'effet d'écriture ne doit PAS persister l'état par
  // défaut « latest » avant que l'effet de lecture ait restauré la valeur
  // stockée — sinon il écrase la clé au montage (race amplifiée par le
  // double-invoke des effets en StrictMode dev → la période ne survivait pas au
  // reload). `hydrated` (un state, pas un ref) garantit que le 1er passage de
  // l'effet d'écriture est sauté tant que la lecture n'a pas eu lieu.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(readStored(storageKey));
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  }, [storageKey, state, hydrated]);

  const setAge = useCallback((age: SnapshotAge, customDay?: number) => {
    setState((s) => ({ age, customDay: customDay ?? s.customDay }));
  }, []);

  const setCustomDay = useCallback((day: number) => {
    setState((s) => ({ ...s, customDay: day }));
  }, []);

  return (
    <SnapshotAgeContext.Provider value={{ ...state, setAge, setCustomDay }}>
      {children}
    </SnapshotAgeContext.Provider>
  );
}

export function useSnapshotAge(): SnapshotAgeContextValue {
  const ctx = useContext(SnapshotAgeContext);
  if (!ctx) {
    throw new Error("useSnapshotAge must be used within SnapshotAgeProvider");
  }
  return ctx;
}

/** Args sérialisés pour les queries Convex (snapshotAge + customDay si custom). */
export function snapshotQueryArgs(state: {
  age: SnapshotAge;
  customDay: number;
}): { snapshotAge: string; customDay?: number } {
  return {
    snapshotAge: state.age,
    customDay: state.age === "custom" ? state.customDay : undefined,
  };
}
