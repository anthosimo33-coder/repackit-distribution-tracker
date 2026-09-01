"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import {
  useProjectMutation,
  useProjectQuery,
} from "@/components/project/use-project-convex";
import {
  useProject,
  useProjectPath,
  useProjectSlug,
} from "@/components/project/ProjectProvider";
import { viewAsBase } from "@/lib/view-as";
import { formatMoney } from "@/lib/format-rate";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EyeIcon,
  FolderPlusIcon,
  KeyRoundIcon,
  Loader2Icon,
  Trash2Icon,
} from "lucide-react";
import {
  CREATOR_KINDS,
  KIND_LABELS,
  resolveCreatorKind,
  type CreatorKind,
} from "@/convex/roles";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { cn } from "@/lib/utils";
import {
  CREATOR_STATUS_ORDER,
  PAYMENT_METHOD_LABELS,
  creatorStatusBadge,
  type CreatorStatus,
} from "@/lib/creator-status";
import { CopyableLink } from "./CopyableLink";
import { CreatorComptesSection } from "./CreatorComptesSection";
import { DeleteCreatorDialog } from "./DeleteCreatorDialog";
import {
  LOCALES,
  LOCALE_LABELS,
  DEFAULT_LOCALE,
  normalizeLocale,
  type Locale,
} from "@/i18n/locales";
import {
  TIMEZONE_CHOICES,
  utcOffsetLabel,
} from "@/convex/creatorDay";

/**
 * Valeur sentinelle du <Select> pour « non défini ».
 *
 * Un `<SelectItem value="">` est refusé par le composant partagé (il confond la
 * chaîne vide avec « rien de sélectionné »), d'où la sentinelle — même patron
 * que COUNTRY_NONE dans CompteDialog.
 */
const TZ_NONE = "none";

type Creator = NonNullable<FunctionReturnType<typeof api.creators.getCreator>>;

const PAYMENT_METHODS = ["sepa", "paypal", "usdt", "autre"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];
const NONE = "__none__";

export function CreatorDetailView({ creator }: { creator: Creator }) {
  // Population de la fiche — décide du tarif affiché (et de rien d'autre ici).
  const kind = resolveCreatorKind(creator.kind);
  const router = useRouter();
  const projectPath = useProjectPath();
  const projectSlug = useProjectSlug();
  // Devise de la PAIE créatrices (dollars) — pour les montants de bonus (cash).
  const payCurrency = useProject().project.payCurrency;
  const update = useProjectMutation(api.creators.updateCreator);
  const regenerate = useProjectMutation(api.creators.regenerateInvitation);
  const generateResetLink = useProjectMutation(
    api.passwordReset.generatePasswordResetLink,
  );
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [name, setName] = useState(creator.name);
  const [phone, setPhone] = useState(creator.phone ?? "");
  const [status, setStatus] = useState<CreatorStatus>(creator.status);
  const [paymentMethod, setPaymentMethod] = useState<string>(
    creator.paymentMethod ?? NONE,
  );
  const [paymentDetails, setPaymentDetails] = useState(
    creator.paymentDetails ?? "",
  );
  const [adminNotes, setAdminNotes] = useState(creator.adminNotes ?? "");
  // Langue de la fiche. `undefined` en base = français implicite (on ne stocke
  // que la DIVERGENCE, cf normalizeCreatorLocale) — le <Select> affiche donc le
  // défaut du produit, et n'écrit que si l'admin choisit autre chose.
  const [locale, setLocale] = useState<Locale>(
    normalizeLocale(creator.locale) ?? DEFAULT_LOCALE,
  );
  const [refSlug, setRefSlug] = useState(creator.refSlug ?? "");
  // FUSEAU de la créatrice. "" = à définir (le champ est effacé en base, et la
  // déduction depuis le pays de ses comptes reprend la main). On garde la valeur
  // STOCKÉE et non la valeur résolue : afficher la déduction dans le <Select>
  // ferait croire qu'elle est enregistrée, et le premier « Enregistrer » la
  // figerait en « admin » — une supposition promue en fait sans que personne
  // ne l'ait décidé.
  const [timezone, setTimezone] = useState(creator.timezone ?? "");
  // Provenance RÉSOLUE par le serveur (fiche, sinon pays des comptes). Servie et
  // non recalculée ici : la déduction lit les comptes, que cet écran n'a pas.
  const zoneInfo = useProjectQuery(api.creators.getCreatorTimezone, {
    id: creator._id,
  });
  const zoneLabel = (zone: string) =>
    TIMEZONE_CHOICES.find((c) => c.zone === zone)?.label ?? zone;
  // Rien de stocké : le champ dit « non défini » ET ce qui sert en attendant.
  // Sans ça, le sélecteur affiche « Non défini » pendant que la pastille dit
  // « déduit du pays » — les deux sont vrais, mais ça se lit comme une
  // contradiction, et on ne sait pas quelle heure fait foi.
  const timezoneLabel =
    timezone !== ""
      ? zoneLabel(timezone)
      : zoneInfo?.timezone
        ? `Non défini — déduit : ${zoneLabel(zoneInfo.timezone)}`
        : "Non défini";
  // Tarif de la personne — un seul des deux selon sa population (cf bloc JSX).
  const [population, setPopulation] = useState<string>(kind);
  const [tarif, setTarif] = useState(
    kind === "clipper"
      ? (creator.clipRate?.toString() ?? "")
      : kind === "talent"
        ? (creator.cycleRetainer?.toString() ?? "")
        : "",
  );
  const [handleTiktok, setHandleTiktok] = useState(
    creator.handlesToCreate?.tiktok ?? "",
  );
  const [handleYoutube, setHandleYoutube] = useState(
    creator.handlesToCreate?.youtube ?? "",
  );
  const [handleInstagram, setHandleInstagram] = useState(
    creator.handlesToCreate?.instagram ?? "",
  );
  const [saving, setSaving] = useState(false);
  // Lien de reset généré (affiché dans un dialog à copier). null = dialog fermé.
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [generatingReset, setGeneratingReset] = useState(false);

  // Rattachement multi-projets : projets vers lesquels l'admin peut ajouter CE
  // créateur (ses projets admin, hors ceux où le créateur est déjà membre).
  // Réservé à un compte DÉJÀ finalisé (userId posé) — sinon c'est /join.
  const addableProjects = useQuery(
    api.creators.listAddableProjectsForCreator,
    creator.userId ? { creatorUserId: creator.userId } : "skip",
  );
  const addToProject = useMutation(api.creators.addCreatorToProject);
  const [addTarget, setAddTarget] = useState<string>("");
  const [adding, setAdding] = useState(false);

  async function handleAddToProject() {
    if (!creator.userId || !addTarget) return;
    setAdding(true);
    try {
      await addToProject({
        projectId: addTarget as Id<"projects">,
        creatorUserId: creator.userId,
      });
      toast.success("Créateur rattaché au projet.");
      setAddTarget("");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Échec du rattachement au projet"));
    } finally {
      setAdding(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await update({
        id: creator._id,
        name: name.trim(),
        phone,
        status,
        paymentMethod:
          paymentMethod === NONE
            ? undefined
            : (paymentMethod as PaymentMethod),
        paymentDetails,
        adminNotes,
        locale,
        // Vide = retirer la ref → la créatrice repasse « pas de ref
        // configurée » dans la section conversion, jamais à zéro.
        refSlug: refSlug.trim() === "" ? null : refSlug,
        // Vide = effacer le fuseau (retour à « à définir »), jamais un repli
        // sur Paris. Écrire ici pose la provenance « admin » côté serveur.
        timezone: timezone === "" ? null : timezone,
        handlesToCreate: {
          tiktok: handleTiktok.trim() || undefined,
          youtube: handleYoutube.trim() || undefined,
          instagram: handleInstagram.trim() || undefined,
        },
        // Vide = retirer le tarif (null), pas « 0 » : un tarif absent et un tarif
        // nul ne veulent pas dire la même chose — sans tarif, aucune ligne de
        // paie n'est créée du tout.
        // Population — n'est envoyée QUE si elle change : le serveur refuse la
        // bascule sur une fiche qui a déjà des comptes, des publications ou des
        // lignes de paie, et l'envoyer inutilement ferait échouer une simple
        // édition de nom sur une fiche non vierge.
        ...(population !== kind
          ? { kind: population as "partner" | "talent" | "clipper" }
          : {}),
        ...(kind === "clipper"
          ? { clipRate: tarif.trim() === "" ? null : Number(tarif) }
          : {}),
        ...(kind === "talent"
          ? { cycleRetainer: tarif.trim() === "" ? null : Number(tarif) }
          : {}),
      });
      toast.success("Créateur mis à jour");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Échec de la mise à jour du créateur"));
    } finally {
      setSaving(false);
    }
  }

  async function handleRegenerate() {
    try {
      await regenerate({ creatorId: creator._id });
      toast.success("Nouveau lien généré — l'ancien est désactivé");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Échec de la génération du lien"));
    }
  }

  async function handleGenerateReset() {
    setGeneratingReset(true);
    try {
      const { token } = await generateResetLink({ creatorId: creator._id });
      setResetToken(token);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Échec de la génération du lien de réinitialisation"));
    } finally {
      setGeneratingReset(false);
    }
  }

  const badge = creatorStatusBadge(creator.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          {creator.name}
        </h1>
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-semibold",
            badge.className,
          )}
        >
          {badge.label}
        </span>
        {/* Voir l'espace du créateur tel qu'il le voit, en LECTURE SEULE (scopé
            projet, vérifié serveur). N'agit jamais en son nom. */}
        <Link
          href={viewAsBase(projectSlug, creator._id)}
          className={cn(buttonVariants({ variant: "outline" }), "ml-auto")}
          data-testid="view-as-creator"
        >
          <EyeIcon className="mr-2 size-4" />
          Voir son espace
        </Link>
      </div>

      {/* Lien d'invitation — uniquement tant que le créateur est "invited". */}
      {creator.invitation && (
        <Card>
          <CardHeader>
            <CardTitle>Lien d&apos;activation</CardTitle>
            <CardDescription>
              Expire le{" "}
              {new Date(creator.invitation.expiresAt).toLocaleDateString(
                "fr-FR",
              )}
              . Régénère-le s&apos;il est expiré ou perdu (l&apos;ancien lien
              cesse aussitôt de fonctionner).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <CopyableLink token={creator.invitation.token} />
            <Button variant="outline" onClick={handleRegenerate}>
              Régénérer le lien
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Reset mot de passe — uniquement pour un compte DÉJÀ finalisé (userId
          posé). Pour un compte encore "invited", c'est le lien d'activation
          ci-dessus qui s'applique. Les deux sont des actions de récupération
          d'accès mais distinctes. */}
      {creator.userId && (
        <Card>
          <CardHeader>
            <CardTitle>Mot de passe</CardTitle>
            <CardDescription>
              Le créateur a perdu son mot de passe ? Génère un lien de
              réinitialisation à usage unique (valable 48 h) et envoie-le lui
              (WhatsApp). Tu ne vois jamais son mot de passe.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={handleGenerateReset}
              disabled={generatingReset}
            >
              {generatingReset ? (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              ) : (
                <KeyRoundIcon className="mr-2 size-4" />
              )}
              Réinitialiser le mot de passe
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={resetToken !== null}
        onOpenChange={(open) => !open && setResetToken(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lien de réinitialisation</DialogTitle>
            <DialogDescription>
              Envoie ce lien au créateur (WhatsApp). Il est valable 48 h, à
              usage unique : une fois utilisé, il cesse de fonctionner.
            </DialogDescription>
          </DialogHeader>
          {resetToken && (
            <CopyableLink
              token={resetToken}
              segment="reset-password"
              ariaLabel="Lien de réinitialisation"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Multi-projets — rattacher CE compte créateur à un autre projet (même
          login). Uniquement pour un compte DÉJÀ finalisé (userId posé) : pour un
          créateur jamais inscrit, c'est le lien d'invitation /join qui crée le
          compte. */}
      {creator.userId && (
        <Card>
          <CardHeader>
            <CardTitle>Autres projets</CardTitle>
            <CardDescription>
              Rattache ce créateur (même compte, même login) à un autre de tes
              projets. Ses comptes, assignments et gains y seront distincts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {addableProjects === undefined ? (
              <p className="text-sm text-slate-400">Chargement…</p>
            ) : addableProjects.length === 0 ? (
              <p className="text-sm text-slate-500">
                Aucun autre projet disponible (déjà membre de tous tes projets).
              </p>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="add-project">Projet</Label>
                  <Select
                    value={addTarget}
                    onValueChange={(v) => v && setAddTarget(v)}
                  >
                    <SelectTrigger id="add-project" aria-label="Projet cible">
                      <SelectValue placeholder="Choisir un projet…">
                        {addTarget
                          ? addableProjects.find(
                              (p) => p.projectId === addTarget,
                            )?.name
                          : "Choisir un projet…"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {addableProjects.map((p) => (
                        <SelectItem key={p.projectId} value={p.projectId}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleAddToProject}
                  disabled={adding || !addTarget}
                  className="shrink-0"
                >
                  {adding ? (
                    <Loader2Icon className="mr-2 size-4 animate-spin" />
                  ) : (
                    <FolderPlusIcon className="mr-2 size-4" />
                  )}
                  Ajouter au projet
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Informations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nom</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={creator.email} readOnly disabled />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Téléphone</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status">Statut</Label>
              <Select
                value={status}
                onValueChange={(v) => v && setStatus(v as CreatorStatus)}
              >
                <SelectTrigger id="status" aria-label="Statut">
                  <SelectValue>
                    {creatorStatusBadge(status).label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CREATOR_STATUS_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      {creatorStatusBadge(s).label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/*
              Langue de la fiche — le FILET quand une invitation est partie dans
              la mauvaise langue. `updateCreator` acceptait déjà l'argument ;
              aucun formulaire ne l'exposait, si bien qu'un créateur invité en
              français par erreur ne pouvait être corrigé que par lui-même.

              Elle sert AVANT que le compte existe (l'e-mail d'invitation part
              quand `creators.userId` est encore undefined). Une fois le compte
              créé, `users.locale` fait foi : changer la fiche ici ne réécrit
              donc pas la préférence d'un créateur qui a déjà choisi la sienne.
            */}
            <div className="space-y-1.5">
              <Label htmlFor="creator-locale">Langue</Label>
              <Select
                value={locale}
                onValueChange={(v) => v && setLocale(v as Locale)}
              >
                <SelectTrigger id="creator-locale" aria-label="Langue">
                  <SelectValue>{LOCALE_LABELS[locale]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {LOCALES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {LOCALE_LABELS[l]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                Langue des e-mails, de son espace, et de l&apos;aperçu « Voir son
                espace ». Une fois son compte créé, sa propre préférence (Profil)
                prend le dessus.
              </p>
            </div>
            {/*
              FUSEAU HORAIRE — « quel jour est-il pour elle ? ».
              
              Ce champ ne décore pas : il décide de la date des checks de warmup,
              donc du compteur de jours manqués. Avant lui, tout tournait sur la
              journée UTC et une créatrice qui cochait à 21 h à New York perdait
              un jour de chauffe (cf docs/diagnostic-fuseaux.md).

              La PROVENANCE est affichée à côté de la valeur, exprès : dans six
              mois, il faut pouvoir lire une fiche et savoir si America/New_York
              est un FAIT (elle l'a confirmé) ou une SUPPOSITION (déduit du pays
              de ses comptes). « à confirmer » tant que ce n'est pas elle.
            */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor="creator-timezone">Fuseau horaire</Label>
                {zoneInfo && zoneInfo.timezone !== null && (
                  <span
                    className={
                      zoneInfo.source === "confirmed"
                        ? "rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
                        : "rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700"
                    }
                  >
                    {zoneInfo.source === "confirmed"
                      ? "confirmé par elle"
                      : zoneInfo.source === "admin"
                        ? "saisi — à confirmer"
                        : zoneInfo.stored
                          ? "déduit puis FIGÉ — à confirmer"
                          : "déduit du pays — à confirmer"}
                  </span>
                )}
                {zoneInfo && zoneInfo.timezone === null && (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    à définir
                  </span>
                )}
              </div>
              <Select
                value={timezone}
                onValueChange={(v) => setTimezone(v === TZ_NONE ? "" : (v ?? ""))}
              >
                <SelectTrigger id="creator-timezone" aria-label="Fuseau horaire">
                  <SelectValue>{timezoneLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TZ_NONE}>Non défini</SelectItem>
                  {TIMEZONE_CHOICES.map((c) => (
                    <SelectItem key={c.zone} value={c.zone}>
                      {c.label}
                      {utcOffsetLabel(c.zone) ? ` — ${utcOffsetLabel(c.zone)}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                Sert de référence aux dates : jours de warmup, échéances et
                relances. Un pays ne détermine pas un fuseau — les États-Unis en
                ont six — donc mieux vaut « non défini » qu&apos;une supposition.
                {/*
                  DEUX états très différents sous le même mot « déduit », et
                  l'admin doit savoir lequel : une valeur FIGÉE ne se corrigera
                  plus toute seule, il faut agir. Sans cette distinction, une
                  fiche gelée sur un mauvais fuseau ressemble à une fiche en
                  attente, et personne n'y touche jamais.
                */}
                {zoneInfo?.stored && zoneInfo.source === "inferred" && (
                  <>
                    {" "}
                    <strong>{zoneInfo.timezone}</strong> a été déduit du pays de
                    ses comptes puis <strong>figé</strong> à son premier check de
                    warmup : il ne suivra plus le pays de ses comptes. Choisis
                    une valeur ci-dessus pour le corriger.
                  </>
                )}
                {zoneInfo?.timezone && !zoneInfo.stored && (
                  <>
                    {" "}
                    En attendant, <strong>{zoneInfo.timezone}</strong> est déduit
                    du pays de ses comptes. Rien n&apos;est encore enregistré :
                    la valeur suivra le pays, et se figera à son premier check de
                    warmup.
                  </>
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Population</CardTitle>
          <CardDescription>
            Corrige une invitation faite avec la mauvaise population. Possible
            tant que la fiche est vierge — dès qu&apos;un compte, une publication
            ou une ligne de paie y est rattaché, la population est figée.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs space-y-1.5">
            <Label htmlFor="population">Population</Label>
            <Select
              value={population}
              onValueChange={(v) => v && setPopulation(v)}
            >
              <SelectTrigger id="population" aria-label="Population">
                <SelectValue>{KIND_LABELS[population as CreatorKind]?.singular ?? "—"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CREATOR_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABELS[k].singular}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {population !== kind && (
              <p className="text-xs text-amber-700">
                Changera aussi l&apos;espace auquel cette personne accède au
                prochain login. Enregistre pour appliquer.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Moyen de paiement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="paymentMethod">Méthode</Label>
              <Select
                value={paymentMethod}
                onValueChange={(v) => v && setPaymentMethod(v)}
              >
                <SelectTrigger id="paymentMethod" aria-label="Méthode de paiement">
                  <SelectValue>
                    {paymentMethod === NONE
                      ? "Non défini"
                      : PAYMENT_METHOD_LABELS[paymentMethod]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Non défini</SelectItem>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="paymentDetails">Coordonnées</Label>
              <Input
                id="paymentDetails"
                placeholder="IBAN, email PayPal, adresse USDT…"
                value={paymentDetails}
                onChange={(e) => setPaymentDetails(e.target.value)}
              />
            </div>
          </div>
          {/*
            TARIF — par personne, donc ici, à côté de la façon dont ON LA PAIE.
            Un seul champ, celui de sa population : un partenaire n'en a aucun
            (il est au fixe/CPM/paliers, réglés par une grille de pricing).
          */}
          {(kind === "clipper" || kind === "talent") && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tarif">
                  {kind === "clipper"
                    ? "Tarif par clip"
                    : "Forfait par cycle (30 j)"}
                </Label>
                <Input
                  id="tarif"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  placeholder="Non défini"
                  value={tarif}
                  onChange={(e) => setTarif(e.target.value)}
                />
                <p className="text-xs text-slate-500">
                  {kind === "clipper"
                    ? "Figé sur chaque clip au moment où il est assigné — le modifier ne change aucun clip déjà commandé."
                    : "Dû pour chaque cycle écoulé, quel que soit le nombre de rushes déposés. Le compte de rushes s'affiche à côté du montant, dans Paiements."}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/*
        BLOCS PARTENAIRE. Les @ à créer et la grille de paliers relèvent du flux
        partenaire : un talent ne crée aucun compte, un clippeur est payé au clip.
        Les afficher chez eux donnait des champs qui ne servent à rien et qui
        laissent croire qu'ils comptent.
      */}
      {kind === "partner" && (
      <Card>
        <CardHeader>
          <CardTitle>@ à créer par réseau</CardTitle>
          <CardDescription>
            Le ou les @ que ce créateur doit créer sur ses réseaux (affichés dans
            « Mes comptes », à côté des consignes de warmup). Laisse vide un
            réseau pour ne rien demander.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="handle-tiktok">@ TikTok à créer</Label>
            <Input
              id="handle-tiktok"
              maxLength={64}
              placeholder="@…"
              value={handleTiktok}
              onChange={(e) => setHandleTiktok(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="handle-youtube">@ YouTube à créer</Label>
            <Input
              id="handle-youtube"
              maxLength={64}
              placeholder="@…"
              value={handleYoutube}
              onChange={(e) => setHandleYoutube(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="handle-instagram">@ Instagram à créer</Label>
            <Input
              id="handle-instagram"
              maxLength={64}
              placeholder="@…"
              value={handleInstagram}
              onChange={(e) => setHandleInstagram(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Attribution snytch.co</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Label htmlFor="ref-slug">Ref du chemin court</Label>
          <Input
            id="ref-slug"
            maxLength={64}
            placeholder="kelly (pour snytch.co/kelly)"
            value={refSlug}
            onChange={(e) => setRefSlug(e.target.value)}
          />
          <p className="text-xs text-slate-400">
            La clé d&apos;attribution des visiteurs et des ventes. Sans elle, la
            créatrice apparaît « pas de ref configurée » dans la section
            conversion — le trafic in-app TikTok ne transmet pas de referrer,
            tout repose sur ce chemin.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes admin</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={adminNotes}
            onChange={(e) => setAdminNotes(e.target.value)}
            rows={4}
            placeholder="Notes internes (non visibles par le créateur)…"
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2Icon className="mr-2 size-4 animate-spin" />}
          Enregistrer
        </Button>
      </div>

      {/* P5 — Comptes du créateur (alimenté). Assignments / Paiements restent
          des emplacements réservés (chantiers suivants). */}
      {kind === "partner" && (
        <BonusGridSection
          creatorId={creator._id}
          current={creator.bonusPricingId ?? null}
          currency={payCurrency}
        />
      )}

      <CreatorComptesSection creatorId={creator._id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FutureSection title="Assignments" />
        <FutureSection title="Paiements" />
      </div>

      {/* Zone de danger — suppression définitive (cascade opérationnelle,
          historique conservé sous le nom du créateur). */}
      <Card className="border-rose-200">
        <CardHeader>
          <CardTitle className="text-rose-700">Zone de danger</CardTitle>
          <CardDescription>
            Supprime définitivement ce créateur : ses comptes et missions en
            cours sont effacés (combos libérés) ; ses publications et son
            historique de paiement sont conservés sous son nom. Irréversible.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2Icon className="mr-2 size-4" />
            Supprimer le créateur
          </Button>
        </CardContent>
      </Card>

      <DeleteCreatorDialog
        creatorId={creator._id}
        creatorName={creator.name}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => router.push(projectPath("/createurs"))}
      />
    </div>
  );
}

function FutureSection({ title }: { title: string }) {
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="text-base text-slate-500">{title}</CardTitle>
        <CardDescription>Bientôt disponible.</CardDescription>
      </CardHeader>
    </Card>
  );
}

const NO_GRID = "__nogrid__";

/**
 * Grille de paliers de bonus du créateur (cumul de vues). L'admin choisit un
 * pricing dont les paliers s'appliquent ; voit le cumul + les paliers débloqués
 * (cash comptés, nature = récompenses dues).
 */
function BonusGridSection({
  creatorId,
  current,
  currency,
}: {
  creatorId: Id<"creators">;
  current: Id<"pricings"> | null;
  /** Devise de la PAIE créatrices (dollars), threadée depuis CreatorDetailView. */
  currency?: string | null;
}) {
  const pricings = useProjectQuery(api.pricing.listPricings, {});
  const bonus = useProjectQuery(api.pricing.getCreatorBonusStatus, { creatorId });
  const update = useProjectMutation(api.creators.updateCreator);
  const [saving, setSaving] = useState(false);

  async function setGrid(value: string) {
    setSaving(true);
    try {
      await update({
        id: creatorId,
        bonusPricingId: value === NO_GRID ? null : (value as Id<"pricings">),
      });
      toast.success("Grille de bonus mise à jour");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Échec de la mise à jour de la grille de bonus"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bonus (paliers sur cumul de vues)</CardTitle>
        <CardDescription>
          Les paliers du pricing choisi se débloquent sur le CUMUL total des vues
          de ce créateur (à vie). Cash = compté ; nature = récompense à remettre.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Grille de paliers</Label>
          <Select
            value={current ?? NO_GRID}
            onValueChange={(v) => v && !saving && setGrid(v)}
          >
            <SelectTrigger aria-label="Grille de bonus">
              <SelectValue>
                {current
                  ? ((pricings ?? []).find((p) => p._id === current)?.name ??
                    "Pricing")
                  : "Aucune"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_GRID}>Aucune</SelectItem>
              {(pricings ?? []).map((p) => (
                <SelectItem key={p._id} value={p._id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {bonus && bonus.tiers.length > 0 && (
          <div className="space-y-1 text-sm">
            <p className="text-slate-600">
              Cumul :{" "}
              <span className="font-semibold tabular-nums">
                {bonus.cumulViews.toLocaleString("fr-FR")} vues
              </span>
            </p>
            {bonus.cashUnlockedTotal > 0 && (
              <p className="text-emerald-700">
                Cash débloqué : {formatMoney(bonus.cashUnlockedTotal, currency)}
              </p>
            )}
            {bonus.natureUnlocked.length > 0 && (
              <p className="text-violet-700">
                Récompenses nature dues :{" "}
                {bonus.natureUnlocked.map((r) => r.libelle).join(", ")}
              </p>
            )}
            {bonus.nextTier && (
              <p className="text-slate-500">
                Prochain palier dans{" "}
                {(bonus.viewsToNext ?? 0).toLocaleString("fr-FR")} vues (
                {bonus.nextTier.rewardType === "cash"
                  ? formatMoney(bonus.nextTier.montant ?? 0, currency)
                  : bonus.nextTier.libelle}
                ).
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
