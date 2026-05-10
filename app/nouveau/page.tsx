"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { fr } from "date-fns/locale";
import {
  CalendarIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  Loader2Icon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ALLOWED_PLATFORMS_FOR_CAROUSEL,
  ALLOWED_PLATFORMS_FOR_SHORT,
  isFormatAllowedOnPlatform,
  type MediaType,
} from "@/lib/media-type";
import { toast } from "sonner";

const FORMATS = [
  { value: "A", label: "A · X erreurs / mythes / vérités" },
  { value: "B", label: "B · Volume analysé" },
  { value: "C", label: "C · Comparaison A vs B" },
  { value: "D", label: "D · Comprendre pourquoi tu cliques (framework vulgarisé)" },
  { value: "E", label: "E · Pourquoi cette vidéo a cartonné" },
  { value: "F", label: "F · Pop culture / Lien improbable" },
  { value: "G", label: "G · Même créateur, 2 vidéos opposées" },
  { value: "H", label: "H · Coulisses / Build in public" },
] as const;

const ANGLES = [
  "Psycho",
  "Accusatoire",
  "Pédagogique",
  "Observation",
  "Provocant",
] as const;
const MECANIQUES = [
  "Erreur",
  "Volume",
  "Comparaison",
  "Contradiction",
  "Universalité",
  "Question",
] as const;
const NIVEAUX = ["Broad-A", "Broad-B", "Niché"] as const;
const LANGUES = ["FR", "EN"] as const;
// Type uniquement (cast d'args dans createPub). Les listes affichées
// (checkboxes) dépendent de allowedPlatforms calculé selon mediaType
// — cf ALLOWED_PLATFORMS_FOR_CAROUSEL/SHORT depuis lib/media-type.ts.
type Plateforme = "TikTok" | "Instagram" | "YouTube";

type Mode = "biblio" | "custom";

export default function NouveauPage() {
  return (
    <Suspense
      fallback={
        <div className="text-sm text-slate-500">Chargement du formulaire…</div>
      }
    >
      <NouveauForm />
    </Suspense>
  );
}

function NouveauForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialHookId = searchParams.get("hookId");

  // Batch 2 Modif 3 — toggle Format. Default "carousel" pour préserver le
  // comportement existant (e2e specs ciblant les Carrousels via le default).
  const [mediaType, setMediaType] = useState<MediaType>("carousel");

  const [mode, setMode] = useState<Mode>("biblio");
  const [selectedHookId, setSelectedHookId] = useState<Id<"hooks"> | null>(
    initialHookId as Id<"hooks"> | null,
  );
  const [biblioLangue, setBiblioLangue] = useState<"FR" | "EN">("FR");

  const [customText, setCustomText] = useState("");
  const [customMecanique, setCustomMecanique] = useState<string>("Erreur");
  const [customNiveau, setCustomNiveau] = useState<string>("Broad-A");
  const [customLangue, setCustomLangue] = useState<string>("FR");

  const [format, setFormat] = useState<string>("A");
  const [angle, setAngle] = useState<string>("Psycho");
  const [nbSlides, setNbSlides] = useState(7);
  const [slides, setSlides] = useState<string[]>(Array(7).fill(""));
  // Batch 2 Modif 3 — script Short, parallèle à slides[]. State indépendant
  // pour permettre à l'utilisateur de switcher carousel ↔ short sans perdre
  // le travail saisi côté slides ; symétrique côté script.
  const [script, setScript] = useState<string>("");

  const [plateformes, setPlateformes] = useState<string[]>([
    "TikTok",
    "Instagram",
  ]);
  const [compte, setCompte] = useState<string>("");
  const [datePubli, setDatePubli] = useState<Date>(new Date());
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Plateformes éligibles selon le mediaType (carousel = TikTok+Instagram ;
  // short = les 3). Pilote l'affichage des checkboxes dans la Card
  // Publication. La validation serveur (createPublication) reste l'autorité.
  const allowedPlatforms = useMemo<readonly string[]>(
    () =>
      mediaType === "carousel"
        ? ALLOWED_PLATFORMS_FOR_CAROUSEL
        : ALLOWED_PLATFORMS_FOR_SHORT,
    [mediaType],
  );

  const allHooks = useQuery(api.hooks.listHooks, {});
  // Filtered list shown in the combobox; biblioLangue defaults to FR but auto-syncs
  // to the selected hook's langue (e.g. when arriving via ?hookId= for an EN hook).
  const biblioFilteredHooks = useMemo(
    () => allHooks?.filter((h) => h.langue === biblioLangue) ?? undefined,
    [allHooks, biblioLangue],
  );
  const comptesData = useQuery(api.comptes.listComptes, { actifOnly: true });
  const filteredComptes = useMemo(() => {
    if (!comptesData) return [];
    return comptesData.filter((c) => plateformes.includes(c.plateforme));
  }, [comptesData, plateformes]);

  // Reset compte if it no longer matches selected plateformes
  useEffect(() => {
    if (!comptesData) return;
    const current = comptesData.find((c) => c.handle === compte);
    if (compte && (!current || !plateformes.includes(current.plateforme))) {
      setCompte("");
    } else if (!compte && filteredComptes.length > 0) {
      setCompte(filteredComptes[0].handle);
    }
  }, [comptesData, plateformes, compte, filteredComptes]);

  // Effective plateformes = intersection of selected plateformes and the compte's plateforme
  const selectedCompteData = comptesData?.find((c) => c.handle === compte);
  const effectivePlateformes = selectedCompteData
    ? plateformes.filter((p) => p === selectedCompteData.plateforme)
    : [];
  const missingPlateformes = selectedCompteData
    ? plateformes.filter((p) => p !== selectedCompteData.plateforme)
    : [];
  const nextCarouselId = useQuery(api.publications.getNextCarouselId);
  const createPub = useMutation(api.publications.createPublication);

  const selectedHook = useMemo(() => {
    if (!allHooks || !selectedHookId) return null;
    return allHooks.find((h) => h._id === selectedHookId) ?? null;
  }, [allHooks, selectedHookId]);

  // If the user arrives with a ?hookId= for a hook in the other langue,
  // sync the toggle so the combobox list matches.
  useEffect(() => {
    if (selectedHook && selectedHook.langue !== biblioLangue) {
      setBiblioLangue(selectedHook.langue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHook?._id]);

  // Pre-fill du target (slide 1 ou script) avec le texte du hook sélectionné.
  // Politique d'écrasement : n'écrire que si le target est vide (préserve les
  // éditions manuelles). Pour une sélection au clic, géré dans
  // handleHookSelect / handleCustomTextChange (handler-based, pas d'effect).
  // Pour le cas d'arrivée via URL ?hookId= où la sélection est déjà active
  // au mount mais le hook n'est chargé qu'après résolution de Convex, on a
  // besoin d'un useEffect — ce n'est pas évitable sans refactor majeur
  // (allHooks est async). Concession : 1 useEffect avec un useRef pour ne
  // run qu'une seule fois après le premier load. Idempotent.
  // Batch 2 Modif 3 : branche selon mediaType courant au moment du run.
  const initialSeedDone = useRef(false);
  useEffect(() => {
    if (initialSeedDone.current) return;
    if (!selectedHook) return;
    initialSeedDone.current = true;
    if (mediaType === "carousel") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSlides((prev) =>
        prev[0] === "" ? [selectedHook.text, ...prev.slice(1)] : prev,
      );
    } else {
      // 2e setState dans le même effect : la règle est déjà silenced par
      // le eslint-disable de la branche carousel (un seul report par effect).
      setScript((prev) => (prev === "" ? selectedHook.text : prev));
    }
  }, [selectedHook, mediaType]);

  function handleHookSelect(id: Id<"hooks">) {
    setSelectedHookId(id);
    const hook = allHooks?.find((h) => h._id === id);
    if (!hook) return;
    if (mediaType === "carousel") {
      setSlides((prev) =>
        prev[0] === "" ? [hook.text, ...prev.slice(1)] : prev,
      );
    } else {
      setScript((prev) => (prev === "" ? hook.text : prev));
    }
  }

  function handleCustomTextChange(value: string) {
    setCustomText(value);
    if (mediaType === "carousel") {
      setSlides((prev) =>
        prev[0] === "" ? [value, ...prev.slice(1)] : prev,
      );
    } else {
      setScript((prev) => (prev === "" ? value : prev));
    }
  }

  // Switch Carousel ↔ Short. Reset des plateformes incohérentes (ex :
  // short→carousel avec YouTube coché → on retire YouTube). Pre-fill
  // idempotent du target nouvellement sélectionné si un hook ou un
  // customText est déjà choisi : l'utilisateur s'attend à voir son hook
  // pré-rempli après le switch sans avoir à re-cliquer.
  function handleMediaTypeChange(next: MediaType) {
    if (next === mediaType) return;
    setMediaType(next);
    setPlateformes((prev) =>
      prev.filter((p) => isFormatAllowedOnPlatform(next, p)),
    );
    const sourceText =
      mode === "biblio" ? (selectedHook?.text ?? "") : customText.trim();
    if (sourceText) {
      if (next === "carousel") {
        setSlides((prev) =>
          prev[0] === "" ? [sourceText, ...prev.slice(1)] : prev,
        );
      } else {
        setScript((prev) => (prev === "" ? sourceText : prev));
      }
    }
  }

  useEffect(() => {
    setSlides((prev) => {
      if (prev.length === nbSlides) return prev;
      if (prev.length < nbSlides) {
        return [...prev, ...Array(nbSlides - prev.length).fill("")];
      }
      return prev.slice(0, nbSlides);
    });
  }, [nbSlides]);

  function togglePlateforme(p: string) {
    setPlateformes((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  }

  async function handleSubmit() {
    const hookText =
      mode === "biblio" ? (selectedHook?.text ?? "") : customText.trim();
    if (!hookText) {
      toast.error("Hook requis");
      return;
    }
    if (plateformes.length === 0) {
      toast.error("Au moins une plateforme requise");
      return;
    }
    if (!compte) {
      toast.error("Compte requis");
      return;
    }
    if (effectivePlateformes.length === 0) {
      toast.error(
        "Le compte choisi ne couvre aucune des plateformes sélectionnées",
      );
      return;
    }
    // Defense in depth : valide cohérence mediaType / plateforme effective.
    // Carousel rejeté sur YouTube ; Short toujours OK (toutes plateformes).
    const invalidPlatform = effectivePlateformes.find(
      (p) => !isFormatAllowedOnPlatform(mediaType, p),
    );
    if (invalidPlatform) {
      const formatLabel = mediaType === "carousel" ? "Carrousels" : "Shorts";
      toast.error(`${formatLabel} non autorisés sur ${invalidPlatform}.`);
      return;
    }
    if (mediaType === "short" && script.trim().length === 0) {
      toast.error("Le script ne peut pas être vide.");
      return;
    }
    if (!nextCarouselId) {
      toast.error("ID pas encore prêt, attends une seconde…");
      return;
    }

    const hookId = mode === "biblio" ? selectedHookId : null;
    const mecanique =
      mode === "biblio" ? selectedHook!.mecanique : customMecanique;
    const niveau = mode === "biblio" ? selectedHook!.niveau : customNiveau;
    const langue = mode === "biblio" ? selectedHook!.langue : customLangue;

    setSubmitting(true);
    try {
      // Args communs aux 2 formats. Le payload format-spécifique (slides /
      // script) est ajouté juste avant l'appel selon mediaType.
      const baseArgs = {
        carouselId: nextCarouselId,
        hookId,
        hookText,
        mecanique: mecanique as (typeof MECANIQUES)[number],
        niveau: niveau as (typeof NIVEAUX)[number],
        angleTonal: angle as (typeof ANGLES)[number],
        langue: langue as (typeof LANGUES)[number],
        plateformes: effectivePlateformes as Plateforme[],
        compte,
        datePubli: datePubli.getTime(),
        notes,
        mediaType,
      };
      if (mediaType === "carousel") {
        await createPub({
          ...baseArgs,
          format: format as (typeof FORMATS)[number]["value"],
          nbSlides,
          slides: slides.map((texte, i) => ({ position: i + 1, texte })),
        });
      } else {
        await createPub({
          ...baseArgs,
          script: script.trim(),
        });
      }
      const formatLabel = mediaType === "carousel" ? "Carrousel" : "Short";
      toast.success(
        `${formatLabel} ${nextCarouselId} créé sur ${effectivePlateformes.length} plateforme${effectivePlateformes.length > 1 ? "s" : ""}`,
      );
      // Batch B — push direct vers la page format de la pub créée plutôt
      // que /tracker (qui n'existe plus, redirigé via next.config.ts). Évite
      // un hop 308. Conservé en string littéral plutôt que dérivé pour
      // garder le diff minimal.
      router.push(mediaType === "carousel" ? "/carrousels" : "/shorts");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de la création");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 pb-24">
      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          {mediaType === "short" ? "Nouveau Short" : "Nouveau carrousel"}
        </h1>
        <p className="text-sm text-slate-500">
          ID auto-attribué :{" "}
          <span className="font-mono font-medium text-slate-900">
            {nextCarouselId ?? "…"}
          </span>
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>1. Format</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs
            value={mediaType}
            onValueChange={(v) => handleMediaTypeChange(v as MediaType)}
          >
            <TabsList>
              <TabsTrigger value="carousel">Carrousel</TabsTrigger>
              <TabsTrigger value="short">Short</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Hook</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
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
                  {(["FR", "EN"] as const).map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => {
                        if (l !== biblioLangue) {
                          setBiblioLangue(l);
                          setSelectedHookId(null);
                        }
                      }}
                      className={cn(
                        "rounded px-3 py-1 text-xs font-semibold transition-colors",
                        biblioLangue === l
                          ? "bg-slate-900 text-white"
                          : "text-slate-600 hover:text-slate-900",
                      )}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <HookCombobox
                hooks={biblioFilteredHooks}
                value={selectedHookId}
                onChange={handleHookSelect}
              />
              {selectedHook && (
                <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p className="font-medium text-slate-800">
                    {selectedHook.text}
                  </p>
                  <div className="flex gap-1.5">
                    <Badge variant="secondary">{selectedHook.mecanique}</Badge>
                    <Badge variant="outline">{selectedHook.niveau}</Badge>
                    <Badge variant="outline">{selectedHook.langue}</Badge>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="custom" className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label>Langue</Label>
                <Select
                  value={customLangue}
                  onValueChange={(v) => v !== null && setCustomLangue(v)}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue>{customLangue}</SelectValue>
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
                  value={customText}
                  onChange={(e) => handleCustomTextChange(e.target.value)}
                  placeholder="Tape ton hook custom..."
                />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Mécanique</Label>
                  <Select
                    value={customMecanique}
                    onValueChange={(v) => v !== null && setCustomMecanique(v)}
                  >
                    <SelectTrigger>
                      <SelectValue>{customMecanique}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {MECANIQUES.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Niveau</Label>
                  <Select
                    value={customNiveau}
                    onValueChange={(v) => v !== null && setCustomNiveau(v)}
                  >
                    <SelectTrigger>
                      <SelectValue>{customNiveau}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {NIVEAUX.map((n) => (
                        <SelectItem key={n} value={n}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            3. {mediaType === "short" ? "Angle" : "Format & Angle"}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {mediaType === "carousel" && (
            <div className="space-y-1.5 md:col-span-2">
              <Label>Format</Label>
              <Select value={format} onValueChange={(v) => v !== null && setFormat(v)}>
                <SelectTrigger>
                  <SelectValue>
                    {FORMATS.find((f) => f.value === format)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {FORMATS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div
            className={cn(
              "space-y-1.5",
              mediaType === "short" && "md:col-span-3",
            )}
          >
            <Label>Angle tonal</Label>
            <Select value={angle} onValueChange={(v) => v !== null && setAngle(v)}>
              <SelectTrigger>
                <SelectValue>{angle}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ANGLES.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {mediaType === "carousel" && (
            <div className="space-y-1.5">
              <Label htmlFor="nb-slides">Nombre de slides</Label>
              <Input
                id="nb-slides"
                type="number"
                min={5}
                max={8}
                value={nbSlides}
                onChange={(e) =>
                  setNbSlides(
                    Math.max(5, Math.min(8, Number(e.target.value) || 5)),
                  )
                }
              />
            </div>
          )}
        </CardContent>
      </Card>

      {mediaType === "carousel" ? (
        <Card>
          <CardHeader>
            <CardTitle>4. Slides</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {slides.map((s, i) => (
              <div key={i} className="space-y-1.5">
                <Label htmlFor={`slide-${i}`}>Slide {i + 1}</Label>
                <Textarea
                  id={`slide-${i}`}
                  rows={2}
                  placeholder={`Texte de la slide ${i + 1}...`}
                  value={s}
                  onChange={(e) => {
                    const next = [...slides];
                    next[i] = e.target.value;
                    setSlides(next);
                  }}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>4. Script</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              <Label htmlFor="script">Script</Label>
              <Textarea
                id="script"
                rows={12}
                placeholder="Écris ton script complet — le hook reste pré-rempli en haut..."
                value={script}
                onChange={(e) => setScript(e.target.value)}
              />
              <p className="text-xs text-slate-500">
                Texte continu, pas de slides découpées. Saisis le texte
                intégral du Short.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>5. Publication</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Plateformes</Label>
            <div className="flex gap-4 pt-2">
              {allowedPlatforms.map((p) => (
                <label
                  key={p}
                  className="flex cursor-pointer items-center gap-2"
                >
                  <Checkbox
                    checked={plateformes.includes(p)}
                    onCheckedChange={() => togglePlateforme(p)}
                  />
                  <span className="text-sm">{p}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Compte</Label>
            {comptesData === undefined ? (
              <Skeleton className="h-9 w-full" />
            ) : filteredComptes.length === 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                Aucun compte actif sur les plateformes sélectionnées.{" "}
                <Link
                  href="/comptes"
                  className="font-medium underline underline-offset-2"
                >
                  Ajoute-en un
                </Link>
                .
              </div>
            ) : (
              <Select
                value={compte}
                onValueChange={(v) => v !== null && setCompte(v)}
              >
                <SelectTrigger>
                  <SelectValue>{compte || "Sélectionne un compte"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {filteredComptes.map((c) => (
                    <SelectItem key={c._id} value={c.handle}>
                      <span className="font-mono">{c.handle}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        {c.plateforme}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {selectedCompteData && missingPlateformes.length > 0 && (
              <p className="text-xs text-amber-700">
                Le compte{" "}
                <span className="font-mono">{selectedCompteData.handle}</span>{" "}
                n&apos;a pas de version {missingPlateformes.join(", ")}. La
                publication ne sera créée que sur{" "}
                {selectedCompteData.plateforme}.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Date de publication</Label>
            <Popover>
              <PopoverTrigger render={
                <Button
                  variant="outline"
                  className="w-full justify-start text-left font-normal"
                >
                  <CalendarIcon className="mr-2 size-4" />
                  {datePubli.toLocaleDateString("fr-FR", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  })}
                </Button>
              } />
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={datePubli}
                  onSelect={(d) => d && setDatePubli(d)}
                  locale={fr}
                  weekStartsOn={1}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              rows={2}
              placeholder="Optionnel..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="sticky bottom-4 flex justify-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-md">
        <Button
          variant="outline"
          onClick={() => router.push("/hooks")}
          disabled={submitting}
        >
          Annuler
        </Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
          Créer {mediaType === "short" ? "le Short" : "le carrousel"}
        </Button>
      </div>
    </div>
  );
}

function HookCombobox({
  hooks,
  value,
  onChange,
}: {
  hooks: Doc<"hooks">[] | undefined;
  value: Id<"hooks"> | null;
  onChange: (id: Id<"hooks">) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = hooks?.find((h) => h._id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between text-left font-normal"
        >
          <span className="truncate">
            {selected
              ? selected.text
              : "Sélectionne un hook de la bibliothèque..."}
          </span>
          <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      } />
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] max-w-[600px] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Cherche un hook..." />
          <CommandList>
            {hooks === undefined ? (
              <div className="space-y-2 p-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <>
                <CommandEmpty>Aucun hook trouvé.</CommandEmpty>
                <CommandGroup>
                  {hooks.map((h) => (
                    <CommandItem
                      key={h._id}
                      value={h.text}
                      onSelect={() => {
                        onChange(h._id);
                        setOpen(false);
                      }}
                    >
                      <CheckIcon
                        className={cn(
                          "mr-2 size-4",
                          value === h._id ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <div className="flex-1">
                        <div className="text-sm">{h.text}</div>
                        <div className="text-xs text-slate-500">
                          {h.mecanique} · {h.niveau} · {h.langue}
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
