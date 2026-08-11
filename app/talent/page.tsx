import { Card, CardContent } from "@/components/ui/card";

/**
 * Accueil TALENT — coquille posée par le chantier « rôles » (PR 1) pour que la
 * redirection par rôle ait une cible réelle et testable. Le contenu (brief
 * permanent, vidéos d'exemple, dépôt de rushes, mes dépôts) est le chantier
 * suivant : il n'y a ici AUCUN crochet à remplir, juste un état d'attente honnête.
 */
export default function TalentHomePage() {
  return (
    <Card>
      <CardContent className="space-y-2 py-10 text-center">
        <p className="text-sm font-medium text-slate-900">
          Ton espace arrive
        </p>
        <p className="text-sm text-slate-500">
          Tu pourras bientôt consulter ton brief et déposer tes vidéos ici.
        </p>
      </CardContent>
    </Card>
  );
}
