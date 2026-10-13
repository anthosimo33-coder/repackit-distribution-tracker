"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { DicesIcon, DownloadIcon, FlaskConicalIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { nomExportValide, type Bible } from "@/convex/scenarioBible";
import { genererConversation, statsConversation, statsTexte } from "@/convex/scenarioEngine";
import { parisDayKey } from "@/convex/viewsDaily";
import { ecranChocPng } from "@/components/scenarios/ecranChoc";
import { blobTexte, blobZip, enregistrer } from "@/components/scenarios/telechargement";

/** Les trois fichiers d'un test, tels que les boutons les enregistrent. */
function telecharger(r: Resultat, quoi: "txt" | "zip" | "png") {
  if (quoi === "txt") enregistrer(blobTexte(r.texte), r.nomFichier);
  else if (quoi === "zip") enregistrer(blobZip(r.texte), r.nomZip);
  else enregistrer(r.png, `${r.nomFichier.replace(/\.txt$/, "")} - ecran choc.png`);
}

type Resultat = {
  stats: string;
  texte: string;
  nomFichier: string;
  nomZip: string;
  png: Blob;
  apercu: string;
  decalageJours: number;
  messages: number;
};

/**
 * « TESTER » un scénario : un prénom → la conv générée, ses stats, l'écran choc
 * et les fichiers à télécharger. Tout tourne dans le navigateur (moteur pur,
 * dessin Canvas) : rien n'est écrit, et on peut tester une bible pas encore
 * enregistrée.
 *
 * Par défaut la conv FINIT AUJOURD'HUI (option A : BLUSH compare les messages
 * au jour de l'import) ; « dates de la bible » rend la conv telle qu'écrite, ce
 * qui permet de la comparer au moteur Python.
 *
 * `auto` : un lien de l'outil MCP `tester_scenario` — les réglages sont repris,
 * la conv se génère à l'ouverture et, s'il le demande, le fichier s'enregistre
 * aussitôt ; `onAutoFait` retire alors le paramètre (un rechargement ne
 * retélécharge pas).
 */
export type TestAuto = {
  prenom: string;
  graine: number;
  datesBible: boolean;
  telecharger: "txt" | "zip" | "png" | null;
};

export function ScenarioTesteur({
  bible,
  auto = null,
  onAutoFait,
}: {
  bible: Bible | null;
  auto?: TestAuto | null;
  onAutoFait?: () => void;
}) {
  const tr = useTranslations("admin.scripts.ScenarioTesteur");
  const [prenom, setPrenom] = useState(auto?.prenom ?? "Kelly");
  const [graine, setGraine] = useState(auto?.graine ?? 7);
  const [aujourdhui, setAujourdhui] = useState(!(auto?.datesBible ?? false));
  const [busy, setBusy] = useState(false);
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [echec, setEchec] = useState(false);

  // L'aperçu est une URL d'objet : la rendre à la mémoire quand il change.
  useEffect(() => () => {
    if (resultat) URL.revokeObjectURL(resultat.apercu);
  }, [resultat]);

  const prenomOk = nomExportValide(prenom);

  async function generer(
    b: Bible,
    reglages: { prenom: string; graine: number; aujourdhui: boolean },
  ): Promise<Resultat | null> {
    setBusy(true);
    setEchec(false);
    try {
      const gen = genererConversation(b, {
        prenom: reglages.prenom.trim(),
        graine: reglages.graine,
        ...(reglages.aujourdhui ? { finLe: parisDayKey(Date.now()) } : {}),
      });
      const stats = statsConversation(gen, [b.mot_a_vous.mot]);
      const png = await ecranChocPng({ texte: gen.texte, prenom: gen.noms.L, lui: gen.noms.Y });
      const r = {
        stats: statsTexte(b, gen, stats),
        texte: gen.texte,
        nomFichier: gen.nomFichier,
        nomZip: gen.nomZip,
        png,
        apercu: URL.createObjectURL(png),
        decalageJours: gen.decalageJours,
        messages: stats.messages,
      };
      setResultat(r);
      return r;
    } catch {
      setEchec(true);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function tester() {
    if (!bible || !prenomOk) return;
    await generer(bible, { prenom, graine, aujourdhui });
  }

  // Lien de `tester_scenario` : une seule fois, dès que la bible est lue. La
  // dernière version des fonctions est gardée dans une ref (cf AutoExport de
  // components/admin/insta-conv/ConvStudio.tsx).
  const autoRef = useRef({ generer, onAutoFait });
  useEffect(() => {
    autoRef.current = { generer, onAutoFait };
  });
  const autoFait = useRef(false);
  useEffect(() => {
    if (!auto || !bible || autoFait.current || !nomExportValide(auto.prenom)) return;
    autoFait.current = true;
    window.setTimeout(async () => {
      const r = await autoRef.current.generer(bible, {
        prenom: auto.prenom,
        graine: auto.graine,
        aujourdhui: !auto.datesBible,
      });
      if (r && auto.telecharger) telecharger(r, auto.telecharger);
      autoRef.current.onAutoFait?.();
    }, 300);
  }, [auto, bible]);

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          <FlaskConicalIcon className="size-4" />
          {tr("titre")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="testeur-prenom">{tr("prenom")}</Label>
            <Input
              id="testeur-prenom"
              value={prenom}
              onChange={(e) => setPrenom(e.target.value)}
              aria-invalid={!prenomOk}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="testeur-graine">{tr("graine")}</Label>
            <div className="flex gap-2">
              <Input
                id="testeur-graine"
                type="number"
                inputMode="numeric"
                value={graine}
                onChange={(e) => setGraine(Math.trunc(Number(e.target.value) || 0))}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setGraine(Math.floor(Math.random() * 1_000_000))}
                title={tr("autreConv")}
                aria-label={tr("autreConv")}
              >
                <DicesIcon className="size-4" />
              </Button>
            </div>
          </div>
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-slate-700">{tr("dates")}</legend>
          <div className="flex flex-wrap gap-2">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                aria-pressed={aujourdhui === v}
                onClick={() => setAujourdhui(v)}
                className={cn(
                  "h-8 rounded-full border px-3 text-xs font-medium transition-colors",
                  aujourdhui === v
                    ? "border-transparent bg-primary/10 text-primary"
                    : "border-slate-200 bg-white text-slate-600 hover:text-slate-900",
                )}
              >
                {v ? tr("finirAujourdhui") : tr("datesBible")}
              </button>
            ))}
          </div>
        </fieldset>
        <Button onClick={tester} disabled={!bible || !prenomOk || busy} data-testid="scenario-tester">
          {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
          {tr("tester")}
        </Button>
        {!bible && <p className="text-xs text-slate-400">{tr("bibleInvalide")}</p>}
        {echec && (
          <p className="text-sm text-rose-600" role="alert">
            {tr("echec")}
          </p>
        )}

        {resultat && (
          <div className="space-y-4" data-testid="scenario-resultat">
            <p className="text-xs text-slate-500">
              {resultat.decalageJours === 0
                ? tr("datesTellesQuelles")
                : tr("decalage", { jours: resultat.decalageJours })}
            </p>
            <pre
              className="overflow-x-auto whitespace-pre rounded-md bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100"
              data-testid="scenario-stats"
            >
              {resultat.stats}
            </pre>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => telecharger(resultat, "txt")}
                data-testid="telecharger-txt"
              >
                <DownloadIcon className="mr-2 size-4" />
                {tr("telechargerTxt")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => telecharger(resultat, "zip")}
                data-testid="telecharger-zip"
              >
                <DownloadIcon className="mr-2 size-4" />
                {tr("telechargerZip")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => telecharger(resultat, "png")}
                data-testid="telecharger-png"
              >
                <DownloadIcon className="mr-2 size-4" />
                {tr("telechargerPng")}
              </Button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- aperçu d'un blob local, pas une image du site */}
            <img
              src={resultat.apercu}
              alt={tr("apercuEcran")}
              className="mx-auto w-full max-w-[280px] rounded-xl border border-slate-200 shadow-sm"
              data-testid="scenario-ecran"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
