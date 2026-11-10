#!/usr/bin/env bash
# preparar-despliegue-firebase.sh — paso previo a `firebase deploy` en los jobs
# desplegar-staging y desplegar-produccion de ci-node-firebase.yml.
#
# 1. Exige las variables del Environment (ids de los dos sitios y URL del panel).
# 2. Usa dist/firebase.json (CSP sellada del sitio, compuesta por
#    scripts/build.mjs y llegada en el artifact) como firebase.json, tras
#    comprobar que solo difiere del versionado en esa CSP.
# 3. Aplica los targets de Hosting (sitio, panel) a los ids de las variables;
#    .firebaserc es efímero e ignorado por git: ningún id entra al repositorio.
# 4. Escribe los parámetros de Functions en $RUNNER_TEMP/funciones.env y
#    exporta FUNCIONES_PARAMETROS; verifica que empaquetar.mjs los incorpora a
#    dist/funciones/.env. Sin eso, firebase deploy usaría los valores por
#    defecto (SITIO_URL vacío) sin avisar. Ver docs/arquitectura/decisiones.md.
#
# Entradas (entorno): AMBIENTE (staging | production), PROYECTO, SITIO_ID, PANEL_ID, PANEL_URL y P_<PARÁMETRO>.
# Sin valores por defecto para lo que identifica al cliente o abre superficie: TENANT_ID y MEDIOS_BASE_URL son obligatorias,
# y en production APP_CHECK_EXIGIDO debe ser true.
set -euo pipefail

error() { echo "::error::$*"; exit 1; }

[[ "${AMBIENTE:-}" == "staging" || "${AMBIENTE:-}" == "production" ]] \
  || error "AMBIENTE debe ser staging o production."
for v in PROYECTO SITIO_ID PANEL_ID PANEL_URL P_APP_CHECK_EXIGIDO P_SITIO_URL P_MEDIOS_BASE_URL; do
  [[ -n "${!v:-}" ]] || error "Falta la variable ${v#P_} (Environment o repositorio). Ver docs/produccion/pase-a-staging.md."
done
[[ "$P_APP_CHECK_EXIGIDO" == "true" || "$P_APP_CHECK_EXIGIDO" == "false" ]] \
  || error "APP_CHECK_EXIGIDO debe ser true o false."
if [[ "$AMBIENTE" == "production" && "$P_APP_CHECK_EXIGIDO" != "true" ]]; then
  error "En production APP_CHECK_EXIGIDO debe ser true (docs/produccion/funciones.md §9)."
fi
[[ "$P_MEDIOS_BASE_URL" =~ ^https://[^[:space:]/]+ ]] \
  || error "MEDIOS_BASE_URL debe ser una URL https (Hosting o un bucket público aparte solo para publico/; nunca el bucket por defecto). Ver docs/produccion/pase-a-staging.md."

# 2. Configuración compuesta en el build.
[[ -f dist/firebase.json ]] || error "El artifact no trae dist/firebase.json (scripts/build.mjs lo genera)."
filtro='del(.hosting[] | select(.target == "sitio" or .target == "panel") | .headers[] | select(.source == "**") | .headers)'
if ! diff <(jq -S "$filtro" firebase.json) <(jq -S "$filtro" dist/firebase.json) >/dev/null; then
  error "dist/firebase.json no corresponde al firebase.json de este commit (fuera de la CSP del sitio)."
fi
cp dist/firebase.json firebase.json

# 3. Targets de Hosting.
firebase target:apply hosting sitio "$SITIO_ID" --project "$PROYECTO"
firebase target:apply hosting panel "$PANEL_ID" --project "$PROYECTO"

# 4. Parámetros de Functions (no secretos; los secretos viven en Secret Manager).
parametros="${RUNNER_TEMP:-/tmp}/funciones.env"
: >"$parametros"
for nombre in APP_CHECK_EXIGIDO RECAPTCHA_CLAVE_SITIO SITIO_URL MEDIOS_BASE_URL FUNCIONES_SERVICE_ACCOUNT PROXY_SALTOS; do
  var="P_${nombre}"
  valor="${!var:-}"
  [[ "$valor" != *$'\n'* ]] || error "El parámetro $nombre contiene un salto de línea."
  [[ -z "$valor" ]] || printf '%s=%s\n' "$nombre" "$valor" >>"$parametros"
done
# firebase-tools (15.x) en modo no interactivo exige un valor en el dotenv para TODO parámetro definido con
# defineString/defineBoolean, aunque tenga `default` en el código (primer despliegue a staging, 05/11/2026: «In
# non-interactive mode but have no value for … PROXY_SALTOS, RECAPTCHA_MODO, …»). Se escriben los mismos valores por
# defecto de plataforma/funciones/servidor/config.ts para los que no llegaron por variable; mantener ambas listas iguales.
declare -A POR_DEFECTO=(
  [PROXY_SALTOS]=2 [RECAPTCHA_MODO]=real [APP_CHECK_MODO]=real [FFMPEG_PATH]= [FFPROBE_PATH]=
  [CONTACTO_MAXIMO]=5 [CONTACTO_VENTANA_SEG]=600 [NOVUCHAT_MAXIMO_POR_MINUTO]=120
  [DISPONIBILIDAD_MAXIMO_POR_MINUTO]=60 [CONTACTO_MAXIMO_POR_MINUTO]=30
  [RECAPTCHA_CLAVE_SITIO]= [FUNCIONES_SERVICE_ACCOUNT]=
)
for nombre in "${!POR_DEFECTO[@]}"; do
  grep -q "^${nombre}=" "$parametros" || printf '%s=%s\n' "$nombre" "${POR_DEFECTO[$nombre]}" >>"$parametros"
done
echo "FUNCIONES_PARAMETROS=$parametros" >>"${GITHUB_ENV:-/dev/null}"
export FUNCIONES_PARAMETROS="$parametros"
node plataforma/funciones/scripts/empaquetar.mjs
if ! grep -q '^MEDIOS_BASE_URL=' dist/funciones/.env 2>/dev/null; then
  error "empaquetar.mjs no incorporó los parámetros (FUNCIONES_PARAMETROS → dist/funciones/.env). Contrato pendiente: docs/arquitectura/decisiones.md, «Parámetros de Functions en el despliegue»."
fi
echo "Hosting: targets sitio y panel aplicados; parámetros de Functions: $(cut -d= -f1 "$parametros" | paste -sd, -)"
