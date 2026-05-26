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
 * Période d'âge de snapshot sélectionnée GLOBALEMENT (J+1 … Latest / Custom).
 * Pilote les métriques affichées (displayMetrics) et le verdict partout
 * (dashboard, tracker, analytics, biblio-hooks). Persisté en localStorage.
 *
 * ⚠️ À ne pas confondre avec ChartPeriodToggle (fenêtre glissante de l'axe X
 * du graphe d'évolution).
 */

const STORAGE_KEY = "tracker.snapshot-age";
const DEFAULT_CUSTOM_DAY = 7;

type SnapshotAgeState = { age: SnapshotAge; customDay: number };

type SnapshotAgeContextValue = SnapshotAgeState & {
  setAge: (age: SnapshotAge, customDay?: number) => void;
  setCustomDay: (day: number) => void;
};

const SnapshotAgeContext = createContext<SnapshotAgeContextValue | null>(null);

function readStored(): SnapshotAgeState {
  if (typeof window === "undefined") {
    return { age: "latest", customDay: DEFAULT_CUSTOM_DAY };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
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

export function SnapshotAgeProvider({ children }: { children: ReactNode }) {
  // Default "latest" sur le 1er rendu (serveur + hydratation) puis lecture
  // localStorage après mount → pas de mismatch d'hydratation.
  const [state, setState] = useState<SnapshotAgeState>({
    age: "latest",
    customDay: DEFAULT_CUSTOM_DAY,
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(readStored());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

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
