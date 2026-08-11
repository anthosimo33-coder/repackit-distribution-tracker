/**
 * Filtre CAMPAGNE de la vue Assignments — construction des options, prédicat de
 * filtrage, et assainissement de la sélection persistée.
 *
 * Pourquoi un module à part : ces trois règles ont chacune un piège vécu, et
 * elles sont testables sans monter la page (lib/assignment-campaign-filter.test.ts).
 *
 * Remplace l'ancien filtre « Tous formats », qui était structurellement mort :
 * ses options venaient des seules assignations de type FORMAT (`formatId`), or
 * la prod n'en compte AUCUNE — 139/139 sur Snytch et 35/35 sur RepackIt sont
 * d'origine script. Le menu ne contenait donc que sa propre ligne « Tous
 * formats ». Pire, son prédicat `a.formatId !== choix` aurait masqué d'un coup
 * toutes les assignations de script le jour où un format serait apparu.
 */

/**
 * Valeur SENTINELLE des assignations sans campagne. Un id Convex ne peut pas la
 * heurter (préfixe réservé) — la sélection reste donc une simple liste de chaînes.
 */
export const NO_CAMPAIGN = "__sans_campagne__";

/** Une assignation, vue par le filtre. */
export interface CampaignFilterable {
  scriptCampaignId?: string | null;
  scriptCampaignName?: string | null;
  scriptCampaignStatus?: "active" | "archived" | null;
}

export interface CampaignOption {
  value: string;
  label: string;
  /** Nombre d'assignations portées — affiché et servant au tri. */
  count: number;
  /** Section d'affichage : les archivées sont groupées à part. */
  section: "active" | "archived";
}

/**
 * Options du filtre, construites depuis les ASSIGNATIONS et non depuis la table
 * des campagnes : une campagne sans aucune assignation n'a rien à filtrer et
 * n'apparaît pas. C'est exactement ce qui rendait l'ancien filtre inutile.
 *
 * Tri par NOMBRE D'ASSIGNATIONS DÉCROISSANT (pas alphabétique) : les campagnes
 * qui pèsent arrivent en tête, et le compte affiché évite de sélectionner une
 * campagne pour découvrir qu'elle ne contient qu'une ligne. Les archivées
 * forment une seconde section, triée pareil — elles RESTENT sélectionnables :
 * sur Snytch elles portent 23 % des assignations, les masquer rendrait ces
 * livrables introuvables.
 *
 * Une campagne référencée mais absente de la table (supprimée) a un statut
 * `null` : elle est rangée avec les archivées plutôt que d'être perdue.
 *
 * L'entrée « sans campagne » n'est produite QUE s'il existe au moins une
 * assignation concernée. La prod n'en a aucune aujourd'hui ; une entrée
 * permanente serait une ligne qui ne filtre jamais rien — la faute même de
 * l'ancien sélecteur.
 */
export function buildCampaignOptions(
  assignments: readonly CampaignFilterable[],
): CampaignOption[] {
  const byId = new Map<string, CampaignOption>();
  let sansCampagne = 0;

  for (const a of assignments) {
    const id = a.scriptCampaignId ?? null;
    if (id === null) {
      sansCampagne += 1;
      continue;
    }
    const existing = byId.get(id);
    if (existing) {
      existing.count += 1;
      continue;
    }
    byId.set(id, {
      value: id,
      label: a.scriptCampaignName ?? "—",
      count: 1,
      section: a.scriptCampaignStatus === "active" ? "active" : "archived",
    });
  }

  // Décroissant sur le compte ; à égalité, alphabétique pour un ordre STABLE
  // (sans ce départage, deux campagnes à 3 assignations pourraient permuter
  // d'un rendu à l'autre selon l'ordre d'itération).
  const byCount = (a: CampaignOption, b: CampaignOption) =>
    b.count - a.count || a.label.localeCompare(b.label, "fr");

  const all = [...byId.values()];
  const out = [
    ...all.filter((o) => o.section === "active").sort(byCount),
    ...all.filter((o) => o.section === "archived").sort(byCount),
  ];
  if (sansCampagne > 0) {
    out.push({
      value: NO_CAMPAIGN,
      label: "Sans campagne",
      count: sansCampagne,
      section: "archived",
    });
  }
  return out;
}

/**
 * Une assignation passe-t-elle le filtre ? Set vide = aucun filtre (tout passe),
 * même sémantique que les autres FilterMultiSelect de l'app.
 */
export function matchesCampaignFilter(
  a: CampaignFilterable,
  selected: ReadonlySet<string>,
): boolean {
  if (selected.size === 0) return true;
  const id = a.scriptCampaignId ?? null;
  return id === null ? selected.has(NO_CAMPAIGN) : selected.has(id);
}

/**
 * Ne garde que les valeurs encore proposées.
 *
 * Indispensable pour une sélection PERSISTÉE : une campagne supprimée — ou une
 * clé restaurée dans un AUTRE projet — laisserait un id fantôme qui ne matche
 * rien. L'écran afficherait alors une liste vide sans cause visible, ce qui se
 * lit comme « mes assignations ont disparu ».
 */
export function sanitizeCampaignSelection(
  saved: readonly string[],
  options: readonly CampaignOption[],
): Set<string> {
  const known = new Set(options.map((o) => o.value));
  return new Set(saved.filter((v) => known.has(v)));
}

/**
 * Libellé du déclencheur quand une sélection est active. « 2 sélectionnés » ne
 * dit pas CE QUI est sélectionné ; on nomme donc la première campagne et on
 * compte le reste — un filtre persistant doit se lire d'un coup d'œil au retour
 * sur la page, trois jours plus tard.
 */
export function campaignTriggerLabel(
  selected: ReadonlySet<string>,
  options: readonly CampaignOption[],
  allLabel: string,
): string {
  if (selected.size === 0) return allLabel;
  const picked = options.filter((o) => selected.has(o.value));
  if (picked.length === 0) return allLabel;
  const [first, ...rest] = picked;
  return rest.length === 0 ? first.label : `${first.label} +${rest.length}`;
}
