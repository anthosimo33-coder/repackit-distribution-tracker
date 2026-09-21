#!/usr/bin/env bash
#
# PASSAGE OBLIGÉ VERS LA PRODUCTION CONVEX — affiche la cible, exige une
# confirmation nominative, puis exécute.
#
# POURQUOI. `npx convex run --prod migrations:…` s'écrit d'une traite et écrit
# en production sans jamais dire où elle va. Une migration mérite exactement la
# même garde qu'un déploiement : elle touche les données de vraies créatrices.
# Le garde scripts/convex-guard.mjs refuse la forme directe ; ce script est ce
# qu'il faut taper à la place.
#
# CE QU'IL AJOUTE, et qui manquait :
#   1. il NOMME la cible (déploiement, projet, équipe) avant de rien faire ;
#   2. il exige qu'on RECOPIE le nom du déploiement — un « oui » réflexe ne
#      suffit pas, il faut avoir lu la ligne ;
#   3. hors terminal (agent, script, CI), il refuse tout net à moins que
#      CONVEX_PROD_CONFIRM porte le nom exact du déploiement. Une exécution
#      automatique ne peut donc pas arriver par omission.
#
# DEUX MODES
#   run      exécute une fonction Convex en production, après confirmation ;
#   confirm  fait la confirmation SEULE et rend la main (sortie 0) — pour un
#            script qui enchaîne ensuite ses propres appels.
#
# `confirm` existe parce qu'un script qui passe vingt appels ne peut pas
# demander vingt confirmations : il demande la SIENNE, une fois, et c'est
# toujours ce fichier qui nomme la cible et juge la réponse. Dupliquer cette
# logique ailleurs, c'est se garantir qu'une des deux copies dérivera.
#
# USAGE
#   ./scripts/convex-prod.sh run <fonction> ['<args json>']
#   CONVEX_PROD_CONFIRM=<déploiement> ./scripts/convex-prod.sh run <fonction> '{}'
#   ./scripts/convex-prod.sh confirm "<ce que l'appelant va faire>"
#
set -euo pipefail

log()  { printf '\033[36m▸\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m✖\033[0m %s\n' "$*" >&2; exit 1; }
warn() { printf '\033[33m!\033[0m %s\n' "$*" >&2; }

MODE="${1:-}"
case "$MODE" in
  run|confirm) ;;
  *) die "Usage : $0 run <fonction> ['<args json>']  |  $0 confirm \"<opération>\"" ;;
esac
shift
FN="${1:-}"
[ -n "$FN" ] || die "Argument manquant. Usage : $0 run <fonction> ['<args json>']  |  $0 confirm \"<opération>\""
shift
FN_ARGS="${1:-{\}}"

# ─── La cible, nommée, AVANT toute écriture ────────────────────────────────────
# `convex deployments` est une LECTURE : il ne déploie rien, il dit seulement
# quel déploiement le CLI considère comme courant, et à quelle équipe/projet.
DEPLOYMENTS="$(npx convex deployments 2>&1 || true)"
PROJECT="$(printf '%s' "$DEPLOYMENTS" | awk -F': *' '/Project:/ {print $2; exit}')"
TEAM="$(printf '%s' "$DEPLOYMENTS" | awk -F': *' '/Team:/ {print $2; exit}')"

# Le nom du déploiement de PRODUCTION ne s'obtient pas de `deployments`, qui
# rend le COURANT (le dev). `dashboard --no-open` imprime l'URL du tableau de
# bord de prod et ne fait rien d'autre — c'est une lecture pure.
#
# Surtout : on n'appelle JAMAIS `convex deploy` ici, pas même en --dry-run. Un
# script dont le rôle est d'empêcher un déploiement accidentel n'a pas à taper
# la commande qu'il protège ; il suffirait qu'un jour un drapeau change de sens.
PROD_NAME="$(npx convex dashboard --prod --no-open 2>/dev/null | sed -nE 's|.*/d/([a-z0-9-]+).*|\1|p' | head -1)"
[ -n "$PROD_NAME" ] || die "Impossible de nommer le déploiement de production — refus par défaut."

if [ "$MODE" = "confirm" ]; then
  DETAIL="   opération   : ${FN}"
else
  DETAIL="   fonction    : ${FN}
   arguments   : ${FN_ARGS}"
fi

cat >&2 <<BANNER

  ┌─────────────────────────────────────────────────────────────┐
  │  ÉCRITURE EN PRODUCTION                                     │
  └─────────────────────────────────────────────────────────────┘
   déploiement : ${PROD_NAME}
   projet      : ${PROJECT:-?}   équipe : ${TEAM:-?}
${DETAIL}

BANNER

# ─── Confirmation ──────────────────────────────────────────────────────────────
if [ -n "${CONVEX_PROD_CONFIRM:-}" ]; then
  [ "$CONVEX_PROD_CONFIRM" = "$PROD_NAME" ] || die \
    "CONVEX_PROD_CONFIRM vaut « $CONVEX_PROD_CONFIRM », le déploiement est « $PROD_NAME » — refus."
  warn "Confirmation par CONVEX_PROD_CONFIRM=$PROD_NAME"
elif [ -t 0 ]; then
  printf '   Recopie le nom du déploiement pour confirmer : ' >&2
  read -r ANSWER
  [ "$ANSWER" = "$PROD_NAME" ] || die "Saisie « $ANSWER » ≠ « $PROD_NAME » — rien n'a été exécuté."
else
  die "Pas de terminal pour confirmer. Relance avec CONVEX_PROD_CONFIRM=$PROD_NAME si c'est délibéré."
fi

if [ "$MODE" = "confirm" ]; then
  log "Cible confirmée : $PROD_NAME"
  exit 0
fi

log "Exécution sur $PROD_NAME : $FN"
exec npx convex run --prod "$FN" "$FN_ARGS"
