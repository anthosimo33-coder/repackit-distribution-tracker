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
import { useProject } from "@/components/project/ProjectProvider";
import { ManagerPayReport } from "@/components/admin/ManagerPayReport";
import {
  MANAGER_CPM_MAX,
  currentCpmEntries,
  managerCpmProblem,
  parisDayOf,
  type ManagerCpmProblem,
} from "@/convex/managerCpm";
import { convexErrorMessage } from "@/lib/convex-error";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
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

        <PerimetreCreatrices membre={membre} />

        <RemunerationCpm membre={membre} />
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

/**
 * SUR QUI — les créatrices sur lesquelles ce manager exerce ses droits.
 *
 * Deux états, et la différence est tout le sujet : « Toutes » (rien d'écrit,
 * l'état de départ de chaque manager) et « Seulement celles-ci » (une liste,
 * MÊME VIDE). Une liste vide ne revient pas à « toutes » : elle ferme tout le
 * nominatif, d'où l'avertissement.
 *
 * Enregistré À PART des droits : ce sont deux mutations, deux lignes de journal,
 * et cocher une créatrice ne doit pas renvoyer au serveur les blocs en cours de
 * modification (ni l'inverse).
 */
function PerimetreCreatrices({ membre }: { membre: Membre }) {
  const candidates = useProjectQuery(api.team.listScopeCandidates, {});
  const enregistrer = useProjectMutation(api.team.setMemberCreatorScope);
  const stocke = membre.creatorScope;
  const [toutes, setToutes] = useState(stocke === null);
  const [choix, setChoix] = useState<Id<"creators">[]>(stocke ?? []);
  const [recherche, setRecherche] = useState("");
  const [busy, setBusy] = useState(false);

  // Ids cochés dont la fiche n'existe plus (créatrice supprimée depuis) : ils
  // ne s'affichent pas, ne comptent pas, et partent au prochain enregistrement.
  const supprimees =
    candidates === undefined
      ? []
      : choix.filter((id) => !candidates.some((c) => c._id === id));
  const choixValides = choix.filter((id) => !supprimees.includes(id));
  const modifie =
    toutes !== (stocke === null) ||
    (!toutes &&
      (supprimees.length > 0 ||
        choix.length !== (stocke ?? []).length ||
        choix.some((c) => !(stocke ?? []).includes(c))));

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return (candidates ?? []).filter(
      (c) => q === "" || c.name.toLowerCase().includes(q),
    );
  }, [candidates, recherche]);

  async function go() {
    setBusy(true);
    try {
      const res = await enregistrer({
        membershipId: membre.membershipId,
        creatorScope: toutes ? null : choixValides,
      });
      setChoix(choixValides);
      toast.success(
        `Créatrices de ${membre.email} mises à jour` +
          (res.retirees > 0 || supprimees.length > 0
            ? ` — fiche supprimée retirée de sa liste`
            : ""),
      );
    } catch (e) {
      toast.error(convexErrorMessage(e, "Échec de la mise à jour des créatrices"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" aria-label="Créatrices gérées">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Créatrices
        </div>
        <Button
          size="sm"
          variant={toutes ? "default" : "outline"}
          aria-pressed={toutes}
          onClick={() => setToutes(true)}
          disabled={busy}
        >
          Toutes
        </Button>
        <Button
          size="sm"
          variant={toutes ? "outline" : "default"}
          aria-pressed={!toutes}
          onClick={() => setToutes(false)}
          disabled={busy}
        >
          Seulement celles-ci
        </Button>
        <Button size="sm" onClick={go} disabled={busy || !modifie}>
          {busy && <Loader2Icon className="size-3.5 animate-spin" />}
          Enregistrer les créatrices
        </Button>
      </div>

      {toutes ? (
        <p className="text-xs text-slate-500">
          Ce manager exerce ses droits sur toutes les créatrices du projet, y
          compris celles qui arriveront.
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-500">
            Hors de cette liste, une créatrice est invisible pour lui (fiche,
            comptes, assignments, validation, rushes) et le serveur refuse tout
            geste sur elle. Le Dashboard et le Tracker restent à l&apos;échelle du
            projet. Une créatrice qu&apos;il invite lui-même s&apos;ajoute ici.
          </p>
          {supprimees.length > 0 && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
              <div>
                <strong>
                  {supprimees.length === 1
                    ? "1 créatrice de sa liste a été supprimée"
                    : `${supprimees.length} créatrices de sa liste ont été supprimées`}
                </strong>{" "}
                (sa fiche n&apos;existe plus, elle ne peut donc pas s&apos;afficher ici).
                Elle sera retirée de sa liste au prochain enregistrement.
              </div>
            </div>
          )}
          {choixValides.length === 0 && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
              <div>
                <strong>Aucune créatrice cochée.</strong> Ce n&apos;est pas « toutes » :
                il ne verra aucune fiche, aucun compte, aucun assignment.
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Rechercher une créatrice"
              aria-label="Rechercher une créatrice"
              className="h-8 max-w-xs"
            />
            <span className="text-xs text-slate-400">
              {choixValides.length} cochée{choixValides.length > 1 ? "s" : ""}
            </span>
          </div>
          {candidates === undefined ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="grid max-h-72 gap-1.5 overflow-y-auto sm:grid-cols-2">
              {visibles.map((c) => {
                const id = `perimetre-${membre.membershipId}-${c._id}`;
                const coche = choix.includes(c._id);
                return (
                  <label
                    key={c._id}
                    htmlFor={id}
                    className={cn(
                      "flex min-w-0 cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm hover:bg-slate-50",
                      coche ? "border-slate-400" : "border-slate-200",
                    )}
                  >
                    <Checkbox
                      id={id}
                      checked={coche}
                      onCheckedChange={(v) =>
                        setChoix((prev) =>
                          v === true
                            ? [...prev, c._id]
                            : prev.filter((x) => x !== c._id),
                        )
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-slate-900">
                      {c.name}
                    </span>
                    {(c.status === "paused" || c.status === "churned") && (
                      <Badge variant="outline" className="text-[10px] font-normal text-slate-500">
                        {c.status === "paused" ? "en pause" : "partie"}
                      </Badge>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const CPM_PROBLEME: Record<ManagerCpmProblem, string> = {
  not_a_number: "Un CPM se saisit en chiffres",
  not_positive: "Un CPM doit être supérieur à zéro",
  too_high: `Un CPM ne dépasse pas ${MANAGER_CPM_MAX} pour 1 000 vues`,
};

/** Une ligne de saisie : taux (texte) et date d'effet ("YYYY-MM-DD", "" = depuis toujours). */
type Saisie = { cpm: string; jour: string };

/** Saisie d'un CPM → nombre, virgule acceptée. `null` = champ vide. */
function lireCpm(saisie: string): number | null {
  const t = saisie.trim().replace(",", ".");
  if (t === "") return null;
  return Number(t);
}

/**
 * COMBIEN — la rémunération du manager au CPM, un taux par créatrice
 * (convex/managerCpm.ts).
 *
 * La liste proposée = son périmètre (toutes les créatrices s'il n'est pas
 * restreint), plus celles qui ont déjà un taux : un CPM posé ne disparaît pas de
 * l'écran parce que le périmètre a bougé. Champ vide = elle ne lui rapporte rien.
 *
 * Enregistré À PART des droits et du périmètre, comme eux entre eux : trois
 * mutations, trois sujets, trois lignes de journal.
 */
function RemunerationCpm({ membre }: { membre: Membre }) {
  const { project } = useProject();
  const candidates = useProjectQuery(api.team.listScopeCandidates, {});
  const enregistrer = useProjectMutation(api.team.setManagerCpms);
  const [voirReleve, setVoirReleve] = useState(false);
  const releve = useProjectQuery(
    api.managerPay.getManagerPay,
    voirReleve ? { membershipId: membre.membershipId } : "skip",
  );
  // Figé au montage : « aujourd'hui » à Paris, borne haute des dates d'effet.
  const [aujourdhui] = useState(() => parisDayOf(Date.now()));
  // L'HISTORIQUE est stocké ; on édite l'entrée EN VIGUEUR : son taux et sa date
  // d'effet. Une créatrice arrêtée (entrée à 0) a un taux vide mais reste listée :
  // ses vidéos déjà publiées lui rapportent encore.
  const enVigueur = useMemo(
    () => currentCpmEntries(membre.managerCpms),
    [membre.managerCpms],
  );
  const stocke = useMemo(
    () =>
      new Map<string, Saisie>(
        [...enVigueur.values()].map((e) => [
          e.creatorId,
          {
            cpm: e.cpm > 0 ? String(e.cpm).replace(".", ",") : "",
            // "" = depuis toujours (premier taux sans date).
            jour: e.from !== undefined ? parisDayOf(e.from) : "",
          },
        ]),
      ),
    [enVigueur],
  );
  const [saisies, setSaisies] = useState<Map<string, Saisie>>(stocke);
  const [pourToutes, setPourToutes] = useState("");
  const [jourPourToutes, setJourPourToutes] = useState(aujourdhui);
  const [recherche, setRecherche] = useState("");
  const [busy, setBusy] = useState(false);

  const devise = project.payCurrency ? project.payCurrency.toUpperCase() : "";
  const perimetre = useMemo(
    () => (membre.creatorScope === null ? null : new Set<string>(membre.creatorScope)),
    [membre.creatorScope],
  );

  const listees = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return (candidates ?? []).filter(
      (c) =>
        (perimetre === null || perimetre.has(c._id) || enVigueur.has(c._id)) &&
        (q === "" || c.name.toLowerCase().includes(q)),
    );
  }, [candidates, perimetre, enVigueur, recherche]);

  const erreurs = [...saisies.entries()].flatMap(([id, s]) => {
    const n = lireCpm(s.cpm);
    if (n === null) return [];
    const p = managerCpmProblem(n);
    return p === null ? [] : [{ id, p }];
  });
  // Comparé en NOMBRES au centime : « 0.2 » saisi et « 0,2 » relu sont le même taux.
  const norme = (val: string | undefined) => {
    const n = lireCpm(val ?? "");
    return n === null ? null : Math.round(n * 100) / 100;
  };
  const vide: Saisie = { cpm: "", jour: "" };
  const modifie = [...new Set([...saisies.keys(), ...stocke.keys()])].some((id) => {
    const a = saisies.get(id) ?? vide;
    const b = stocke.get(id) ?? vide;
    return norme(a.cpm) !== norme(b.cpm) || (norme(a.cpm) !== null && a.jour !== b.jour);
  });
  const nbTaux = [...saisies.values()].filter((v) => lireCpm(v.cpm) !== null).length;

  /** Nouveau taux tapé : s'il change, il vaut à partir d'AUJOURD'HUI par défaut. */
  function changerTaux(id: string, cpm: string) {
    setSaisies((prev) => {
      const next = new Map(prev);
      const cur = prev.get(id) ?? vide;
      const avant = stocke.get(id) ?? vide;
      const change = norme(cpm) !== norme(avant.cpm);
      const jour = change && cur.jour === avant.jour ? aujourdhui : cur.jour;
      next.set(id, { cpm, jour });
      return next;
    });
  }

  function changerJour(id: string, jour: string) {
    setSaisies((prev) => new Map(prev).set(id, { ...(prev.get(id) ?? vide), jour }));
  }

  /**
   * « Appliquer » : le taux (s'il est saisi) ET la date d'effet à toutes les
   * créatrices listées. Taux vide = on ne change que la date des taux déjà posés
   * (« en fait, ces taux valent depuis hier »).
   */
  function appliquerPartout() {
    const n = lireCpm(pourToutes);
    if (n !== null) {
      const p = managerCpmProblem(n);
      if (p !== null) {
        toast.error(CPM_PROBLEME[p]);
        return;
      }
    }
    setSaisies((prev) => {
      const next = new Map(prev);
      for (const c of listees) {
        const cur = prev.get(c._id) ?? vide;
        const cpm = n !== null ? pourToutes.trim() : cur.cpm;
        if (lireCpm(cpm) === null) continue;
        next.set(c._id, { cpm, jour: jourPourToutes });
      }
      return next;
    });
  }

  async function go() {
    setBusy(true);
    try {
      const entries = [...saisies.entries()].flatMap(([creatorId, s]) => {
        const cpm = lireCpm(s.cpm);
        return cpm === null
          ? []
          : [{ creatorId: creatorId as Id<"creators">, cpm, fromDay: s.jour === "" ? null : s.jour }];
      });
      await enregistrer({ membershipId: membre.membershipId, entries });
      toast.success(`Rémunération de ${membre.email} mise à jour`);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Échec de la mise à jour de la rémunération"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" aria-label="Rémunération au CPM">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
          <CoinsIcon className="size-3.5 text-amber-600" />
          Rémunération au CPM
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setVoirReleve((v) => !v)}
        >
          {voirReleve ? "Masquer le relevé" : "Voir son relevé"}
        </Button>
        <Button size="sm" onClick={go} disabled={busy || !modifie || erreurs.length > 0}>
          {busy && <Loader2Icon className="size-3.5 animate-spin" />}
          Enregistrer la rémunération
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        Pour chaque créatrice : ce que le manager touche pour 1 000 vues rémunérées
        de ses vidéos assignées{devise ? ` (en ${devise})` : ""}, et{" "}
        <strong>à partir de quelle date</strong> (vidéos publiées à partir de ce
        jour, minuit heure de Paris). Taux vide = elle ne lui rapporte rien. Un
        nouveau taux prend la date du jour par défaut ; les vidéos publiées avant
        gardent leur ancien taux. Changer seulement la date corrige le taux en
        cours. Date vide = depuis toujours (premier taux seulement). Il voit ses
        chiffres dans « Ma rémunération ».
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={pourToutes}
          onChange={(e) => setPourToutes(e.target.value)}
          placeholder="ex. 0,20"
          inputMode="decimal"
          aria-label="CPM pour toutes les créatrices listées"
          className="h-8 w-24"
        />
        <span className="text-xs text-slate-500">à partir du</span>
        <Input
          type="date"
          value={jourPourToutes}
          max={aujourdhui}
          onChange={(e) => setJourPourToutes(e.target.value)}
          aria-label="Date d'effet pour toutes les créatrices listées"
          className="h-8 w-40"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={appliquerPartout}
          disabled={listees.length === 0 || (lireCpm(pourToutes) === null && nbTaux === 0)}
        >
          Appliquer aux {listees.length} créatrice{listees.length > 1 ? "s" : ""} listée
          {listees.length > 1 ? "s" : ""}
        </Button>
        <Input
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher une créatrice"
          aria-label="Rechercher une créatrice (CPM)"
          className="h-8 max-w-xs"
        />
        <span className="text-xs text-slate-400">
          {nbTaux} taux posé{nbTaux > 1 ? "s" : ""}
        </span>
      </div>

      {erreurs.length > 0 && (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            {CPM_PROBLEME[erreurs[0].p]} (entre 0,01 et {MANAGER_CPM_MAX}, champ vide
            pour aucun taux).
          </div>
        </div>
      )}

      {candidates === undefined ? (
        <Skeleton className="h-24 w-full" />
      ) : listees.length === 0 ? (
        <p className="text-xs text-slate-500">
          {recherche.trim() !== ""
            ? "Aucune créatrice ne correspond à la recherche."
            : perimetre === null
              ? "Aucune créatrice sur ce projet pour l'instant."
              : "Aucune créatrice dans son périmètre : coche d'abord celles qu'il gère."}
        </p>
      ) : (
        <div className="grid max-h-96 gap-1.5 overflow-y-auto lg:grid-cols-2">
          {listees.map((c) => {
            const id = `cpm-${membre.membershipId}-${c._id}`;
            const s = saisies.get(c._id) ?? vide;
            const aUnTaux = lireCpm(s.cpm) !== null;
            const cur = enVigueur.get(c._id);
            const horsPerimetre = perimetre !== null && !perimetre.has(c._id);
            return (
              <div
                key={c._id}
                className={cn(
                  "flex min-w-0 flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm",
                  aUnTaux ? "border-amber-300" : "border-slate-200",
                )}
              >
                <label htmlFor={id} className="min-w-0 flex-1">
                  <span className="block truncate text-slate-900">{c.name}</span>
                  {cur !== undefined && cur.cpm === 0 && cur.from !== undefined && (
                    <span className="block text-[11px] text-slate-400">
                      arrêtée le {formatDate(cur.from)}
                    </span>
                  )}
                </label>
                {horsPerimetre && (
                  <Badge variant="outline" className="text-[10px] font-normal text-amber-700">
                    hors périmètre
                  </Badge>
                )}
                <Input
                  id={id}
                  value={s.cpm}
                  onChange={(e) => changerTaux(c._id, e.target.value)}
                  placeholder="—"
                  inputMode="decimal"
                  className="h-7 w-16 text-right"
                />
                <span className="shrink-0 text-xs text-slate-400">/ 1k dès le</span>
                <Input
                  type="date"
                  value={s.jour}
                  max={aujourdhui}
                  disabled={!aUnTaux}
                  onChange={(e) => changerJour(c._id, e.target.value)}
                  aria-label={`Date d'effet du taux (${c.name})`}
                  title={s.jour === "" ? "Vide = depuis toujours" : undefined}
                  className="h-7 w-36"
                />
                {aUnTaux && s.jour === "" && (
                  <span className="shrink-0 text-[11px] text-slate-400">depuis toujours</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {voirReleve &&
        (releve === undefined ? (
          <Skeleton className="h-48 w-full" />
        ) : releve === null || releve.creators.length === 0 ? (
          <p className="text-xs text-slate-500">
            Aucun taux enregistré : rien à relever pour l&apos;instant.
          </p>
        ) : (
          <ManagerPayReport
            data={releve}
            admin={{ membershipId: membre.membershipId, managerLabel: membre.email }}
          />
        ))}
    </div>
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
