#!/usr/bin/env bash
#
# Backend Convex LOCAL pour les e2e — démarrage, provisionnement, arrêt.
#
# POURQUOI. La suite e2e ne doit pas dépendre d'un déploiement cloud partagé,
# mutable et compté au quota : le 2026-08-07, le déploiement de test cloud a été
# désactivé pour dépassement du plan gratuit et la CI est restée rouge quatre
# jours, tous merges confondus. Le backend Convex est open-source : on le fait
# tourner ici, en SQLite, avec une base NEUVE par run.
#
# Ce script ne touche NI la prod NI `.env.local` : tout son état vit dans
# `.convex-local/` (gitignoré) et les variables self-hosted sont passées au CLI
# par `--env-file`. Mélanger variables cloud et self-hosted dans le même fichier
# est refusé par Convex — et c'est une bonne chose : ça évite de pousser au
# mauvais endroit.
#
# USAGE
#   ./scripts/convex-local.sh start     # démarre + provisionne (idempotent)
#   ./scripts/convex-local.sh reset     # base VIERGE puis start
#   ./scripts/convex-local.sh deploy    # REdéploie les fonctions sur le local
#   ./scripts/convex-local.sh stop
#   ./scripts/convex-local.sh env       # exports pour les tests → eval "$(…)"
#   ./scripts/convex-local.sh status
#
# ⚠️  `deploy` existe pour une raison précise : sans lui, il n'y avait AUCUN
# chemin court pour repousser des fonctions modifiées sur le backend local, et
# on finissait par improviser un `npx convex deploy` — qui part en PRODUCTION
# (« By default, this deploys to your prod deployment »). C'est exactement
# l'incident du 2026-08-27. Le garde scripts/convex-guard.mjs refuse désormais
# cette forme ; cette sous-commande est ce qu'il faut taper à la place.
#
# Puis :
#   eval "$(./scripts/convex-local.sh env)" && pnpm test:e2e
#
set -euo pipefail

# ─── Version ÉPINGLÉE du backend ────────────────────────────────────────────────
# Upstream ne publie AUCUNE matrice de compatibilité CLI ↔ backend, et l'image
# Docker n'existe qu'en `:latest`. Un tag flottant casserait donc un matin sans
# qu'une ligne du repo ait bougé. Ce tag est celui contre lequel la suite complète
# est passée (173 vertes le 2026-08-11) : le monter est une décision DÉLIBÉRÉE
# (relancer la suite entière derrière), jamais automatique.
BACKEND_TAG="${CONVEX_BACKEND_TAG:-precompiled-2026-06-09-b6aaa1a}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$REPO_ROOT/.convex-local"
# Même emplacement de cache que le CLI Convex lui-même : un poste qui a déjà
# utilisé un déploiement local ne retélécharge rien.
BIN_DIR="${HOME}/.cache/convex/binaries/${BACKEND_TAG}"
BIN="$BIN_DIR/convex-local-backend"

PORT="${CONVEX_LOCAL_PORT:-3210}"
SITE_PORT="${CONVEX_LOCAL_SITE_PORT:-3211}"
BACKEND_URL="http://127.0.0.1:${PORT}"

ENV_FILE="$STATE_DIR/env.selfhosted"       # CONVEX_SELF_HOSTED_* (pour le CLI)
DEPLOY_VARS="$STATE_DIR/deployment.env"    # variables POSÉES sur le déploiement
SECRET_FILE="$STATE_DIR/instance-secret"
DB_FILE="$STATE_DIR/convex.sqlite3"
LOG_FILE="$STATE_DIR/backend.log"
PID_FILE="$STATE_DIR/backend.pid"

# Mot de passe du user e2e ET gate des mutations de seed/cleanup (cf README §Auth).
E2E_SECRET_VALUE="${E2E_SECRET:-convex-local-e2e-secret}"

log() { printf '\033[36m▸\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31m✖\033[0m %s\n' "$*" >&2; exit 1; }

# ─── Binaire : téléchargement (une seule fois) ──────────────────────────────────
asset_name() {
  local os arch
  os="$(uname -s)"; arch="$(uname -m)"
  case "$os/$arch" in
    Darwin/arm64)  echo "convex-local-backend-aarch64-apple-darwin.zip" ;;
    Darwin/x86_64) echo "convex-local-backend-x86_64-apple-darwin.zip" ;;
    Linux/x86_64)  echo "convex-local-backend-x86_64-unknown-linux-gnu.zip" ;;
    Linux/aarch64) echo "convex-local-backend-aarch64-unknown-linux-gnu.zip" ;;
    *) die "Plateforme non gérée : $os/$arch" ;;
  esac
}

ensure_binary() {
  [ -x "$BIN" ] && return 0
  local asset url tmp
  asset="$(asset_name)"
  url="https://github.com/get-convex/convex-backend/releases/download/${BACKEND_TAG}/${asset}"
  log "Téléchargement du backend $BACKEND_TAG ($asset, ~55 Mo) — une seule fois"
  mkdir -p "$BIN_DIR"
  tmp="$(mktemp -d)"
  curl -fsSL "$url" -o "$tmp/backend.zip" || die "Téléchargement échoué : $url"
  unzip -q -o "$tmp/backend.zip" -d "$BIN_DIR"
  rm -rf "$tmp"
  chmod +x "$BIN"
  [ -x "$BIN" ] || die "Binaire introuvable après extraction : $BIN"
}

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

wait_ready() {
  local tries=0
  until curl -fsS -o /dev/null "$BACKEND_URL/version" 2>/dev/null; do
    tries=$((tries + 1))
    [ "$tries" -gt 300 ] && { tail -30 "$LOG_FILE" >&2; die "Backend non disponible après 60 s"; }
    sleep 0.2
  done
}

# ─── Provisionnement : clés d'auth + schéma + fonctions ─────────────────────────
# L'ORDRE compte : les variables d'environnement vivent DANS la base du
# déploiement, donc un `reset` les efface — il faut toujours re-poser après avoir
# repoussé le code.
write_deployment_vars() {
  # Clés JWT requises par Convex Auth (mêmes que scripts/generate-jwt-keys.ts).
  #
  # ⚠️ `JWKS` s'écrit en JSON BRUT, jamais requoté : une valeur double-encodée
  # fait répondre au backend « AuthProviderDiscoveryFailed: Failed to parse
  # server response », message qui accuse le réseau alors que la cause est
  # l'encodage. Cf README §Auth.
  #
  # ⚠️ Les valeurs sont écrites dans un FICHIER puis posées via
  # `convex env set --from-file`. Passer la clé privée en argument
  # (`convex env set NAME -- "<PEM>"`) fait interpréter `-----BEGIN` comme une
  # option par le CLI, qui l'ÉCHO EN CLAIR dans son message d'erreur.
  node -e '
    const { generateKeyPairSync } = require("crypto");
    const fs = require("fs");
    const [out, siteUrl, e2eSecret] = process.argv.slice(1);
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" })
      .toString().trimEnd().replace(/\n/g, " ");
    const jwk = publicKey.export({ format: "jwk" });
    const jwks = JSON.stringify({ keys: [{ use: "sig", alg: "RS256", ...jwk }] });
    fs.writeFileSync(out, [
      `JWT_PRIVATE_KEY="${pkcs8}"`,
      `JWKS=${jwks}`,
      `SITE_URL="${siteUrl}"`,
      `E2E_SECRET="${e2eSecret}"`,
      // DEV/TEST UNIQUEMENT (jamais en prod, cf convex/auth.ts) : JWT de 30 j pour
      // qu\aucun refresh (single-use) ne parte pendant un test.
      `JWT_DURATION_MS="2592000000"`,
      "",
    ].join("\n"));
  ' "$DEPLOY_VARS" "http://localhost:3000" "$E2E_SECRET_VALUE"
  chmod 600 "$DEPLOY_VARS"
}

provision() {
  ensure_binary
  cd "$REPO_ROOT"
  log "Poussée du schéma et des fonctions"
  npx convex deploy --env-file "$ENV_FILE" -y >/dev/null
  log "Pose des variables du déploiement (auth + e2e)"
  write_deployment_vars
  npx convex env --env-file "$ENV_FILE" set --from-file "$DEPLOY_VARS" --force >/dev/null
}

start() {
  mkdir -p "$STATE_DIR"
  ensure_binary
  if is_running; then
    log "Backend déjà démarré (PID $(cat "$PID_FILE")) — provisionnement seul"
    provision
    print_env_hint
    return 0
  fi
  [ -f "$SECRET_FILE" ] || { openssl rand -hex 32 > "$SECRET_FILE"; chmod 600 "$SECRET_FILE"; }

  log "Démarrage du backend ($BACKEND_TAG) sur $BACKEND_URL"
  # --disable-beacon : sans lui le backend contacte api.convex.dev à intervalle
  # régulier (uuid de base, révision, uptime). Aucune raison d'émettre de la
  # télémétrie depuis un poste de dev ou un runner CI.
  (
    cd "$STATE_DIR"
    nohup "$BIN" \
      --instance-name convex-local \
      --instance-secret "$(cat "$SECRET_FILE")" \
      --port "$PORT" --site-proxy-port "$SITE_PORT" \
      --local-storage "$STATE_DIR/storage" \
      --disable-beacon \
      "$DB_FILE" > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
  )
  wait_ready
  log "Backend prêt"

  # Clé admin : capacité d'administration du déploiement, dérivée du secret
  # d'instance. Écrite dans un fichier à part, JAMAIS dans `.env.local`.
  {
    echo "CONVEX_SELF_HOSTED_URL=$BACKEND_URL"
    echo "CONVEX_SELF_HOSTED_ADMIN_KEY=$("$BIN" keygen admin-key \
      --instance-name convex-local --instance-secret "$(cat "$SECRET_FILE")")"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"

  provision
  print_env_hint
}

stop() {
  if is_running; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
    log "Backend arrêté"
  else
    log "Aucun backend en cours"
  fi
}

reset() {
  stop
  rm -rf "$DB_FILE"* "$STATE_DIR/storage" "$LOG_FILE"
  log "Base effacée — repartir d'un déploiement VIERGE"
  start
}

# Variables que les specs et le serveur Next attendent. `dotenv` (helpers e2e) et
# Next.js ne PRIMENT pas sur l'environnement réel : les exporter suffit, sans
# jamais toucher `.env.local`.
print_env() {
  echo "export NEXT_PUBLIC_CONVEX_URL=$BACKEND_URL"
  echo "export E2E_SECRET=$E2E_SECRET_VALUE"
}

print_env_hint() {
  log "Pour lancer les tests :  eval \"\$(./scripts/convex-local.sh env)\" && pnpm test:e2e"
}

status() {
  if is_running; then
    echo "backend: EN COURS (PID $(cat "$PID_FILE")) sur $BACKEND_URL — tag $BACKEND_TAG"
    curl -fsS -o /dev/null "$BACKEND_URL/version" && echo "santé:   OK" || echo "santé:   NE RÉPOND PAS"
  else
    echo "backend: arrêté"
  fi
}

# Repousse les fonctions sur le backend LOCAL. Suppose qu'il tourne déjà :
# `start` provisionne, `deploy` ne fait que republier le code.
deploy_local() {
  [ -f "$ENV_FILE" ] || die "backend local non provisionné — lance d'abord : $0 start"
  log "Déploiement des fonctions sur le backend LOCAL ($BACKEND_URL)"
  npx convex deploy --env-file "$ENV_FILE" -y
}

case "${1:-}" in
  start)  start ;;
  stop)   stop ;;
  reset)  reset ;;
  deploy) deploy_local ;;
  env)    print_env ;;
  status) status ;;
  *) die "Usage : $0 {start|stop|reset|deploy|env|status}" ;;
esac
