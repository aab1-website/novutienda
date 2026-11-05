#!/usr/bin/env bash
# Levanta el emulador de Firestore (proyecto ficticio demo-pruebas, puerto propio
# de firebase.json) y ejecuta el comando recibido; lo apaga al terminar y
# devuelve el código de salida del comando.
#
# Si el puerto ya responde, corta: un emulador ajeno (otra sesión u otro
# worktree) daría fallos aleatorios en vez de un diagnóstico.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUERTO="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$RAIZ/firebase.json','utf8')).emulators.firestore.port)")"

if [[ $# -eq 0 ]]; then
  echo "Uso: scripts/correr-emulador.sh <comando...>" >&2
  exit 2
fi

if curl -fsS -o /dev/null "http://127.0.0.1:${PUERTO}/" 2>/dev/null; then
  echo "El puerto ${PUERTO} ya tiene un emulador (otra sesión u otro worktree); no se corre contra uno ajeno." >&2
  exit 1
fi

cd "$RAIZ"
# Binario global si existe; si no (runner limpio), firebase-tools por npx. La
# versión se toma de FIREBASE_TOOLS_VERSION si está definida.
if command -v firebase >/dev/null 2>&1; then
  FIREBASE=(firebase)
else
  FIREBASE=(npx --yes "firebase-tools@${FIREBASE_TOOLS_VERSION:-latest}")
fi
exec "${FIREBASE[@]}" emulators:exec --only firestore --project demo-pruebas "$*"
