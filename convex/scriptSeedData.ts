/* AUTO-GÉNÉRÉ par scripts/gen-bulk-seed.ts depuis
   scripts/systeme-scripts-bulk-testing.md — NE PAS ÉDITER À LA MAIN.
   Contenu (hooks/corps/flux/démo) VERBATIM du doc. Régénérer :
   npx tsx scripts/gen-bulk-seed.ts */

export const CAMPAIGN_NAME = "RepackIt — Bulk Testing";

export type SeedBrick = {
  kind: "hook" | "corps" | "flux" | "cta";
  label: string;
  content: string;
  tier: "S" | "A" | "B" | null;
  active: boolean;
};

export const DEMO_BLOCK = "1. Aller sur RepackIt.io (ou coller l'URL dans le scanner).\n2. Déposer sa vidéo / la décrire / coller l'URL d'une vidéo performante.\n3. Le système analyse et compare aux vidéos les plus performantes du moment sur YouTube.\n4. Il sort 3 titres + 1 miniature, calés sur ce qui performe.\n5. Télécharger la miniature, copier le titre, uploader.\n6. Regarder le CTR / les vues monter après publication.";

export const SEED_BRICKS: SeedBrick[] = [
  {
    "kind": "corps",
    "label": "Corps A — Aspirationnel",
    "content": "Cette vidéo, c'est un pote qui l'a faite. Elle a fait +[X vues] grâce à YouTube et sur sa chaîne monétisée ça lui fait +[X€] d'AdSense [dashboard en b-roll]. Il n'a aucune compétence en design, le packaging lui a pris 1 minute, alors voilà exactement comment tu peux faire pareil.",
    "tier": null,
    "active": true
  },
  {
    "kind": "corps",
    "label": "Corps B — Mécanique",
    "content": "Les chaînes YouTube qui cartonnent, c'est pas le contenu qui fait la différence, c'est leur packaging. [b-roll : compare 2 miniatures, ou un dashboard réel] Elles ont un meilleur combo titre, miniature et contenu, donc elles ont plus de clics, plus de vues et plus d'AdSense. Alors voilà exactement comment faire.",
    "tier": null,
    "active": true
  },
  {
    "kind": "flux",
    "label": "Flux 1 — Upload",
    "content": "Tu vas sur RepackIt.io, tu déposes le fichier de ta vidéo ou tu la décris avec tes mots. Le système analyse ton contenu dans son ensemble et le compare aux vidéos les plus virales du moment sur YouTube. Il te sort 3 titres et une miniature qui donnent envie de cliquer, en accord avec ta vidéo, calés sur ce qui performe en ce moment. Tu télécharges la miniature, tu copies le titre, t'uploades, et tu maximises tes vues sur chaque vidéo que tu postes.",
    "tier": null,
    "active": true
  },
  {
    "kind": "flux",
    "label": "Flux 2 — Scan & clone",
    "content": "Va sur YouTube, choisis une vidéo tendance en ce moment. Copie l'URL de la vidéo, colle-la dans le scanner de RepackIt.io. Regarde toutes les insights et clique sur Repackager. La vidéo est repackagée en 3 minutes, basé sur les données des vidéos les plus performantes du moment. Copie la vidéo de base, publie-la avec un meilleur packaging, et regarde ton CTR monter après publication.",
    "tier": null,
    "active": true
  },
  {
    "kind": "cta",
    "label": "CTA direct",
    "content": "Va sur RepackIt.io.",
    "tier": null,
    "active": true
  },
  {
    "kind": "cta",
    "label": "CTA capture de lead",
    "content": "Si tu veux la marche à suivre complète, commente Go. / Commente App si tu la veux.",
    "tier": null,
    "active": true
  },
  {
    "kind": "hook",
    "label": "Si Netflix tournait ta dernière vidéo, voilà ce qu'ils chang",
    "content": "Si Netflix tournait ta dernière vidéo, voilà ce qu'ils changeraient pour gagner 20 192€.",
    "tier": "S",
    "active": true
  },
  {
    "kind": "hook",
    "label": "Les YouTubeurs ne veulent pas que tu saches ça ❌",
    "content": "Les YouTubeurs ne veulent pas que tu saches ça ❌",
    "tier": "S",
    "active": true
  },
  {
    "kind": "hook",
    "label": "J'ai changé un seul truc sur ma vidéo YouTube et j'ai augmen",
    "content": "J'ai changé un seul truc sur ma vidéo YouTube et j'ai augmenté mon CTR de 2% en 60 jours, et je gagne 1309€ par vidéo, voilà comment tu peux faire exactement pareil.",
    "tier": "S",
    "active": true
  },
  {
    "kind": "hook",
    "label": "Ce genre de vidéo cartonne sur YouTube grâce à un truc que p",
    "content": "Ce genre de vidéo cartonne sur YouTube grâce à un truc que personne ne regarde.",
    "tier": "S",
    "active": true
  },
  {
    "kind": "hook",
    "label": "Ces chaînes YouTube font des dizaines de milliers par mois s",
    "content": "Ces chaînes YouTube font des dizaines de milliers par mois sans visage et sans équipe, et pourtant la variable qui leur permet de faire autant, c'est celle que la majorité des créateurs ignorent.",
    "tier": "S",
    "active": true
  },
  {
    "kind": "hook",
    "label": "« Frère, l'automatisation YouTube c'est trop dur »",
    "content": "« Frère, l'automatisation YouTube c'est trop dur »",
    "tier": "S",
    "active": true
  },
  {
    "kind": "hook",
    "label": "Cette vidéo, mon pote en fait des dizaines de similaires et ",
    "content": "Cette vidéo, mon pote en fait des dizaines de similaires et elle lui a rapporté plus que son taf, alors voilà exactement comment tu peux faire pareil.",
    "tier": "A",
    "active": true
  },
  {
    "kind": "hook",
    "label": "Cette chaîne faceless fait environ 10 000€ par mois et le se",
    "content": "Cette chaîne faceless fait environ 10 000€ par mois et le secret c'est pas le contenu, c'est ce que tu vois là, alors voilà exactement comment tu peux faire pareil.",
    "tier": "A",
    "active": true
  },
  {
    "kind": "hook",
    "label": "Ce gars a plusieurs chaînes YouTube et cette vidéo seule lui",
    "content": "Ce gars a plusieurs chaînes YouTube et cette vidéo seule lui a fait +[X€] d'AdSense ce mois-ci, alors voilà exactement comment tu peux faire pareil.",
    "tier": "A",
    "active": true
  },
  {
    "kind": "hook",
    "label": "Cette vidéo a cartonné sur YouTube et a potentiellement fait",
    "content": "Cette vidéo a cartonné sur YouTube et a potentiellement fait [X]€ non pas parce qu'elle est mieux faite, mais parce qu'elle est mieux packagée, alors je t'explique comment faire exactement pareil.",
    "tier": "A",
    "active": true
  },
  {
    "kind": "hook",
    "label": "Cette vidéo a fait [X] de vues. Et la personne qui l'a faite",
    "content": "Cette vidéo a fait [X] de vues. Et la personne qui l'a faite l'a packagée en 1 minute, sans toucher au contenu, donc voilà comment tu peux faire pareil.",
    "tier": "A",
    "active": true
  },
  {
    "kind": "hook",
    "label": "Des inconnus gagnent des milliers d'euros par mois avec ce g",
    "content": "Des inconnus gagnent des milliers d'euros par mois avec ce genre de vidéo. Et c'est reproductible.",
    "tier": "A",
    "active": true
  },
  {
    "kind": "hook",
    "label": "Ceci est une chaîne YouTube faceless à 1000$/mois. Ceci est ",
    "content": "Ceci est une chaîne YouTube faceless à 1000$/mois. Ceci est une chaîne à 10 000$/mois. Ceci est une chaîne à 30 000$/mois. Ceci est une chaîne à 100 000$/mois. Et voici comment tu peux faire pareil.",
    "tier": "A",
    "active": true
  },
  {
    "kind": "hook",
    "label": "Coupe du monde + YouTube = 💰💰💰 Les vidéos de foot et de c",
    "content": "Coupe du monde + YouTube = 💰💰💰 Les vidéos de foot et de coupe du monde sont en train d'exploser en ce moment, regarde ce que YouTube paye 🤯",
    "tier": "A",
    "active": true
  },
  {
    "kind": "hook",
    "label": "J'ai fait [X€]/mois sur YouTube avec des vidéos comme ça alo",
    "content": "J'ai fait [X€]/mois sur YouTube avec des vidéos comme ça alors que je ne sais même pas faire de montage, alors voilà exactement comment tu peux faire pareil.",
    "tier": "B",
    "active": true
  },
  {
    "kind": "hook",
    "label": "Voilà comment je package toutes mes vidéos en 1 minute chacu",
    "content": "Voilà comment je package toutes mes vidéos en 1 minute chacune et je fais des dizaines de milliers d'euros via l'AdSense.",
    "tier": "B",
    "active": true
  },
  {
    "kind": "hook",
    "label": "Voilà comment je fais des miniatures qui me rapportent 7563€",
    "content": "Voilà comment je fais des miniatures qui me rapportent 7563€ par vidéo sans rien connaître en design.",
    "tier": "B",
    "active": true
  },
  {
    "kind": "hook",
    "label": "Voilà comment je gagne 5981€ par vidéo YouTube en ayant arrê",
    "content": "Voilà comment je gagne 5981€ par vidéo YouTube en ayant arrêté de poster des vidéos qui font 200 vues.",
    "tier": "B",
    "active": true
  },
  {
    "kind": "hook",
    "label": "Voilà comment je trouve le bon titre et la bonne miniature p",
    "content": "Voilà comment je trouve le bon titre et la bonne miniature pour chacune de mes vidéos, en 1 min, pour 7631€ de revenus.",
    "tier": "B",
    "active": true
  },
  {
    "kind": "hook",
    "label": "Il n'y a qu'une différence entre un créateur qui fait 10 000",
    "content": "Il n'y a qu'une différence entre un créateur qui fait 10 000€ par vidéo et un qui fait 200 vues, c'est le packaging de ta vidéo. Alors voilà comment faire des packagings performants.",
    "tier": "B",
    "active": true
  },
  {
    "kind": "hook",
    "label": "Voilà comment je transforme une vidéo morte sur une de mes c",
    "content": "Voilà comment je transforme une vidéo morte sur une de mes chaînes en vidéo qui me rapporte 1309€ en 1 minute.",
    "tier": "B",
    "active": true
  },
  {
    "kind": "hook",
    "label": "Voilà comment je multiplie les vues de ma chaîne YouTube qui",
    "content": "Voilà comment je multiplie les vues de ma chaîne YouTube qui me rapportent 1361€ sans toucher à mes vidéos.",
    "tier": "B",
    "active": true
  },
  {
    "kind": "hook",
    "label": "Comment faire 10k/mois sur YouTube : ne fais pas un job à mi",
    "content": "Comment faire 10k/mois sur YouTube : ne fais pas un job à mi-temps, fais ça à la place.",
    "tier": "B",
    "active": true
  },
  {
    "kind": "hook",
    "label": "Ouvre ton ordinateur. Va sur YouTube et trouve une chaîne po",
    "content": "Ouvre ton ordinateur. Va sur YouTube et trouve une chaîne populaire en ce moment, celle-là par exemple a +[X]M d'abonnés et cette vidéo de leur chaîne a fait [X]M de vues, ils ont fait entre [X] et [X]€ de revenus via cette seule vidéo.",
    "tier": "B",
    "active": true
  },
  {
    "kind": "hook",
    "label": "Cette vidéo a fait 800 vues alors qu'elle méritait largement",
    "content": "Cette vidéo a fait 800 vues alors qu'elle méritait largement plus, donc je te montre exactement comment éviter ça sur ta prochaine vidéo et faire 1300€ par vidéo.",
    "tier": "B",
    "active": false
  },
  {
    "kind": "hook",
    "label": "J'ai passé 200 vidéos YouTube là-dedans et à chaque fois le ",
    "content": "J'ai passé 200 vidéos YouTube là-dedans et à chaque fois le même truc casse pour chaque vidéo qui n'a pas marché, alors voilà comment éviter un flop pour ta prochaine vidéo et commencer à gagner 1300€ par vidéo YouTube.",
    "tier": "B",
    "active": false
  },
  {
    "kind": "hook",
    "label": "Comment j'essayais de choisir ma miniature YouTube et je sui",
    "content": "Comment j'essayais de choisir ma miniature YouTube et je suis tombé sur ma photo de fond, vs MAINTENANT. *(format avant/après personnel)*",
    "tier": null,
    "active": false
  },
  {
    "kind": "hook",
    "label": "Regarde ça (YouTube + ce site = 💰💰💰)",
    "content": "Regarde ça (YouTube + ce site = 💰💰💰)",
    "tier": null,
    "active": false
  },
  {
    "kind": "hook",
    "label": "YouTube + ce site = 💰💰💰",
    "content": "YouTube + ce site = 💰💰💰",
    "tier": null,
    "active": false
  }
];
