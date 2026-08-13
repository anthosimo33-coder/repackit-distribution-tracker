#!/usr/bin/env bash
#
# ÉCHOUE si un harnais d'aperçu sans authentification a atterri dans l'arbre.
#
# POURQUOI. Pour rendre un écran de portail hors session pendant le
# développement, la pratique établie est de poser une page jetable sous
# `app/<slug>/login/` : la route est publique (le middleware ne gate pas
# `/login`), donc l'écran s'affiche sans identifiant. C'est commode, et c'est
# EXACTEMENT la classe d'objet qui survit une fois sur vingt — une route réelle
# qui authentifie sans identifiant, oubliée dans un merge vert.
#
# « Je le supprime avant de commiter et je vérifie » n'est pas un contrôle :
# c'est une intention. Ceci en est un.
#
# USAGE
#   ./scripts/verif-harnais.sh              # sur l'arbre de travail
#   ./scripts/verif-harnais.sh origin/main  # sur une référence git
#
set -euo pipefail

REF="${1:-}"

# Les SEULES routes `login` légitimes du dépôt. Toute autre est un harnais.
#   app/login                 — l'écran de connexion réel
#   app/[projectSlug]/login   — l'écran de connexion scopé projet
LEGITIMES=(
  "app/login"
  "app/[projectSlug]/login"
)

if [ -n "$REF" ]; then
  echo "▸ Contrôle du harnais sur $REF"
  FICHIERS=$(git ls-tree -r --name-only "$REF" -- app | grep -E '(^|/)login/' || true)
else
  echo "▸ Contrôle du harnais sur l'arbre de travail"
  FICHIERS=$(git ls-files -- app | grep -E '(^|/)login/' || true)
fi

INTRUS=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  # Répertoire `login` porteur de ce fichier (le premier segment `.../login`).
  dir="${f%%/login/*}/login"
  ok=0
  for l in "${LEGITIMES[@]}"; do
    [ "$dir" = "$l" ] && ok=1 && break
  done
  [ "$ok" -eq 0 ] && INTRUS="${INTRUS}${f}"$'\n'
done <<< "$FICHIERS"

if [ -n "$INTRUS" ]; then
  echo "✖ Harnais d'aperçu SANS AUTHENTIFICATION détecté :" >&2
  echo "$INTRUS" | sed '/^$/d; s/^/    /' >&2
  echo >&2
  echo "  Une page sous app/<slug>/login/ est une route PUBLIQUE : elle rend" >&2
  echo "  des écrans sans identifiant. Supprime-la, ou ajoute son chemin à" >&2
  echo "  LEGITIMES dans ce script si c'est un vrai écran de connexion." >&2
  exit 1
fi

echo "✔ Aucun harnais — seules les routes de connexion légitimes sont présentes."
