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

## Rollout (flux PR obligatoire — la CI bloque le deploy)
- Depuis P5 (de vrais créateurs sont en prod), on NE pousse PLUS jamais
  sur `main` en direct. Flux imposé :
  1. Travailler sur une branche, la pousser (`git push -u origin <branche>`).
  2. Ouvrir une PR vers `main` (`gh pr create`). Le workflow E2E tourne sur
     les PR ciblant `main` → la CI s'exécute AVANT tout merge.
  3. Merger UNIQUEMENT après CI verte. Le deploy Vercel ne part donc que
     d'un `main` validé (la branch protection de `main` exige le check E2E
     et interdit le push direct).
- Flake connu TD-018 : un rerun de la CI autorisé sans analyse si ce sont
  les mêmes specs.
- Après merge : donner dans le rapport le lien de la PR, du run CI et du
  deploy, SANS les babysitter — sauf action post-deploy requise (ex.
  migration prod), auquel cas suivre jusqu'au bout.
- La vérification du vert CI/deploy du chantier N se fait en ouverture
  du chantier N+1.

## Rapports
- Denses, factuels, pas de pédagogie. Anomalies et hypothèses non
  vérifiées clairement signalées.
