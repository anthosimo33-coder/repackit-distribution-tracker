import { Skeleton } from "@/components/ui/skeleton";

/**
 * SQUELETTES À LA FORME DES ÉCRANS — le chargement annonce ce qui arrive.
 *
 * Un bloc gris générique se lit comme « quelque chose charge ». Un squelette qui
 * a déjà la carte d'action, les trois compteurs et la colonne des gains se lit
 * comme « mon accueil arrive » : l'écran ne SAUTE pas quand les données tombent,
 * les blocs se remplissent à l'endroit où l'œil les attend déjà.
 *
 * Chaque squelette suit la grille RÉELLE de son écran (mêmes colonnes, mêmes
 * rayons, mêmes hauteurs de ligne). Une évolution de mise en page doit se
 * reporter ici, sinon le saut revient.
 */

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 ${className ?? ""}`}>
      {children}
    </div>
  );
}

/** Accueil : carte d'action + compteurs + « Ensuite » | gains + classement. */
export function HomeSkeleton() {
  return (
    <div
      aria-hidden
      className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start"
    >
      <div className="min-w-0 space-y-6">
        <Card className="space-y-4 border-primary/20 sm:p-5">
          <Skeleton className="h-3 w-32" />
          <div className="flex gap-3">
            <Skeleton className="size-11 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-4/5" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>
          <Skeleton className="h-12 w-full rounded-lg sm:w-48" />
        </Card>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="space-y-2 px-3 py-3">
              <Skeleton className="h-7 w-8" />
              <Skeleton className="h-3 w-14" />
            </Card>
          ))}
        </div>
        <div className="space-y-2">
          <Skeleton className="h-5 w-24" />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[62px] w-full rounded-lg" />
          ))}
        </div>
      </div>
      <div className="min-w-0 space-y-6">
        <Card className="space-y-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-2 w-full rounded-full" />
          <Skeleton className="h-3 w-40" />
        </Card>
        <Card className="space-y-3">
          <Skeleton className="h-5 w-40" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2.5">
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

/** Missions : sélecteur À faire / Terminées + groupes de lignes. */
export function MissionsSkeleton() {
  return (
    <div aria-hidden className="space-y-6">
      {[3, 2].map((rows, g) => (
        <div key={g} className="space-y-2">
          <Skeleton className="h-4 w-28" />
          {Array.from({ length: rows }, (_, i) => (
            <Skeleton key={i} className="h-[62px] w-full rounded-lg" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Fiche mission : en-tête + script | avancement et actions. */
export function MissionDetailSkeleton() {
  return (
    <div
      aria-hidden
      className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start"
    >
      <div className="space-y-6">
        <div className="space-y-3">
          <Skeleton className="h-8 w-3/4" />
          <div className="flex gap-2">
            <Skeleton className="h-7 w-28 rounded-full" />
            <Skeleton className="h-7 w-36 rounded-full" />
          </div>
        </div>
        <Card className="space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </Card>
      </div>
      <Card className="space-y-4">
        <Skeleton className="h-5 w-36" />
        <div className="flex items-center gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-6 flex-1 rounded-full" />
          ))}
        </div>
        <Skeleton className="h-11 w-full rounded-lg" />
      </Card>
    </div>
  );
}
