import { Card, CardContent } from "@/components/ui/card";

/**
 * Accueil CLIPPEUR — coquille posée par le chantier « rôles » (PR 1) pour que la
 * redirection par rôle ait une cible réelle et testable. Le contenu (ses comptes
 * et leur phase, sa file de rushes, montage et publication) vient au chantier
 * « espace clippeur ».
 */
export default function ClipHomePage() {
  return (
    <Card>
      <CardContent className="space-y-2 py-10 text-center">
        <p className="text-sm font-medium text-slate-900">
          Ton espace arrive
        </p>
        <p className="text-sm text-slate-500">
          Tu pourras bientôt déclarer tes comptes et recevoir tes rushes ici.
        </p>
      </CardContent>
    </Card>
  );
}
