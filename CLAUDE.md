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

## Rollout
- Après push : donner le lien du run CI et du deploy dans le rapport,
  SANS les babysitter — sauf si le chantier exige une action post-deploy
  (ex. migration prod), auquel cas suivre jusqu'au bout.
- Flake connu TD-018 : un rerun autorisé sans analyse si ce sont les
  mêmes specs.
- La vérification du vert CI/deploy du chantier N se fait en ouverture
  du chantier N+1.

## Rapports
- Denses, factuels, pas de pédagogie. Anomalies et hypothèses non
  vérifiées clairement signalées.
