/**
 * COPIE des « i » explicatifs du hub Analytics — SOURCE UNIQUE.
 *
 * Un dashboard qu'on doit faire interpréter par quelqu'un n'est pas terminé :
 * chaque carte et chaque colonne au nom insuffisant porte une explication courte,
 * ouverte au clic sur l'icône « i ».
 *
 * Règles de rédaction NON négociables (vérifiées par explanations.test.ts) :
 *  - français simple, comme pour quelqu'un qui découvre le produit ;
 *  - trois phrases maximum ;
 *  - aucun tiret cadratin, aucun jargon, aucun terme anglais non traduit
 *    (« checkout » est toléré : c'est le mot employé partout dans l'app) ;
 *  - toujours dire À QUOI SERT le chiffre, pas seulement ce qu'il mesure.
 *
 * Centralisé ici (et non inline) pour rester relisable d'un bloc et testable.
 */

export const EXPLAIN = {
  // ─── Vue d'ensemble ────────────────────────────────────────────────────────
  clientsPayants:
    "Le nombre de personnes qui paient un abonnement, compté chez Whop qui encaisse vraiment l'argent. C'est le chiffre de référence pour les clients, parce qu'il vient de la source qui reçoit les paiements. Les comptes de test de l'équipe en sont retirés.",
  revenuNet:
    "L'argent qui reste une fois retirés les frais de Whop et de la banque, additionné sur toute la période. C'est ce que le projet gagne réellement, pas le prix affiché au client. Le symbole de la monnaie vient des paiements, il n'est jamais fixé à la main.",
  vuesPromoClient:
    "Combien de vues des vidéos promo il faut en moyenne pour obtenir un client payant. On n'utilise que les vidéos promo, car ce sont les seules qui parlent de l'app. Sert à mesurer l'efficacité de l'acquisition, pas à payer les créatrices.",
  cac:
    "Ce qu'on paie aux créatrices pour gagner un client, calculé seulement les jours solo où une seule créatrice a publié. Ces jours sont les seuls où on sait à qui attribuer les inscriptions. Le reste du temps, l'attribution serait inventée.",
  completionCheckout:
    "Sur cent personnes qui ouvrent l'écran de paiement, combien vont au bout et paient. Un taux bas veut dire que le paiement bloque quelque part. Ne compte que les personnes qui ont suivi toutes les étapes dans l'ordre.",
  visiteurs:
    "Le nombre de personnes qui ont ouvert le site sur la période choisie. Chaque personne n'est comptée qu'une fois par jour. Suit le sélecteur 7, 30 ou 90 jours en haut de page.",
  inscrits:
    "Le nombre de personnes qui ont créé un compte sur la période choisie. Chaque personne n'est comptée qu'une fois par jour. Suit le sélecteur 7, 30 ou 90 jours en haut de page.",
  comptesInternes:
    "Les comptes de l'équipe, retirés de tous les chiffres pour ne pas gonfler les résultats. On les compte quand même ici, par transparence. L'exclusion vaut des deux côtés, côté PostHog et côté Whop.",
  detailParJour:
    "Une ligne par jour avec les chiffres clés, du plus récent au plus ancien. Sert à repérer d'un coup d'œil un pic ou un creux, comme la journée du 27 juillet. Les visiteurs, inscrits, checkouts et paiements viennent de PostHog, le revenu vient de Whop.",

  // ─── Parcours ──────────────────────────────────────────────────────────────
  tunnelVsAtteinte:
    "Le tunnel ne compte que les gens ayant franchi toutes les étapes dans l'ordre. L'atteinte brute compte tous ceux qui ont atteint une étape, même sans avoir franchi les précédentes. L'écart entre les deux révèle les visiteurs anonymes et les défauts de mesure.",
  ecartPaye:
    "Le tunnel affiche 20 personnes qui ont payé, l'atteinte brute en affiche 25. L'app envoie le paiement deux fois, une fois au clic dans le navigateur et une fois à la confirmation sur le serveur. Whop en compte 21 : c'est le 20 du tunnel qui dit vrai.",
  ouSePerdentCheckouts:
    "Ce que deviennent les personnes qui ouvrent le paiement sans payer. Chaque personne compte dans une seule ligne, donc le total est bien celui des non payeurs. Sert à voir si on perd les gens par abandon, par bascule vers le gratuit ou par échec de paiement.",
  parAppareil:
    "Compare le taux de paiement selon que la personne est dans un vrai navigateur ou dans une vue intégrée à une autre app. Une vue intégrée casse souvent le paiement. La comparaison ne porte que sur les checkouts où l'information est connue.",
  delaiPaiement:
    "Le temps entre l'ouverture du paiement et l'abonnement, chez ceux qui vont au bout. On le compare à l'ancien délai au bout duquel l'app abandonnait. Un abandon réglé sous la médiane coupe la majorité des paiements encore en cours.",
  whopSansAcces:
    "Chaque paiement encaissé doit donner un accès dans l'app. Ce compteur montre les paiements reçus chez Whop qui n'ont pas leur accès dans l'app. Au dessus de zéro, un lien technique est cassé et il faut regarder tout de suite.",
  activation:
    "Ce que font les gens après leur inscription : chercher un compte, ajouter une cible, recevoir une alerte. Un client payant et un inscrit gratuit ne s'activent pas pareil, donc on les sépare. Ces étapes ne sont pas sur le chemin du paiement.",
  inscritsSansAcces:
    "Des personnes inscrites qui n'ont ni le plan gratuit ni un abonnement payant. Beaucoup se sont inscrites quand seul le paywall bloquant existait : elles ont vu le prix et n'ont jamais eu accès au produit. C'est le plus gros groupe du tableau, il mérite d'être suivi de près.",

  // ─── Santé produit ─────────────────────────────────────────────────────────
  fiabiliteScans:
    "Sur tous les scans lancés, la part qui a échoué. Le scan est ce qui donne sa valeur au produit : s'il échoue en silence, la personne croit qu'il ne s'est rien passé. Le détail par raison est plus parlant que le taux global.",
  resultatsRecherche:
    "Ce que les gens obtiennent quand ils cherchent un compte : trouvé, privé, introuvable ou erreur. La ligne « aucun résultat émis » compte les recherches qui ne renvoient aucun signal, un trou de mesure côté app. Aide à voir si la recherche déçoit souvent.",
  latencePercue:
    "Le temps d'attente ressenti pendant un scan, selon la taille du compte scanné. Si l'attente n'augmente pas avec la taille du compte, c'est de la file d'attente et pas du calcul. Regardez la médiane et le 9 sur 10 pour l'attente typique et le mauvais cas.",
  medianeP90:
    "La médiane, c'est l'expérience typique : la moitié des gens sont plus rapides, l'autre moitié plus lents. Le 9 sur 10, c'est le mauvais cas encore fréquent : neuf personnes sur dix vivent mieux que ça, une sur dix vit pire. Sur les scans de 1 000 à 10 000 abonnés, la médiane est de 8 secondes mais une personne sur dix attend plus de deux minutes.",
  pointsFriction:
    "Quelqu'un qui clique plusieurs fois de suite au même endroit en quelques secondes, comme on martèle un bouton d'ascenseur qui ne répond pas. C'est le signal de frustration le plus fiable, parce que personne ne clique cinq fois quand tout fonctionne.",

  // ─── Offres & tests ────────────────────────────────────────────────────────
  typesPaywall:
    "Les deux sortes de paywall que l'app affiche aujourd'hui, ce ne sont pas les variantes d'un test. Le paywall bloquant empêche d'accéder tant qu'on n'a pas payé. Le paywall d'appoint propose un supplément sans bloquer.",
  testAB:
    "Un test A/B compare deux offres pour décider laquelle garder. Tant qu'aucun test n'est marqué dans les données, cette carte reste vide. Elle s'allumera d'elle même quand l'app enverra un identifiant de test.",
  conversionParPaywall:
    "L'app a six paywalls différents, mais la donnée actuelle n'en distingue que deux. Tant que l'app n'envoie pas l'identifiant de chaque paywall, quatre d'entre eux restent indistinguables. On préfère un tiret à une conversion inventée.",
  economieOffre:
    "Pour chaque offre, ce qu'il reste après les frais sur un paiement, et par client sur un mois. Le taux de frais est mesuré, prix payé moins argent reçu, jamais supposé. Sert à comparer la rentabilité des offres entre elles.",
  planGratuit:
    "Les personnes qui prennent le plan gratuit, celles qui s'en servent vraiment, et celles qui passent ensuite au payant. « En ont fait usage » veut dire au moins une recherche, un scan ou une cible ajoutée. Un délai négatif veut dire que la personne avait déjà ouvert le paiement avant de prendre le gratuit.",

  // ─── Fiabilité ─────────────────────────────────────────────────────────────
  gardeFous:
    "Des vérifications lancées à chaque synchro pour repérer un chiffre qui se contredit. Si deux sources donnent un total trop différent, le chiffre est masqué au lieu d'être montré faux. Un chiffre absent vaut mieux qu'un chiffre faux.",

  // ─── Acquisition ───────────────────────────────────────────────────────────
  troisCompteurs:
    "Trois compteurs différents qu'il ne faut jamais additionner. Les totales servent aux paliers de bonus des créatrices, les payables au calcul de la paie, les promo à tous les taux de conversion parce que ce sont les seules vidéos qui mentionnent l'app.",
  joursSolo:
    "Les jours où une seule créatrice a publié. Ce sont les seuls où on sait avec certitude à qui attribuer les inscriptions, faute de lien tracké par créatrice.",
  efficaciteCreatrice:
    "La médiane prédit la prochaine vidéo, le taux de vidéos à succès prédit le volume du mois. La moyenne, elle, ne prédit rien, donc on ne l'affiche pas. Sert à repérer les créatrices régulières plutôt que celles à un seul coup de chance.",
} as const;

export type ExplainKey = keyof typeof EXPLAIN;
