"use client";

import { useMemo, type Dispatch } from "react";
import { useQuery } from "convex/react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HookCombobox } from "../HookCombobox";
import { SourceIdCombobox } from "@/components/shorts/SourceIdCombobox";
import { SourceStatusBadge } from "@/components/shorts/SourceStatusBadge";
import { cn } from "@/lib/utils";
import type {
  Langue,
  NouveauAction,
  NouveauData,
} from "../useNouveauState";

const LANGUES: Langue[] = ["FR", "EN"];

/**
 * StepHook — étape 2 du modal. Tabs Bibliothèque / Custom.
 *
 * Bibliothèque : toggle FR/EN + HookCombobox (extrait commun).
 * Custom : Textarea + Select langue.
 *
 * P10 — l'outillage éditorial interne (mécanique/niveau) n'est plus exposé
 * dans l'UI. Les champs restent en base (défauts du reducer customHook), ce
 * composant n'en propose plus la saisie ni l'affichage.
 *
 * Le pre-fill du target (slide 1 / script) avec le hook texte est géré
 * dans NouveauModal via un useEffect au state.data.hookId/customHook.text
 * change — pas dans ce composant.
 */
export function StepHook({
  data,
  dispatch,
}: {
  data: NouveauData;
  dispatch: Dispatch<NouveauAction>;
}) {
  const allHooks = useProjectQuery(api.hooks.listHooks, {});

  const biblioFiltered = useMemo(
    () => allHooks?.filter((h) => h.langue === data.biblioLangue) ?? undefined,
    [allHooks, data.biblioLangue],
  );

  const selectedHook = useMemo(
    () => allHooks?.find((h) => h._id === data.hookId) ?? null,
    [allHooks, data.hookId],
  );

  // Short — affiche en tête le bloc Source (anti-shadowban). Le hook se réduit
  // à texte + langue (mécanique/niveau ne sont plus exposés, cf P10).
  const isShort = data.mediaType === "short";

  return (
    <div className="space-y-3">
      {/* Anti-shadowban Shorts — Source du Short (required). En tête, avant le
          hook, car c'est l'identité du fichier source qui pilote toute la
          validation cross-plateforme. */}
      {isShort && (
        <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
          <Label htmlFor="source-id-combobox">
            Source (nom de fichier Drive){" "}
            <span className="text-rose-500">*</span>
          </Label>
          <SourceIdCombobox
            value={data.sourceId}
            onChange={(v) =>
              dispatch({ type: "SET_SOURCE_ID", sourceId: v })
            }
            required
          />
          {data.sourceId.trim() !== "" && (
            <SourceStatusBadge sourceId={data.sourceId} />
          )}
        </div>
      )}

      <Tabs
        value={data.hookMode}
        onValueChange={(v) =>
          v !== null &&
          dispatch({ type: "SET_HOOK_MODE", mode: v as "biblio" | "custom" })
        }
      >
        <TabsList>
          <TabsTrigger value="biblio">Bibliothèque</TabsTrigger>
          <TabsTrigger value="custom">Custom</TabsTrigger>
        </TabsList>

        <TabsContent value="biblio" className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Langue
            </span>
            <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
              {LANGUES.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => {
                    if (l !== data.biblioLangue) {
                      dispatch({ type: "SET_BIBLIO_LANGUE", langue: l });
                      dispatch({ type: "SET_HOOK_ID", hookId: null });
                    }
                  }}
                  className={cn(
                    "rounded px-3 py-1 text-xs font-semibold transition-colors",
                    data.biblioLangue === l
                      ? "bg-primary text-primary-foreground"
                      : "text-slate-600 hover:text-slate-900",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <HookCombobox
            hooks={biblioFiltered}
            value={data.hookId}
            onChange={(id: Id<"hooks">) =>
              dispatch({ type: "SET_HOOK_ID", hookId: id })
            }
          />
          {selectedHook && (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-medium text-slate-800">{selectedHook.text}</p>
              <div className="flex gap-1.5">
                <Badge variant="outline">{selectedHook.langue}</Badge>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="custom" className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label>Langue</Label>
            <Select
              value={data.customHook.langue}
              onValueChange={(v) =>
                v !== null &&
                dispatch({
                  type: "SET_CUSTOM_HOOK",
                  patch: { langue: v as Langue },
                })
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue>{data.customHook.langue}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {LANGUES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="custom-text">Texte du hook</Label>
            <Textarea
              id="custom-text"
              rows={2}
              value={data.customHook.text}
              onChange={(e) =>
                dispatch({
                  type: "SET_CUSTOM_HOOK",
                  patch: { text: e.target.value },
                })
              }
              placeholder="Tape ton hook custom..."
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
