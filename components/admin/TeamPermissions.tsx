"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

import {
  useProjectMutation,
  useProjectQuery,
} from "@/components/project/use-project-convex";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { cn } from "@/lib/utils";
import type { FunctionReturnType } from "convex/server";
import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CoinsIcon,
  EyeIcon,
  Loader2Icon,
  PencilIcon,
  ShieldCheckIcon,
} from "lucide-react";

/**
 * Gestion des rôles et des droits d'un projet — SUPERADMIN uniquement.
 *
 * ── CE QUI SE CONSTRUIT TOUT SEUL ────────────────────────────────────────────
 * L'écran ne connaît AUCUN bloc. Il rend ce que `team.getCatalogue` lui donne,
 * groupé par la section que le catalogue déclare. Un bloc ajouté demain à
 * `convex/permissions.ts` apparaît ici sans qu'on touche à ce fichier — et c'est
 * la seule façon d'éviter qu'une case existe côté serveur sans exister à l'écran,
 * ou l'inverse.
 *
 * Le marqueur « Lecture » / « Lecture + modification » vient de
 * `convex/permissionCoverage.ts`, GÉNÉRÉ depuis le code. Sans lui, on coche sans
 * savoir si on autorise à consulter ou à modifier — et ce marqueur changerait
 * tout seul à la première mutation ajoutée dans un bloc, donc il ne peut pas être
 * écrit à la main.
 *
 * ── AUCUNE SAISIE LIBRE ──────────────────────────────────────────────────────
 * Uniquement des cases issues du catalogue. L'écriture en base est permissive
 * (la CLI stocke verbatim, pour qu'un nom périmé survive à un renommage), donc un
 * champ de texte permettrait d'« accorder » un droit qui n'ouvre rien. Les
 * valeurs déjà stockées dans ce cas sont affichées comme IGNORÉES plutôt que
 * masquées : sinon on lirait « 4 droits » là où trois fonctionnent.
 */

type Catalogue = FunctionReturnType<typeof api.team.getCatalogue>;
type Bloc = Catalogue["blocs"][number];
type Membre = FunctionReturnType<typeof api.team.listMembers>[number];

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrateur",
  manager: "Manager",
  creator: "Créateur partenaire",
  talent: "Talent",
  clipper: "Clippeur",
};

export function TeamPermissions() {
  // `useQuery` brut, PAS `useProjectQuery` : le catalogue ne dépend d'aucun
  // projet, et `useProjectQuery` injecterait un `projectId` que la query
  // n'accepte pas — l'écran entier tomberait sur une erreur de validation.
  const catalogue = useQuery(api.team.getCatalogue, {});
  const membres = useProjectQuery(api.team.listMembers, {});

  if (catalogue === undefined || membres === undefined) {
    return <Skeleton className="h-96 w-full" />;
  }
  // Une personne = UNE ligne, plusieurs étiquettes. La partition porte sur
  // « porte-t-il le rôle manager ? », pas sur « son rôle EST manager » : une
  // créatrice-manager appartient aux deux mondes, et c'est le sujet de l'étape.
  const managers = membres.filter((m) => m.roles.includes("manager"));
  const autres = membres.filter((m) => !m.roles.includes("manager"));
  // Combien d'administrateurs RÉELS reste-t-il ? Le superadmin n'en est pas un :
  // son accès ne vient pas du projet, et le décompter ferait taire l'avertissement
  // exactement quand il compte — au dernier admin du projet.
  const nbAdmins = membres.filter(
    (m) => m.roles.includes("admin") && !m.isSuperadmin,
  ).length;
  // Le socle qu'une rétrogradation repose. Compté sur le CATALOGUE, jamais écrit
  // en dur : un bloc marqué par défaut demain change ce nombre tout seul.
  const nbDefauts = catalogue.blocs.filter((b) => b.defaultForManager).length;

  return (
    <div className="space-y-6">
      {managers.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-slate-500">
            Aucun manager sur ce projet. Choisis un membre ci-dessous et passe-le
            manager pour lui ouvrir des droits.
          </CardContent>
        </Card>
      )}

      {managers.map((m) => (
        <CarteManager key={m.membershipId} membre={m} catalogue={catalogue} />
      ))}

      <Card>
        <CardContent className="space-y-3 py-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Autres membres
          </div>
          {autres.length === 0 ? (
            <p className="text-sm text-slate-500">Aucun autre membre.</p>
          ) : (
            autres.map((m) => (
              <LigneAutreMembre
                key={m.membershipId}
                membre={m}
                dernierAdmin={nbAdmins <= 1}
                nbDefauts={nbDefauts}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Les rôles de portail, tels que `listMembers` les rend. */
const ROLES_DE_PORTAIL = ["creator", "talent", "clipper"];

/**
 * PASSER UN MANAGER ADMINISTRATEUR — le geste qui n'existait qu'en ligne de
 * commande.
 *
 * ⚠️ IL FAUT RECOPIER L'E-MAIL. Ce n'est pas de la cérémonie : « admin » passe
 * AVANT l'endroit où les droits se lisent, donc aucune case cochée ne le borne
 * plus, et le geste ne se relit nulle part dans l'interface — la carte de droits
 * disparaît. C'est la même exigence que `convex-prod.sh`, qui fait recopier le
 * nom du déploiement avant de toucher la production, et c'est ce qui distingue
 * une décision d'un clic distrait.
 */
function PromotionAdmin({ membre }: { membre: Membre }) {
  const echanger = useProjectMutation(api.team.setTeamRole);
  const [ouvert, setOuvert] = useState(false);
  const [saisie, setSaisie] = useState("");
  const [busy, setBusy] = useState(false);
  // Un espace créateur INTERDIT la promotion — la règle vit dans
  // `roleSetProblem`, côté serveur. On ne propose donc pas la porte, et on dit
  // pourquoi : un bouton qui lève au clic ne renseigne personne.
  const portail = membre.roles.find((r) => ROLES_DE_PORTAIL.includes(r));

  if (portail !== undefined) {
    return (
      <p className="max-w-md text-xs leading-relaxed text-slate-400">
        Non promouvable : le cumul administrateur + espace créateur n&apos;est
        pas ouvert. Un administrateur franchit toutes les gardes, y compris
        celles qui décident de sa propre paie.
      </p>
    );
  }

  async function go() {
    setBusy(true);
    try {
      await echanger({ membershipId: membre.membershipId, role: "admin" });
      toast.success(`${membre.email} est administrateur de ce projet`);
      setOuvert(false);
      setSaisie("");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Échec de la promotion"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-slate-500"
        onClick={() => setOuvert(true)}
      >
        <ArrowUpIcon className="size-3.5" />
        Passer administrateur
      </Button>
      <AlertDialog
        open={ouvert}
        onOpenChange={(o) => {
          setOuvert(o);
          if (!o) setSaisie("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Passer {membre.email} administrateur ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Ses cases disparaissent : un administrateur n&apos;en a pas. Il
              pourra <strong>tout</strong>{" "}faire sur ce projet — paiements,
              barèmes, revenus, réglages, suppressions. Ses droits actuels
              restent stockés et lui reviennent tels quels s&apos;il est
              rétrogradé plus tard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-promo" className="text-xs text-slate-600">
              Recopie son e-mail pour confirmer
            </Label>
            <Input
              id="confirm-promo"
              value={saisie}
              autoComplete="off"
              placeholder={membre.email}
              onChange={(e) => setSaisie(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <Button
              size="sm"
              disabled={busy || saisie.trim() !== membre.email}
              onClick={() => void go()}
            >
              {busy && <Loader2Icon className="size-3.5 animate-spin" />}
              Promouvoir
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * RÉTROGRADER UN ADMINISTRATEUR EN MANAGER.
 *
 * Le geste retire du pouvoir : pas de recopie d'e-mail ici, une confirmation
 * suffit. Elle DOIT dire deux choses qu'on ne devine pas depuis la ligne : avec
 * quels droits il repart, et s'il reste un administrateur sur le projet après
 * coup.
 */
function Retrogradation({
  membre,
  dernierAdmin,
  nbDefauts,
}: {
  membre: Membre;
  dernierAdmin: boolean;
  nbDefauts: number;
}) {
  const echanger = useProjectMutation(api.team.setTeamRole);
  const [ouvert, setOuvert] = useState(false);
  const [busy, setBusy] = useState(false);
  // Ce qu'il retrouvera : ses droits stockés s'il en a (la promotion ne les a
  // pas effacés), le socle par défaut sinon. Même règle que le serveur.
  const reprend = membre.effective.length > 0 ? membre.effective.length : nbDefauts;

  async function go() {
    setBusy(true);
    try {
      await echanger({ membershipId: membre.membershipId, role: "manager" });
      toast.success(`${membre.email} est maintenant manager`);
      setOuvert(false);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Échec de la rétrogradation"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOuvert(true)}>
        <ArrowDownIcon className="size-3.5" />
        Rétrograder en manager
      </Button>
      <AlertDialog open={ouvert} onOpenChange={setOuvert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Rétrograder {membre.email} en manager ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Il perd l&apos;accès à tout ce qui n&apos;est pas coché pour lui.
              Il repart avec{" "}
              <strong>
                {reprend} droit{reprend > 1 ? "s" : ""}
              </strong>
              {membre.effective.length > 0
                ? " — ceux qu'il avait avant sa promotion, restés stockés."
                : " — le socle par défaut, aucun droit de la section Argent."}{" "}
              Le changement prend effet à la prochaine page chargée, sans
              reconnexion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dernierAdmin && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
              <div>
                C&apos;est le <strong>dernier administrateur</strong> de ce
                projet. Après ce geste, seul le superadmin pourra encore tout y
                faire.
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void go()}>
              {busy && <Loader2Icon className="size-3.5 animate-spin" />}
              Rétrograder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Un membre sans le rôle manager : ses rôles, et le geste qui le concerne. */
function LigneAutreMembre({
  membre,
  dernierAdmin,
  nbDefauts,
}: {
  membre: Membre;
  dernierAdmin: boolean;
  nbDefauts: number;
}) {
  const ajouter = useProjectMutation(api.team.addRole);
  const [busy, setBusy] = useState(false);
  // Un ADMIN a tout par construction (la cascade l'autorise avant de lire une
  // permission). Lui ajouter des cases ne le limiterait pas, ça le prétendrait :
  // le serveur refuse ce cumul, on ne propose donc pas le geste. En revanche il
  // se RÉTROGRADE, et c'est le seul chemin qui existe pour ça.
  const estAdmin = membre.roles.includes("admin");

  async function go() {
    setBusy(true);
    try {
      await ajouter({ membershipId: membre.membershipId, role: "manager" });
      toast.success(`${membre.email} a maintenant le rôle manager`);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Échec de l'ajout du rôle manager"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 border-t border-slate-100 py-2 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-slate-900">{membre.email}</div>
        <EtiquettesDeRole membre={membre} />
      </div>
      {membre.isSuperadmin ? (
        <Badge variant="outline" className="text-[10px]">
          tous les droits
        </Badge>
      ) : estAdmin ? (
        <Retrogradation
          membre={membre}
          dernierAdmin={dernierAdmin}
          nbDefauts={nbDefauts}
        />
      ) : (
        <Button size="sm" variant="outline" onClick={go} disabled={busy}>
          {busy && <Loader2Icon className="size-3.5 animate-spin" />}
          Ajouter le rôle manager
        </Button>
      )}
    </div>
  );
}

/**
 * LES RÔLES D'UNE PERSONNE, tous affichés. Une créatrice-manager en porte deux,
 * et n'en montrer qu'un rendrait l'écran faux là où il sert précisément à savoir
 * qui peut quoi.
 */
function EtiquettesDeRole({ membre }: { membre: Membre }) {
  if (membre.isSuperadmin) {
    return (
      <div className="text-xs text-slate-400">
        Superadmin — accès à tout, sur tous les projets
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {membre.roles.length === 0 ? (
        <span className="text-xs text-slate-400">Aucun rôle</span>
      ) : (
        membre.roles.map((r) => (
          <Badge key={r} variant="outline" className="text-[10px]">
            {ROLE_LABELS[r] ?? r}
          </Badge>
        ))
      )}
    </div>
  );
}

/** La carte d'un manager : ses 21 cases, groupées par section. */
function CarteManager({
  membre,
  catalogue,
}: {
  membre: Membre;
  catalogue: Catalogue;
}) {
  const enregistrer = useProjectMutation(api.team.setMemberPermissions);
  const [choix, setChoix] = useState<Bloc["id"][]>(membre.effective);
  const [busy, setBusy] = useState(false);
  // Confirmation AVANT d'accorder un bloc de la section Argent, et avant de tout
  // retirer. Ce sont les deux gestes qu'on ne veut pas faire par inadvertance.
  const [aConfirmer, setAConfirmer] = useState<Bloc | null>(null);
  const [videConfirm, setVideConfirm] = useState(false);

  const parSection = useMemo(() => {
    const m = new Map<string, Bloc[]>();
    for (const s of catalogue.sections) m.set(s, []);
    for (const b of catalogue.blocs) m.get(b.section)?.push(b);
    return [...m.entries()].filter(([, v]) => v.length > 0);
  }, [catalogue]);

  const modifie =
    choix.length !== membre.effective.length ||
    choix.some((c) => !membre.effective.includes(c));

  function bascule(b: Bloc, coche: boolean) {
    if (!coche) {
      setChoix((c) => c.filter((x) => x !== b.id));
      return;
    }
    // Argent : on demande confirmation AVANT de cocher, pas au moment
    // d'enregistrer — c'est le geste lui-même qu'on veut rendre délibéré.
    if (b.section === "Argent") {
      setAConfirmer(b);
      return;
    }
    setChoix((c) => [...c, b.id]);
  }

  async function go(cible = choix) {
    setBusy(true);
    try {
      await enregistrer({ membershipId: membre.membershipId, permissions: cible });
      setChoix(cible);
      toast.success(`Droits de ${membre.email} mis à jour`);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Échec de la mise à jour des droits"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-5 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-900">
              {membre.email}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <EtiquettesDeRole membre={membre} />
              <span className="text-xs text-slate-400">
                {choix.length} droit{choix.length > 1 ? "s" : ""} sur{" "}
                {catalogue.blocs.length}
              </span>
            </div>
          </div>
          <PromotionAdmin membre={membre} />
          {choix.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="text-slate-500"
              onClick={() => setVideConfirm(true)}
              disabled={busy}
            >
              Tout retirer
            </Button>
          )}
          <Button size="sm" onClick={() => go()} disabled={busy || !modifie}>
            {busy && <Loader2Icon className="size-3.5 animate-spin" />}
            Enregistrer
          </Button>
        </div>

        {membre.ignored.length > 0 && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
            <div>
              <strong>
                {membre.ignored.length} valeur
                {membre.ignored.length > 1 ? "s" : ""} stockée
                {membre.ignored.length > 1 ? "s" : ""} n&apos;ouvre
                {membre.ignored.length > 1 ? "nt" : ""} rien.
              </strong>{" "}
              Un bloc renommé, retiré du catalogue, ou une faute de frappe :{" "}
              {membre.ignored.map((i) => `« ${i} »`).join(", ")}. Ces valeurs sont
              ignorées à chaque requête — enregistrer les effacera.
            </div>
          </div>
        )}

        {parSection.map(([section, blocs]) => (
          <div key={section} className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
              {section === "Argent" && (
                <CoinsIcon className="size-3.5 text-amber-600" />
              )}
              {section}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {blocs.map((b) => (
                <CaseBloc
                  key={b.id}
                  bloc={b}
                  coche={choix.includes(b.id)}
                  onChange={(v) => bascule(b, v)}
                />
              ))}
            </div>
          </div>
        ))}
      </CardContent>

      <AlertDialog
        open={aConfirmer !== null}
        onOpenChange={(o) => !o && setAConfirmer(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Accorder « {aConfirmer?.label} » ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              C&apos;est un droit de la section Argent. {aConfirmer?.description}{" "}
              {membre.email} y aura accès dès la prochaine page chargée, sans
              avoir à se reconnecter.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (aConfirmer) setChoix((c) => [...c, aConfirmer.id]);
                setAConfirmer(null);
              }}
            >
              Accorder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={videConfirm} onOpenChange={setVideConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retirer tous les droits ?</AlertDialogTitle>
            <AlertDialogDescription>
              {membre.email} restera manager mais ne pourra plus RIEN faire sur ce
              projet — ni consulter, ni modifier. Le geste est enregistré
              immédiatement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setVideConfirm(false);
                void go([]);
              }}
            >
              Tout retirer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** Une case : libellé, phrase d'explication, et ce que le droit permet vraiment. */
function CaseBloc({
  bloc,
  coche,
  onChange,
}: {
  bloc: Bloc;
  coche: boolean;
  onChange: (v: boolean) => void;
}) {
  const argent = bloc.section === "Argent";
  const ecrit = bloc.writes > 0;
  return (
    <label
      htmlFor={`bloc-${bloc.id}`}
      className={cn(
        "flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        argent
          ? "border-amber-200 bg-amber-50/40 hover:bg-amber-50"
          : "border-slate-200 hover:bg-slate-50",
        coche && (argent ? "border-amber-400" : "border-slate-400"),
      )}
    >
      <Checkbox
        id={`bloc-${bloc.id}`}
        checked={coche}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-slate-900">{bloc.label}</span>
          <Badge
            variant="outline"
            className={cn(
              "gap-1 text-[10px] font-normal",
              ecrit ? "text-slate-700" : "text-slate-500",
            )}
            title={`${bloc.reads} lecture(s), ${bloc.writes} modification(s)`}
          >
            {ecrit ? (
              <PencilIcon className="size-2.5" />
            ) : (
              <EyeIcon className="size-2.5" />
            )}
            {ecrit ? "Lecture + modification" : "Lecture"}
          </Badge>
        </div>
        <p className="text-xs leading-relaxed text-slate-500">
          {bloc.description}
        </p>
      </div>
    </label>
  );
}

/** Bandeau d'en-tête — rappelle que masquer n'est pas protéger. */
export function TeamPermissionsIntro() {
  return (
    <div className="flex gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-slate-400" />
      <div>
        Un <strong>administrateur</strong> peut déjà tout : ces cases ne
        concernent que les <strong>managers</strong>. Un droit décoché n&apos;est
        pas seulement masqué à l&apos;écran — le serveur refuse l&apos;appel, à
        chaque requête. Cocher ou décocher prend effet immédiatement, sans
        reconnexion.
      </div>
    </div>
  );
}
