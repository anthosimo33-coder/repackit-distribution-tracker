"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  Loader2Icon,
  MonitorIcon,
  Share2Icon,
  SmartphoneIcon,
  XIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  SHARE_BLOCKS,
  blocksForAudience,
  type ShareBlock,
} from "@/convex/publicShare";
import type { PublicSharePayload } from "@/convex/publicShares";
import {
  useProjectMutation,
  useProjectQuery,
} from "@/components/project/use-project-convex";
import { FilterMultiSelect } from "@/components/filters/FilterMultiSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CopyButton } from "@/components/ui/CopyButton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConvexError } from "@/lib/use-convex-error";
import { cn } from "@/lib/utils";
import { PublicTrackerView } from "./PublicTrackerView";
import { ShareLinksSheet } from "./ShareLinksSheet";

type Audience = "brand" | "creator";
type PeriodPreset = "7" | "30" | "90" | "fixed" | "all";
type Expiry = "30" | "90" | "never";
type Warmup = "exclude" | "all" | "only";

const PLATFORMS = ["TikTok", "Instagram", "YouTube"] as const;

/**
 * MODE PARTAGE du Tracker — on règle un lien public SUR son rendu réel.
 *
 * L'aperçu n'est pas une maquette : c'est `PublicTrackerView` nourri par
 * `previewShare`, qui passe par la même projection serveur que la page
 * publique. Chaque œil ajoute ou retire un bloc de la configuration, et le
 * serveur renvoie ce que le lien montrera, ni plus ni moins.
 *
 * Le destinataire est choisi D'ABORD, parce qu'il décide du reste :
 *   - une marque → créatrices anonymisées par défaut, pas de liens vers les
 *     posts (l'URL porte le @handle) ;
 *   - une créatrice → périmètre verrouillé sur elle (côté serveur), pas de
 *     bloc « par créatrice ».
 */
export function TrackerShareMode({ onExit }: { onExit: () => void }) {
  const t = useTranslations("admin.dashboard.ShareMode");
  const errorText = useConvexError();

  const [audience, setAudience] = useState<Audience>("brand");
  const [creatorId, setCreatorId] = useState<string>("");
  const [preset, setPreset] = useState<PeriodPreset>("30");
  const [fixedFrom, setFixedFrom] = useState("");
  const [fixedTo, setFixedTo] = useState("");
  const [campaignIds, setCampaignIds] = useState<Set<string>>(new Set());
  const [plateformes, setPlateformes] = useState<Set<string>>(new Set());
  const [creatorIds, setCreatorIds] = useState<Set<string>>(new Set());
  const [warmup, setWarmup] = useState<Warmup>("exclude");
  const [blocks, setBlocks] = useState<Set<ShareBlock>>(new Set(SHARE_BLOCKS));
  const [showCreatorNames, setShowCreatorNames] = useState(false);
  const [postLinks, setPostLinks] = useState(false);
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<Expiry>("30");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ token: string } | null>(null);
  const [linksOpen, setLinksOpen] = useState(false);

  const creators = useProjectQuery(api.creators.listCreators, {});
  const campaigns = useProjectQuery(api.scripts.listCampaigns, {});
  const shares = useProjectQuery(api.publicShares.listShares, {});
  const createShare = useProjectMutation(api.publicShares.createShare);

  const creatorName =
    creators?.find((c) => (c._id as string) === creatorId)?.name ?? null;

  const period = useMemo(() => {
    if (preset === "all") return { kind: "all" as const };
    if (preset === "fixed") {
      if (!fixedFrom || !fixedTo) return null;
      return {
        kind: "fixed" as const,
        from: new Date(`${fixedFrom}T00:00:00`).getTime(),
        to: new Date(`${fixedTo}T23:59:59.999`).getTime(),
      };
    }
    return { kind: "rolling" as const, days: Number(preset) };
  }, [preset, fixedFrom, fixedTo]);

  const available = useMemo(() => blocksForAudience(SHARE_BLOCKS, audience), [audience]);
  const effectiveBlocks = useMemo(
    () => available.filter((b) => blocks.has(b)),
    [available, blocks],
  );

  const config = useMemo(() => {
    if (period === null) return null;
    if (audience === "creator" && creatorId === "") return null;
    return {
      audience,
      creatorId:
        audience === "creator" ? (creatorId as Id<"creators">) : undefined,
      perimeter: {
        period,
        creatorIds:
          audience === "brand" && creatorIds.size > 0
            ? ([...creatorIds] as Id<"creators">[])
            : undefined,
        plateformes:
          plateformes.size > 0
            ? ([...plateformes] as ("TikTok" | "Instagram" | "YouTube")[])
            : undefined,
        campaignIds:
          campaignIds.size > 0
            ? ([...campaignIds] as Id<"scriptCampaigns">[])
            : undefined,
        warmup,
      },
      blocks: effectiveBlocks,
      showCreatorNames: audience === "brand" && showCreatorNames,
      postLinks,
    };
  }, [
    period,
    audience,
    creatorId,
    creatorIds,
    plateformes,
    campaignIds,
    warmup,
    effectiveBlocks,
    showCreatorNames,
    postLinks,
  ]);

  const defaultName =
    audience === "creator"
      ? creatorName
        ? t("defaultNameCreator", { name: creatorName })
        : ""
      : t("defaultNameBrand");
  const finalName = name.trim() === "" ? defaultName : name.trim();

  const preview = useProjectQuery(
    api.publicShares.previewShare,
    // Le nom n'est PAS envoyé au serveur : il ne change rien aux données, et le
    // retaper relancerait toute la lecture à chaque frappe. Il est posé sur
    // l'aperçu ci-dessous, comme la page publique l'affichera.
    config === null ? "skip" : { config, name: "" },
  );
  // Pendant qu'une nouvelle configuration se calcule, on garde l'aperçu
  // précédent à l'écran : un œil cliqué ne doit pas faire clignoter la page.
  // Motif « état dérivé ajusté au rendu » (react.dev) : pas de ref lue au rendu.
  const [lastPreview, setLastPreview] = useState<PublicSharePayload | null>(null);
  if (preview !== undefined && preview !== lastPreview) setLastPreview(preview);
  if (config === null && lastPreview !== null) setLastPreview(null);
  const last = preview ?? lastPreview;
  const shown = last === null ? null : { ...last, name: finalName };

  function toggleBlock(b: ShareBlock) {
    setBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });
  }

  function chooseAudience(a: Audience) {
    setAudience(a);
    setName("");
    // Défauts de l'audience : une créatrice ouvre ses propres posts, une marque
    // ne reçoit pas d'URL qui porte le @handle des comptes.
    setPostLinks(a === "creator");
    setShowCreatorNames(false);
  }

  async function create() {
    if (config === null || effectiveBlocks.length === 0) return;
    setCreating(true);
    try {
      const res = await createShare({
        ...config,
        name: finalName,
        expiresInDays: expiry === "never" ? undefined : Number(expiry),
      });
      setCreated({ token: res.token });
    } catch (e) {
      toast.error(errorText(e, t("createError")));
    } finally {
      setCreating(false);
    }
  }

  const activeCount = shares?.filter((s) => s.active).length ?? 0;

  const recap: { tone: "ok" | "warn"; text: string }[] = [
    {
      tone: "ok",
      text: t("recap.blocks", { count: effectiveBlocks.length }),
    },
    audience === "creator"
      ? {
          tone: "ok",
          text: creatorName
            ? t("recap.onlyCreator", { name: creatorName })
            : t("recap.pickCreator"),
        }
      : showCreatorNames
        ? { tone: "warn", text: t("recap.namesShown") }
        : { tone: "ok", text: t("recap.anonymized") },
    postLinks
      ? { tone: "warn", text: t("recap.linksRevealHandles") }
      : { tone: "ok", text: t("recap.noHandles") },
    { tone: "ok", text: t("recap.noMoney") },
    { tone: "ok", text: t("recap.live") },
  ];
  if (shown) {
    recap.push({ tone: "ok", text: t("recap.posts", { count: shown.view.postCount }) });
  }

  const creatorOptions = (creators ?? []).map((c) => ({
    value: c._id as string,
    label: c.name,
  }));
  const creatorItems = Object.fromEntries(creatorOptions.map((o) => [o.value, o.label]));
  const campaignOptions = (campaigns ?? []).map((c) => ({
    value: c._id as string,
    label: c.name,
  }));
  const warmupItems: Record<Warmup, string> = {
    exclude: t("warmup.exclude"),
    all: t("warmup.all"),
    only: t("warmup.only"),
  };
  const expiryItems: Record<Expiry, string> = {
    "30": t("expiry.30"),
    "90": t("expiry.90"),
    never: t("expiry.never"),
  };

  const url =
    created && typeof window !== "undefined"
      ? `${window.location.origin}/s/${created.token}`
      : "";

  return (
    <div className="space-y-4" data-testid="share-mode">
      {/* ── Bandeau : destinataire ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-primary">
          <Share2Icon className="size-4" aria-hidden />
          {t("title")}
        </span>
        <span className="text-sm text-slate-600">{t("for")}</span>
        <Segmented
          value={audience}
          onChange={chooseAudience}
          options={[
            { value: "brand", label: t("audience.brand") },
            { value: "creator", label: t("audience.creator") },
          ]}
          label={t("audience.label")}
        />
        {audience === "creator" && (
          <Select
            items={creatorItems}
            value={creatorId || null}
            onValueChange={(v) => v !== null && setCreatorId(v as string)}
          >
            <SelectTrigger className="w-48 bg-white" aria-label={t("audience.pickCreator")}>
              <SelectValue placeholder={t("audience.pickCreator")} />
            </SelectTrigger>
            <SelectContent align="start" alignItemWithTrigger={false}>
              {creatorOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => setLinksOpen(true)}>
          {t("links", { count: activeCount })}
        </Button>
        <Button variant="ghost" size="sm" onClick={onExit}>
          <XIcon className="size-4" aria-hidden />
          {t("exit")}
        </Button>
      </div>

      {/* ── Périmètre ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-600">{t("period.label")}</span>
          <Segmented
            value={preset}
            onChange={setPreset}
            label={t("period.label")}
            options={[
              { value: "7", label: t("period.days", { days: 7 }) },
              { value: "30", label: t("period.days", { days: 30 }) },
              { value: "90", label: t("period.days", { days: 90 }) },
              { value: "fixed", label: t("period.fixed") },
              { value: "all", label: t("period.all") },
            ]}
          />
        </div>
        {preset === "fixed" && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="share-from" className="text-xs text-slate-600">
                {t("period.from")}
              </Label>
              <Input
                id="share-from"
                type="date"
                value={fixedFrom}
                max={fixedTo || undefined}
                onChange={(e) => setFixedFrom(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="share-to" className="text-xs text-slate-600">
                {t("period.to")}
              </Label>
              <Input
                id="share-to"
                type="date"
                value={fixedTo}
                min={fixedFrom || undefined}
                onChange={(e) => setFixedTo(e.target.value)}
                className="w-40"
              />
            </div>
          </>
        )}
        <div className="w-44">
          <FilterMultiSelect
            label={t("campaigns")}
            selectedValues={campaignIds}
            onChange={setCampaignIds}
            options={campaignOptions}
            allLabel={t("all")}
            width="w-full"
          />
        </div>
        <div className="w-40">
          <FilterMultiSelect
            label={t("platforms")}
            selectedValues={plateformes}
            onChange={setPlateformes}
            options={PLATFORMS.map((p) => ({ value: p, label: p }))}
            allLabel={t("all")}
            width="w-full"
          />
        </div>
        {audience === "brand" && (
          <div className="w-44">
            <FilterMultiSelect
              label={t("creators")}
              selectedValues={creatorIds}
              onChange={setCreatorIds}
              options={creatorOptions}
              allLabel={t("all")}
              width="w-full"
            />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-600">{t("warmup.label")}</span>
          <Select
            items={warmupItems}
            value={warmup}
            onValueChange={(v) => v !== null && setWarmup(v as Warmup)}
          >
            <SelectTrigger className="w-40" aria-label={t("warmup.label")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start" alignItemWithTrigger={false}>
              {(Object.keys(warmupItems) as Warmup[]).map((w) => (
                <SelectItem key={w} value={w}>
                  {warmupItems[w]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ── Aperçu : exactement la page publique ─────────────────────── */}
        <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-100/60 p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-slate-500">{t("previewLabel")}</p>
            <Segmented
              value={device}
              onChange={setDevice}
              label={t("device.label")}
              options={[
                { value: "desktop", label: t("device.desktop"), icon: MonitorIcon },
                { value: "phone", label: t("device.phone"), icon: SmartphoneIcon },
              ]}
            />
          </div>
          <div
            className={cn(
              "mx-auto bg-slate-50 transition-[max-width]",
              device === "phone"
                ? "max-w-[390px] rounded-[2rem] border-[6px] border-slate-800 p-4"
                : "max-w-3xl rounded-lg p-2 sm:p-4",
            )}
          >
            {config === null ? (
              <p className="py-24 text-center text-sm text-slate-400">
                {audience === "creator" ? t("recap.pickCreator") : t("pickDates")}
              </p>
            ) : shown ? (
              <div className={cn(preview === undefined && "opacity-60 transition-opacity")}>
                <PublicTrackerView
                  payload={shown}
                  compact={device === "phone"}
                  edit={{
                    enabled: new Set(effectiveBlocks),
                    available,
                    onToggle: toggleBlock,
                    labels: {
                      include: t("block.include"),
                      exclude: t("block.exclude"),
                      internalTitle: t("block.quadrantTitle"),
                      internalBody: t("block.quadrantBody"),
                    },
                  }}
                />
              </div>
            ) : (
              <div className="flex justify-center py-24">
                <Loader2Icon className="size-5 animate-spin text-slate-400" />
              </div>
            )}
          </div>
        </div>

        {/* ── Récapitulatif + création ─────────────────────────────────── */}
        <aside className="h-fit space-y-4 rounded-xl border border-slate-200 bg-white p-4 lg:sticky lg:top-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">{t("recap.title")}</p>
            <ul className="mt-2 space-y-1.5" data-testid="share-recap">
              {recap.map((r, i) => (
                <li key={i} className="flex gap-2 text-xs">
                  {r.tone === "warn" ? (
                    <AlertTriangleIcon className="mt-px size-3.5 shrink-0 text-amber-500" aria-hidden />
                  ) : (
                    <CheckCircle2Icon className="mt-px size-3.5 shrink-0 text-emerald-500" aria-hidden />
                  )}
                  <span className={r.tone === "warn" ? "text-amber-700" : "text-slate-600"}>
                    {r.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-3 border-t border-slate-100 pt-4">
            {audience === "brand" && (
              <ToggleRow
                id="share-names"
                label={t("options.names")}
                checked={showCreatorNames}
                onChange={setShowCreatorNames}
              />
            )}
            <ToggleRow
              id="share-links"
              label={t("options.links")}
              hint={audience === "brand" ? t("options.linksHint") : undefined}
              checked={postLinks}
              onChange={setPostLinks}
            />
          </div>

          <div className="space-y-3 border-t border-slate-100 pt-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="share-name" className="text-xs text-slate-600">
                {t("name")}
              </Label>
              <Input
                id="share-name"
                value={name}
                placeholder={defaultName}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">{t("expiry.label")}</span>
              <Select
                items={expiryItems}
                value={expiry}
                onValueChange={(v) => v !== null && setExpiry(v as Expiry)}
              >
                <SelectTrigger className="w-full" aria-label={t("expiry.label")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start" alignItemWithTrigger={false}>
                  {(Object.keys(expiryItems) as Expiry[]).map((x) => (
                    <SelectItem key={x} value={x}>
                      {expiryItems[x]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              onClick={create}
              disabled={creating || config === null || effectiveBlocks.length === 0 || finalName === ""}
            >
              {creating && <Loader2Icon className="size-4 animate-spin" aria-hidden />}
              {t("create")}
            </Button>
            {effectiveBlocks.length === 0 && (
              <p className="text-xs text-amber-700">{t("noBlock")}</p>
            )}
          </div>
        </aside>
      </div>

      <Dialog open={created !== null} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("created.title")}</DialogTitle>
            <DialogDescription>{t("created.body")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={url} className="font-mono text-xs" aria-label={t("created.url")} />
            <CopyButton text={url} label={t("created.copy")} copiedLabel={t("created.copied")} />
          </div>
          <DialogFooter>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
            >
              <ExternalLinkIcon className="size-4" aria-hidden />
              {t("created.open")}
            </a>
            <Button
              onClick={() => {
                setCreated(null);
                onExit();
              }}
            >
              {t("created.done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ShareLinksSheet open={linksOpen} onOpenChange={setLinksOpen} />
    </div>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm text-slate-700">
          {label}
        </Label>
        {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: typeof MonitorIcon }[];
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-full border border-slate-200 bg-white p-0.5"
    >
      {options.map((o) => {
        const Icon = o.icon;
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              on ? "bg-primary text-primary-foreground" : "text-slate-600 hover:text-slate-900",
            )}
          >
            {Icon && <Icon className="size-3.5" aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
