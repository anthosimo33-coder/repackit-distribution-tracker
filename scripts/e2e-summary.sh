#!/usr/bin/env bash
#
# LANCE LA SUITE E2E, REND LE VERDICT, PUIS LE DÉTAIL.
#
# ⚠️ LE VERDICT VIENT DU CODE DE SORTIE DE PLAYWRIGHT, JAMAIS DU TEXTE.
#
# C'est la règle qui fait tout le script. Le texte du récapitulatif a déjà
# changé de forme deux fois en une journée, et m'a trompé deux fois :
#
#   1. `tail -N` ne montre que la fin — un « 1 failed » placé AVANT la ligne
#      « N passed » disparaît. Onze échecs lus comme deux.
#   2. Playwright préfixe ses lignes de résumé d'échappements ANSI
#      (`ESC[1A ESC[2K`) : un grep ancré en début de ligne rate « N failed » et
#      ne voit que la dernière ligne. Un run rouge y ressemble à un run vert.
#
# Le texte peut encore changer demain. Le code de sortie, non : il vaut 0 si et
# seulement si la suite est verte. Le texte sert donc à savoir CE QUI a échoué,
# jamais SI ça a échoué.
#
# Corollaire tenu plus bas : si le code dit ÉCHEC mais que le texte n'exhibe
# aucune ligne « failed », on le DIT au lieu de faire confiance au texte.
#
# USAGE :  pnpm test:e2e:summary [args playwright]
set -uo pipefail

LOG="${E2E_LOG:-/tmp/e2e-last.log}"
npx playwright test "$@" > "$LOG" 2>&1
CODE=$?

# Détail : lignes de récapitulatif, échappements ANSI retirés au préalable.
DETAIL="$(sed -E $'s/\033\\[[0-9;]*[A-Za-z]//g' "$LOG" \
  | grep -E "^[[:space:]]*[0-9]+ (passed|failed|skipped|flaky|interrupted|did not run)")"

if [ "$CODE" -eq 0 ]; then
  printf '\033[32m✔ SUITE E2E VERTE\033[0m (code de sortie Playwright : 0)\n'
else
  printf '\033[31m✖ SUITE E2E EN ÉCHEC\033[0m (code de sortie Playwright : %s)\n' "$CODE"
fi

echo "─────────── détail du récapitulatif ───────────"
if [ -n "$DETAIL" ]; then
  echo "$DETAIL"
else
  echo "  (aucune ligne de récapitulatif — la suite n'a pas démarré)"
fi
echo "───────────────────────────────────────────────"

# Le texte et le code doivent raconter la même chose. S'ils divergent, c'est le
# texte qui a tort — et il faut le dire, pas le croire.
if [ "$CODE" -ne 0 ] && ! printf '%s' "$DETAIL" | grep -q "failed"; then
  printf '\033[33m!\033[0m Le code dit ÉCHEC alors que le détail n'"'"'exhibe aucun « failed ».\n'
  printf '  Le format du résumé a changé : fie-toi au CODE, et lis %s.\n' "$LOG"
fi

echo "sortie complète : $LOG"
exit "$CODE"
