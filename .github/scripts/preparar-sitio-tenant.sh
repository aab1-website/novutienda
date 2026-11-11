#!/usr/bin/env bash
# preparar-sitio-tenant.sh — paso previo a `firebase deploy --only hosting` en el job reconstruir de
# reconstruir-sitio.yml (un sitio de Hosting por tenant).
#
# Uso: preparar-sitio-tenant.sh <id del sitio esperado>
# Entorno opcional: SITIOS_PROHIBIDOS (ids separados por espacios o comas, p. ej. el sitio del panel): si el sitio
# esperado es uno de ellos, falla. Un SITIOS_TENANT mal cargado no puede pisar el panel.
#
# 1. Exige que dist/firebase.json (compuesto por `scripts/build.mjs --solo sitio --sitio <id>`) declare SOLO la clave
#    `hosting`, con exactamente una entrada, sin `target`, con `site` igual al esperado y un `public` que existe y
#    tiene index.html. Así `firebase deploy` no puede desplegar Functions, reglas, Storage, el panel ni otro sitio,
#    aunque se le pida más de lo debido.
# 2. Usa dist/firebase.json como firebase.json (se despliega exactamente lo que se construyó y se probó).
#
# Los mensajes no imprimen el id del sitio (el log de Actions es público; el job además lo enmascara).
set -euo pipefail

error() { echo "::error::preparar-sitio-tenant: $*"; exit 1; }

esperado="${1:-}"
[[ "$esperado" =~ ^[a-z0-9-]{6,30}$ ]] || error "falta el id del sitio esperado o no cumple ^[a-z0-9-]{6,30}\$."

prohibidos="${SITIOS_PROHIBIDOS:-}"
for p in ${prohibidos//,/ }; do
  [[ "$p" != "$esperado" ]] || error "el sitio pedido es un sitio reservado (panel o sitio del CI); revise SITIOS_TENANT."
done

archivo=dist/firebase.json
[[ -f "$archivo" ]] || error "no existe $archivo (lo genera scripts/build.mjs --solo sitio --sitio <id>)."
jq -e . "$archivo" >/dev/null 2>&1 || error "$archivo no es JSON válido."

claves="$(jq -r 'keys_unsorted | join(",")' "$archivo")"
[[ "$claves" == "hosting" ]] || error "$archivo debe declarar solo la clave hosting (tiene otras claves)."

# hosting puede ser objeto o lista en firebase.json; aquí se exige lista de una entrada (lo que compone build.mjs).
jq -e '.hosting | type == "array" and length == 1' "$archivo" >/dev/null \
  || error "$archivo debe declarar exactamente una entrada de Hosting."
jq -e '.hosting[0] | has("target") | not' "$archivo" >/dev/null \
  || error "la entrada de Hosting no debe usar target (se despliega por site)."
sitio="$(jq -r '.hosting[0].site // ""' "$archivo")"
[[ "$sitio" == "$esperado" ]] || error "el site de $archivo no es el sitio esperado para esta clave."

publico="$(jq -r '.hosting[0].public // ""' "$archivo")"
[[ -n "$publico" && "$publico" != /* && "$publico" != *..* ]] || error "public de Hosting ausente o fuera del repositorio."
[[ -f "$publico/index.html" ]] || error "public de Hosting no tiene index.html."

cp "$archivo" firebase.json
echo "Hosting: firebase.json listo con una sola entrada (site verificado); nada más se despliega."
