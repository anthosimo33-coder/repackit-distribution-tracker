@AGENTS.md

# Règles de session

## Validation
- Local par défaut : tsc + eslint + vitest + UNIQUEMENT les specs e2e
  liées au chantier (fichiers ciblés ou --grep). La suite e2e complète
  est le job de la CI, pas du poste local.
- Pas de `next build` local, sauf si le chantier modifie la config
  build, le routing ou les imports de manière risquée.
- Suite e2e complète en local seulement si le chantier touche l'infra
  de test elle-même (fixtures, auth e2e, helpers).

## Convex — la cible se lit dans la commande, jamais dans l'environnement

`convex deploy` **est** la commande de production : « By default, this deploys
to your prod deployment ». `CONVEX_DEPLOYMENT` pointe le dev et n'y change rien,
et `eval "$(./scripts/convex-local.sh env)"` non plus — seul `--env-file` redirige.

- Backend e2e **local** : `./scripts/convex-local.sh deploy`.
- **Production** : c'est le travail de Vercel, au merge d'une PR. Pour une
  migration, `./scripts/convex-prod.sh run <fn> ['<json>']`, qui affiche la
  cible et exige qu'on recopie le nom du déploiement.
- **Jamais** de code volontairement cassé déployé où que ce soit : une
  contre-épreuve de test (voir la règle « une assertion doit avoir été vue
  rouge ») se joue en local, et on restaure depuis une copie faite AVANT.

Ces deux interdits sont tenus par un hook `PreToolUse` (`.claude/settings.json`
→ `scripts/convex-guard.mjs`, testé par `scripts/convex-guard.test.mjs`) : la
commande est refusée avant exécution, avec le remplacement à taper. Les lectures
prod (`convex data`, `convex export`) restent libres — un garde qui crie sur des
commandes inoffensives finit désactivé.

## Rollout (flux PR auto-merge — fin de session sans attendre la CI)
- On NE pousse JAMAIS sur `main` en direct. Flux :
  1. Travailler sur une branche, la pousser.
  2. Ouvrir une PR vers `main` (`gh pr create`).
  3. `gh pr merge --auto --squash` (ou merge simple selon la convention du
     repo), puis **FIN DE SESSION immédiate, sans attendre la CI**. GitHub
     merge tout seul une fois la CI verte ; le deploy Vercel suit.
- Ne JAMAIS poller le deploy Vercel ni la CI, MÊME quand le chantier touche
  le schéma — SAUF si une action post-deploy t'incombe dans la même session
  (ex. migration prod à exécuter), auquel cas suivre jusqu'au bout.
- L'ouverture du chantier N+1 commence par : vérifier que la PR du chantier
  N est bien mergée (CI verte, deploy Ready). Si elle n'a pas mergé (CI
  rouge), c'est la PREMIÈRE chose à diagnostiquer.
- Flake connu TD-018 : si l'auto-merge est bloqué par ces specs, un
  `gh run rerun` suffit — l'auto-merge se déclenche au vert.
- Prérequis EN PLACE (repo public depuis juin 2026) : « Allow auto-merge »
  activé + branch protection sur `main` (status check requis `test`, PR
  obligatoire, push direct interdit — y compris admin). `--auto` gate donc
  réellement : la PR ne merge qu'au vert. NE PAS pousser sur `main` en direct
  (refusé par la protection) ; toujours passer par une PR.

## Rapports
- Denses, factuels, pas de pédagogie. Anomalies et hypothèses non
  vérifiées clairement signalées.
