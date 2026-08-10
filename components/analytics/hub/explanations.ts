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
  coutAcquisition:
    "Ce qu'on paie pour les vidéos promo divisé par le nombre de clients payants : le vrai coût pour gagner un client. Il additionne le fixe et le CPM des publications promo, plus la totalité du bonus de paliers. Le bonus y entre en entier parce qu'un palier ne se gagne que sur des vues promo : une vidéo de chauffe ne fait plus avancer le compteur, donc tout bonus débloqué a bien été gagné par de la promo.",
  coutComplet:
    "Toute la paie créatrices, plus les récompenses en nature déjà gagnées, divisées par le nombre de clients payants. Le warmup est inclus, parce que sans lui aucun compte ne peut publier de promo : c'est le vrai coût du système. Les récompenses promises mais pas encore gagnées n'y sont pas, ce sont des engagements et non des dépenses ; on les voit dans l'onglet Acquisition.",
  revenuParClient:
    "Le revenu net encaissé, divisé par le nombre de clients payants. Ce chiffre monte avec le temps parce que l'abonnement se renouvelle, alors que le coût d'acquisition n'est payé qu'une seule fois. Il est en euros et les deux coûts en dollars : on les regarde côte à côte, jamais soustraits.",
  rpmPromo:
    "Ce que mille vues promo rapportent, ce qu'elles coûtent, et l'écart entre les deux, qui est la marge par millier de vues. Les vues promo excluent les vidéos de chauffe, parce que les vidéos promo sont les seules qui mentionnent l'app. Ce chiffre monte avec le temps sans aucune vue nouvelle, puisque chaque renouvellement s'ajoute au même stock de vues déjà acquises : ce n'est pas un RPM publicitaire figé une fois la vue passée.",
  completionCheckout:
    "Sur cent personnes qui ouvrent l'écran de paiement, combien vont au bout et paient. Un taux bas veut dire que le paiement bloque quelque part. Ne compte que les personnes qui ont suivi toutes les étapes dans l'ordre.",
  visiteurs:
    "Le nombre de personnes qui ont ouvert le site sur la période choisie. Chaque personne n'est comptée qu'une fois par jour. Suit le sélecteur 7, 30 ou 90 jours en haut de page.",
  inscrits:
    "Le nombre de personnes qui ont créé un compte sur la période choisie. Chaque personne n'est comptée qu'une fois par jour. Suit le sélecteur 7, 30 ou 90 jours en haut de page.",
  detailParJour:
    "Une ligne par jour avec les chiffres clés, du plus récent au plus ancien. Sert à repérer d'un coup d'œil un pic ou un creux, comme la journée du 27 juillet. Les visiteurs, inscrits et checkouts viennent de PostHog (le funnel) ; les clients payants, les échecs de paiement et le revenu viennent de Whop, qui encaisse vraiment l'argent.",

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
    "Chaque paiement encaissé doit donner un accès dans l'app. Ce compteur montre les paiements reçus chez Whop qui n'ont pas leur accès applicatif sur la fenêtre. Le webhook fonctionne bien aujourd'hui, donc un petit écart vient plutôt d'un décalage de synchro ou d'un paiement tout récent : c'est un contrôle de cohérence à garder, pas une alarme.",
  activation:
    "Ce que font les gens après leur inscription : chercher un compte, ajouter une cible, recevoir une alerte. Un client payant et un inscrit gratuit ne s'activent pas pareil, donc on les sépare. Ces étapes ne sont pas sur le chemin du paiement.",
  inscritsSansAcces:
    "Des personnes inscrites qui n'ont ni le plan gratuit ni un abonnement payant. Beaucoup se sont inscrites quand seul le paywall bloquant existait : elles ont vu le prix et n'ont jamais eu accès au produit. C'est le plus gros groupe du tableau, il mérite d'être suivi de près.",

  // ─── Santé produit ─────────────────────────────────────────────────────────
  premiereRecherche:
    "Parmi les gens qui ont payé, la part qui obtient un vrai résultat à sa toute première recherche. C'est le moment où un client neuf décide de rester ou de partir : s'il tombe sur un compte privé, introuvable ou une erreur, il a payé pour rien. Le délai dit combien de temps s'écoule entre l'accès ouvert et cette première recherche.",
  fiabiliteScans:
    "Sur tous les scans lancés, la part qui a échoué. Le scan est ce qui donne sa valeur au produit : s'il échoue en silence, la personne croit qu'il ne s'est rien passé. Le détail par raison est plus parlant que le taux global.",
  resultatsRecherche:
    "Ce que les gens obtiennent quand ils cherchent un compte : trouvé, privé, introuvable ou erreur. « Bloqués par le paywall » sont des gens qui ont saisi un nom et à qui l'app a demandé de payer avant de rien leur montrer : c'est un choix produit, pas un bug. Aide à voir combien butent sur le paywall avant tout résultat.",
  latencePercue:
    "Le temps d'attente ressenti pendant un scan, selon la taille du compte scanné. Si l'attente n'augmente pas avec la taille du compte, c'est de la file d'attente et pas du calcul. Regardez la médiane et le 9 sur 10 pour l'attente typique et le mauvais cas.",
  medianeP90:
    "La médiane, c'est l'expérience typique : la moitié des gens sont plus rapides, l'autre moitié plus lents. Le 9 sur 10, c'est le mauvais cas encore fréquent : neuf personnes sur dix vivent mieux que ça, une sur dix vit pire. Sur les scans de 1 000 à 10 000 abonnés, la médiane est de 8 secondes mais une personne sur dix attend plus de deux minutes.",
  pointsFriction:
    "Quelqu'un qui clique plusieurs fois de suite au même endroit en quelques secondes, comme on martèle un bouton d'ascenseur qui ne répond pas. C'est le signal de frustration le plus fiable, parce que personne ne clique cinq fois quand tout fonctionne.",

  // ─── Offres & tests ────────────────────────────────────────────────────────
  litigesRemboursements:
    "Un litige, c'est quand un client demande à sa banque d'annuler un paiement déjà encaissé, et un remboursement, c'est un paiement rendu volontairement. Ces montants sont déjà retirés du revenu net, parce qu'on ne les touchera pas. Répondre à un litige avant la date limite est prioritaire, car les frais de litige coûtent souvent plus cher que l'abonnement lui-même.",
  typesPaywall:
    "Les deux sortes de paywall que l'app affiche aujourd'hui, ce ne sont pas les variantes d'un test. Le paywall bloquant empêche d'accéder tant qu'on n'a pas payé. Le paywall d'appoint propose un supplément sans bloquer.",
  testAB:
    "Un test A/B compare deux offres pour décider laquelle garder ; les assignés sont les personnes tirées au sort dans un bras, pas celles qui ont vu le paywall, car une bonne moitié ne le verra jamais, les sessions dont le bras a été forcé à la main sont écartées, et le sont aussi les personnes dont le bras a changé en cours de route, puisque le bras était tiré deux fois, une fois par le navigateur avant la création du compte et une fois par le serveur au moment de la créer, et que les deux tirages ne tombaient pas toujours d'accord : on ignore alors quel paywall ces personnes ont subi, leur nombre est affiché sous le tableau plutôt que retranché en silence, et ce retrait n'est pas neutre puisqu'elles ont bien vu un paywall et que certaines ont payé, donc on retire de vraies conversions, et on le fait précisément pour ne pas les attribuer au mauvais bras. La complétion se lit sur les checkouts ouverts et sur eux seuls, jamais sur les assignés : c'est la part des gens qui, une fois le paiement ouvert, sont allés au bout ; les nouveaux clients excluent les renouvellements, puisque l'abonnement se resignale à chaque cycle et qu'un réabonné n'a rien décidé devant ce paywall ; les cibles par client ne comptent que celles ajoutées par un client après son paiement, donc ni le plan gratuit, ni ce qui précède l'abonnement, ni les gens qui n'ont jamais payé, et un bras qui n'envoie aucune cible affiche un tiret plutôt qu'un zéro, faute d'être mesuré. Le net par personne assignée rattache l'argent au bras grâce à la donnée déposée sur l'abonnement au moment du paiement, avec un second chemin par l'identifiant de la personne si la première manque, et se divise par les assignés parce que c'est le tirage au sort qui rend les deux bras comparables ; un net à 0,00 € peut signaler un paiement parti en litige, donc exclu tant que la banque n'a pas tranché, et un contrôle vérifie enfin que chaque taux reste sous 100 % et vaut bien le rapport des colonnes affichées, sachant que ce défaut de tirage a été corrigé côté serveur le 8 août 2026 à 10 h 24 UTC : avant cette date, 56 % des personnes dont le bras est vérifiable des deux côtés de l'inscription en changeaient, après, aucune sur quarante-sept, si bien que les données d'avant ne se comparent pas à celles d'après.",
  conversionParPaywall:
    "L'app a sept emplacements de paywall, mais la donnée actuelle n'en distingue que deux. Six sont subis (l'app bloque tant qu'on n'a pas payé), un seul est volontaire (un clic depuis le menu) et ne se compare jamais aux autres. Tant que l'app n'envoie pas l'identifiant de chaque paywall, on préfère un tiret à une conversion inventée.",
  economieOffre:
    "Pour chaque offre, ce qu'il reste après les frais sur un paiement, et par client sur un mois. Le taux de frais est mesuré, prix payé moins argent reçu, jamais supposé. Sert à comparer la rentabilité des offres entre elles.",
  planGratuit:
    "Les personnes qui prennent le plan gratuit, celles qui s'en servent vraiment, et celles qui passent ensuite au payant. « En ont fait usage » veut dire au moins une recherche, un scan ou une cible ajoutée. Un délai négatif veut dire que la personne avait déjà ouvert le paiement avant de prendre le gratuit.",
  coutCibles:
    "Ce que coûte réellement un scan, séparé entre le scan léger et le scan complet. Une cible gratuite ne déclenche que des scans légers, donc son coût suit ce tarif, en dollars, pas celui du scan complet réservé aux cibles payantes. Le chiffre vient du coût réel émis par l'app, pas d'une supposition.",

  // ─── Fiabilité ─────────────────────────────────────────────────────────────
  comptesInternes:
    "Les comptes de l'équipe, retirés de tous les chiffres pour ne pas gonfler les résultats. On les compte quand même ici, par transparence. L'exclusion vaut des deux côtés, côté PostHog et côté Whop.",
  gardeFous:
    "Des vérifications lancées à chaque synchro pour repérer un chiffre qui se contredit. Si deux sources donnent un total trop différent, le chiffre est masqué au lieu d'être montré faux. Un chiffre absent vaut mieux qu'un chiffre faux.",

  // ─── Acquisition ───────────────────────────────────────────────────────────
  troisCompteurs:
    "Quatre compteurs différents qu'il ne faut jamais additionner. Les totales servent à l'affichage et au suivi, les payables au fixe et au CPM, les promo à tous les taux de conversion parce que ce sont les seules vidéos qui mentionnent l'app, et les paliers au cumul qui débloque les bonus. Paliers et payables diffèrent sur une vidéo de chauffe quand même rémunérée : elle est payée, mais elle ne fait pas avancer le palier, parce qu'un bonus de vues ne se gagne que sur des vues de promo.",
  joursSolo:
    "Les jours où une seule créatrice a publié : les seuls où on sait à qui attribuer un client, faute de lien tracké par créatrice. Cette limite ne concerne que l'attribution PAR créatrice. Les coûts globaux de la Vue d'ensemble, eux, divisent la paie par tous les clients et n'ont pas besoin d'attribuer chacun.",
  recompensesNature:
    "Les récompenses qui ne sont pas de l'argent : un téléphone, un ordinateur, une voiture. « Déjà dû » veut dire que le palier est franchi et que l'objet est à livrer, c'est une vraie dépense, comptée dans le coût complet du moteur mais jamais dans le coût par client. « Engagé » veut dire que la promesse existe mais que le palier n'est pas atteint : ce n'est pas encore une dépense, et les montants affichés sont ce que l'objet nous coûte, pas son prix en magasin.",
  efficaciteCreatrice:
    "La médiane prédit la prochaine vidéo, le taux de vidéos à succès prédit le volume du mois. La moyenne, elle, ne prédit rien, donc on ne l'affiche pas. Sert à repérer les créatrices régulières plutôt que celles à un seul coup de chance.",

  // ─── Rétention / churn ─────────────────────────────────────────────────────
  churnResilieExpire:
    "Résilié : la personne a annulé mais garde l'accès jusqu'à la fin de la période payée, elle peut encore revenir. Expiré : la période est finie, l'accès est perdu, c'est le vrai départ. On les sépare parce qu'une résiliation n'est pas encore une perte.",
  tauxResiliation:
    "Sur cent clients payants, combien ont annulé sur la période. Un taux qui monte annonce une perte de revenu à venir. Il ne compte que les annulations, pas encore les accès perdus.",
  delaiResiliation:
    "Le temps entre le premier paiement et l'annulation. Une médiane courte veut dire que les gens partent vite, souvent déçus dès le début. Le 9 sur 10 montre les départs les plus tardifs.",
  tauxRenouvellement:
    "Parmi les abonnements arrivés au bout d'une période, combien ont repayé. C'est ce qui dit si le produit retient vraiment. Sans ce chiffre, aucune projection de revenu ne tient.",
  churnParOffre:
    "Les annulations et les expirations par offre. Sert à voir si un prix retient mieux qu'un autre. À ne lire que quand chaque offre a assez d'abonnements arrivés à échéance.",
  churnAVenir:
    "Les clients qui vont perdre l'accès bientôt : ils ont annulé mais gardent l'accès jusqu'à la fin de leur période payée. Le chiffre projeté montre combien de clients payants il restera après ces départs. Tant que leur accès est valide, ils sont encore récupérables.",
  churnDetail:
    "Le détail de chaque annulation, du délai le plus court au plus long. Une annulation en quelques minutes veut dire que la personne a payé, n'a rien vu et a annulé, c'est un bug ; après des heures ou des jours, elle a eu accès et est partie quand même. L'accès exact côté app n'est pas mesuré ici, donc c'est le délai qui tranche.",
  projectionLtv:
    "Ce qu'un client rapporte sur toute sa vie : le net par paiement multiplié par le nombre moyen de paiements. C'est ce chiffre, comparé au coût d'acquisition, qui dit si le moteur est viable. Il reste un tiret tant que le renouvellement n'est pas mesurable.",
} as const;

export type ExplainKey = keyof typeof EXPLAIN;
