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
- Prérequis (sinon `--auto` ne gate pas) : « Allow auto-merge » activé sur
  le repo + un status check requis sur `main` (branch protection). Cette
  protection est aujourd'hui indisponible (repo privé sur plan Free) → la
  débloquer (repo public ou GitHub Pro) est le préalable à ce flux ; tant
  qu'elle manque, le gate « CI verte avant merge » est tenu à la main.

## Rapports
- Denses, factuels, pas de pédagogie. Anomalies et hypothèses non
  vérifiées clairement signalées.
