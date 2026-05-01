"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
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
import {
  CalendarIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  Loader2Icon,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
const COMPTES = [
  "@compte_1",
  "@compte_2",
  "@compte_3",
  "@compte_4",
  "@compte_5",
  "@compte_6",
  "@instagram_main",
];
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
const PLATEFORMES = ["TikTok", "Instagram"] as const;

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

  const [mode, setMode] = useState<Mode>("biblio");
  const [selectedHookId, setSelectedHookId] = useState<Id<"hooks"> | null>(
    initialHookId as Id<"hooks"> | null,
  );

  const [customText, setCustomText] = useState("");
  const [customMecanique, setCustomMecanique] = useState<string>("Erreur");
  const [customNiveau, setCustomNiveau] = useState<string>("Broad-A");
  const [customLangue, setCustomLangue] = useState<string>("FR");

  const [format, setFormat] = useState<string>("A");
  const [angle, setAngle] = useState<string>("Psycho");
  const [nbSlides, setNbSlides] = useState(7);
  const [slides, setSlides] = useState<string[]>(Array(7).fill(""));
  const [plateformes, setPlateformes] = useState<string[]>([
    "TikTok",
    "Instagram",
  ]);
  const [compte, setCompte] = useState(COMPTES[0]);
  const [datePubli, setDatePubli] = useState<Date>(new Date());
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const allHooks = useQuery(api.hooks.listHooks, {});
  const nextCarouselId = useQuery(api.publications.getNextCarouselId);
  const createPub = useMutation(api.publications.createPublication);

  const selectedHook = useMemo(() => {
    if (!allHooks || !selectedHookId) return null;
    return allHooks.find((h) => h._id === selectedHookId) ?? null;
  }, [allHooks, selectedHookId]);

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
    if (!nextCarouselId) {
      toast.error("Carousel ID pas encore prêt, attends une seconde…");
      return;
    }

    const hookId = mode === "biblio" ? selectedHookId : null;
    const mecanique =
      mode === "biblio" ? selectedHook!.mecanique : customMecanique;
    const niveau = mode === "biblio" ? selectedHook!.niveau : customNiveau;
    const langue = mode === "biblio" ? selectedHook!.langue : customLangue;

    setSubmitting(true);
    try {
      await createPub({
        carouselId: nextCarouselId,
        hookId,
        hookText,
        mecanique: mecanique as (typeof MECANIQUES)[number],
        niveau: niveau as (typeof NIVEAUX)[number],
        format: format as (typeof FORMATS)[number]["value"],
        nbSlides,
        slides: slides.map((texte, i) => ({ position: i + 1, texte })),
        angleTonal: angle as (typeof ANGLES)[number],
        langue: langue as (typeof LANGUES)[number],
        plateformes: plateformes as (typeof PLATEFORMES)[number][],
        compte,
        datePubli: datePubli.getTime(),
        notes,
      });
      toast.success(
        `Carrousel ${nextCarouselId} créé sur ${plateformes.length} plateforme${plateformes.length > 1 ? "s" : ""}`,
      );
      router.push("/tracker");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de la création");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 pb-24">
      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Nouveau carrousel
        </h1>
        <p className="text-sm text-slate-500">
          Carousel ID auto-attribué :{" "}
          <span className="font-mono font-medium text-slate-900">
            {nextCarouselId ?? "…"}
          </span>
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>1. Hook</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList>
              <TabsTrigger value="biblio">Bibliothèque</TabsTrigger>
              <TabsTrigger value="custom">Custom</TabsTrigger>
            </TabsList>

            <TabsContent value="biblio" className="mt-4 space-y-3">
              <HookCombobox
                hooks={allHooks}
                value={selectedHookId}
                onChange={setSelectedHookId}
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
                <Label htmlFor="custom-text">Texte du hook</Label>
                <Textarea
                  id="custom-text"
                  rows={2}
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  placeholder="Tape ton hook custom..."
                />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
                  <Select value={customNiveau} onValueChange={(v) => v !== null && setCustomNiveau(v)}>
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
                <div className="space-y-1.5">
                  <Label>Langue</Label>
                  <Select value={customLangue} onValueChange={(v) => v !== null && setCustomLangue(v)}>
                    <SelectTrigger>
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
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Format & Angle</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
          <div className="space-y-1.5">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Slides</CardTitle>
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

      <Card>
        <CardHeader>
          <CardTitle>4. Publication</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Plateformes</Label>
            <div className="flex gap-4 pt-2">
              {PLATEFORMES.map((p) => (
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
            <Select value={compte} onValueChange={(v) => v !== null && setCompte(v)}>
              <SelectTrigger>
                <SelectValue>{compte}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {COMPTES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          Créer le carrousel
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
