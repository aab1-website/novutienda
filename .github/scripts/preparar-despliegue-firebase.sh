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
# Entradas (entorno): AMBIENTE (staging | production), PROYECTO, SITIO_ID, PANEL_ID, PANEL_URL, SOLO (la lista de
# `firebase deploy --only`), SITIOS_TENANT (secreto opcional, JSON de los sitios por tenant) y P_<PARÁMETRO>.
# Antes de los targets, `scripts/sitios-tenant.mjs validar-solo` comprueba SOLO y falla cerrado (paso 2b).
# Sin valores por defecto para lo que identifica al cliente o abre superficie: MEDIOS_BASE_URL y
# MEDIOS_BUCKET_PUBLICO son obligatorias, y en production APP_CHECK_EXIGIDO debe ser true.
# MEDIOS_BUCKET_PUBLICO es el bucket público aparte (solo tenants/<t>/publico/medios/), nunca el bucket por defecto
# del proyecto; si MEDIOS_BASE_URL es de Cloud Storage (cualquiera de sus tres formas), su bucket debe ser exactamente ese.
# FFMPEG_PATH y FFPROBE_PATH valen /usr/bin/ffmpeg y /usr/bin/ffprobe salvo P_FFMPEG_PATH / P_FFPROBE_PATH; nunca vacíos.
# Ningún parámetro de Functions puede ser PLATAFORMA_PRUEBAS ni FUNCTIONS_EMULATOR (la guardia no se apaga en la nube).
# Los errores nunca imprimen los valores.
set -euo pipefail

error() { echo "::error::$*"; exit 1; }

[[ "${AMBIENTE:-}" == "staging" || "${AMBIENTE:-}" == "production" ]] \
  || error "AMBIENTE debe ser staging o production."
for v in PROYECTO SITIO_ID PANEL_ID PANEL_URL P_APP_CHECK_EXIGIDO P_SITIO_URL P_MEDIOS_BASE_URL P_MEDIOS_BUCKET_PUBLICO; do
  [[ -n "${!v:-}" ]] || error "Falta la variable ${v#P_} (Environment o repositorio). Ver docs/produccion/pase-a-staging.md."
done
[[ "$P_APP_CHECK_EXIGIDO" == "true" || "$P_APP_CHECK_EXIGIDO" == "false" ]] \
  || error "APP_CHECK_EXIGIDO debe ser true o false."
if [[ "$AMBIENTE" == "production" && "$P_APP_CHECK_EXIGIDO" != "true" ]]; then
  error "En production APP_CHECK_EXIGIDO debe ser true (docs/produccion/funciones.md §9)."
fi
[[ "$P_MEDIOS_BASE_URL" =~ ^https://[^[:space:]/]+ ]] \
  || error "MEDIOS_BASE_URL debe ser una URL https (Hosting o un bucket público aparte solo para publico/; nunca el bucket por defecto). Ver docs/produccion/pase-a-staging.md."
# Mismo patrón que NOMBRE_BUCKET de plataforma/funciones/servidor/config.ts; mantener ambos iguales.
[[ "$P_MEDIOS_BUCKET_PUBLICO" =~ ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$ ]] \
  || error "MEDIOS_BUCKET_PUBLICO no es un nombre de bucket válido (solo el nombre, sin gs:// ni barras)."
if [[ "$P_MEDIOS_BUCKET_PUBLICO" == "${PROYECTO}.appspot.com" || "$P_MEDIOS_BUCKET_PUBLICO" == "${PROYECTO}.firebasestorage.app" ]]; then
  error "MEDIOS_BUCKET_PUBLICO no puede ser el bucket por defecto del proyecto."
fi
# Coherencia base <-> bucket. Se comparan como las normaliza config.ts (sin barras finales). Si la base es de Cloud
# Storage en cualquiera de sus formas, el bucket debe ser exactamente MEDIOS_BUCKET_PUBLICO:
#   https://storage.googleapis.com/<bucket> · https://storage.cloud.google.com/<bucket> · https://<bucket>.storage.googleapis.com
# Una base que no es de Storage (Hosting o CDN) se acepta.
base="$P_MEDIOS_BASE_URL"
while [[ "$base" == */ ]]; do base="${base%/}"; done
resto="${base#https://}"
host="${resto%%/*}"
ruta=""
[[ "$resto" == */* ]] && ruta="/${resto#*/}"
[[ "$host" != *@* ]] || error "MEDIOS_BASE_URL no puede llevar credenciales (usuario@host)."
host="${host%%:*}"
host="${host,,}"
case "$host" in
  storage.googleapis.com | storage.cloud.google.com)
    [[ "$ruta" == "/$P_MEDIOS_BUCKET_PUBLICO" ]] \
      || error "MEDIOS_BASE_URL apunta a Cloud Storage ($host) pero su ruta no es exactamente /<MEDIOS_BUCKET_PUBLICO>."
    ;;
  *.storage.googleapis.com)
    [[ "$host" == "${P_MEDIOS_BUCKET_PUBLICO}.storage.googleapis.com" && -z "$ruta" ]] \
      || error "MEDIOS_BASE_URL apunta a Cloud Storage (<bucket>.storage.googleapis.com) pero el bucket no es exactamente MEDIOS_BUCKET_PUBLICO o lleva ruta."
    ;;
esac

# 2. Configuración compuesta en el build.
[[ -f dist/firebase.json ]] || error "El artifact no trae dist/firebase.json (scripts/build.mjs lo genera)."
filtro='del(.hosting[] | select(.target == "sitio" or .target == "panel") | .headers[] | select(.source == "**") | .headers)'
if ! diff <(jq -S "$filtro" firebase.json) <(jq -S "$filtro" dist/firebase.json) >/dev/null; then
  error "dist/firebase.json no corresponde al firebase.json de este commit (fuera de la CSP del sitio)."
fi
cp dist/firebase.json firebase.json

# 2b. Guardia de alcance (PR C, R8): FIREBASE_DEPLOY_ONLY no puede desplegar los sitios de tenant desde este CI.
#     staging: lista permitida (functions, firestore, storage, hosting:panel); production: DC3 y nunca un sitio de tenant.
#     Falla cerrado: SOLO vacío o ausente es error (firebase deploy sin --only lo desplegaría todo), y cualquier código
#     distinto de 0 de sitios-tenant.mjs (inválido, uso o error inesperado) detiene el despliegue antes de tocar la nube.
[[ -n "${SOLO:-}" ]] || error "Falta SOLO (FIREBASE_DEPLOY_ONLY o su valor por defecto del workflow)."
if ! node scripts/sitios-tenant.mjs validar-solo --ambiente "$AMBIENTE" --solo "$SOLO" --sitios "${SITIOS_TENANT:-}"; then
  error "La guardia de FIREBASE_DEPLOY_ONLY rechazó el alcance del despliegue en $AMBIENTE (los sitios de tenant los despliega solo reconstruir-sitio.yml). Ver docs/produccion/reconstruccion-sitio.md."
fi
# 2c. El id del panel no puede ser el de un sitio de tenant (un SITIOS_TENANT o un FIREBASE_SITE_PANEL mal cargados
#     harían que este CI o reconstruir-sitio.yml pisaran el sitio del otro). SITIOS_TENANT ya pasó validar-solo.
if [[ -n "${SITIOS_TENANT:-}" && "$(jq -r 'if type == "array" then length else 0 end' <<<"$SITIOS_TENANT")" != "0" ]]; then
  if jq -e --arg p "$PANEL_ID" 'any(.[]; .sitio == $p)' <<<"$SITIOS_TENANT" >/dev/null; then
    error "El id del panel (FIREBASE_SITE_PANEL) coincide con el sitio de un tenant en SITIOS_TENANT."
  fi
fi

# 3. Targets de Hosting.
firebase target:apply hosting sitio "$SITIO_ID" --project "$PROYECTO"
firebase target:apply hosting panel "$PANEL_ID" --project "$PROYECTO"

# 4. Parámetros de Functions (no secretos; los secretos viven en Secret Manager).
parametros="${RUNNER_TEMP:-/tmp}/funciones.env"
: >"$parametros"
for nombre in APP_CHECK_EXIGIDO RECAPTCHA_CLAVE_SITIO SITIO_URL MEDIOS_BASE_URL MEDIOS_BUCKET_PUBLICO FUNCIONES_SERVICE_ACCOUNT PROXY_SALTOS; do
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
  [PROXY_SALTOS]=2 [RECAPTCHA_MODO]=real [APP_CHECK_MODO]=real
  [CONTACTO_MAXIMO]=5 [CONTACTO_VENTANA_SEG]=600 [NOVUCHAT_MAXIMO_POR_MINUTO]=120
  [DISPONIBILIDAD_MAXIMO_POR_MINUTO]=60 [CONTACTO_MAXIMO_POR_MINUTO]=30
  [RECAPTCHA_CLAVE_SITIO]="" [FUNCIONES_SERVICE_ACCOUNT]=""
)
for nombre in "${!POR_DEFECTO[@]}"; do
  grep -q "^${nombre}=" "$parametros" || printf '%s=%s\n' "$nombre" "${POR_DEFECTO[$nombre]}" >>"$parametros"
done
# Binarios de video (decisión D1 = A, 11/11/2026): se usa el ffmpeg/ffprobe que trae el runtime de Google para
# Functions (Node 22, Ubuntu 22.04) en /usr/bin. Difiere A PROPÓSITO de config.ts, que deja ambos vacíos para el
# emulador y las pruebas (sin binarios, el video se rechaza con motivo claro). Aquí nunca quedan vacíos: un valor
# vacío desplegaría Functions que rechazan todo video sin avisar. Sobreescribibles con P_FFMPEG_PATH / P_FFPROBE_PATH.
ruta_absoluta='^(/[A-Za-z0-9._+-]+)+$'
for nombre in FFMPEG_PATH FFPROBE_PATH; do
  var="P_${nombre}"
  case "$nombre" in
    FFMPEG_PATH) valor="${!var:-/usr/bin/ffmpeg}" ;;
    FFPROBE_PATH) valor="${!var:-/usr/bin/ffprobe}" ;;
  esac
  [[ "$valor" =~ $ruta_absoluta ]] \
    || error "El parámetro $nombre debe ser una ruta absoluta sin espacios ni caracteres especiales (por defecto /usr/bin/ffmpeg y /usr/bin/ffprobe)."
  printf '%s=%s\n' "$nombre" "$valor" >>"$parametros"
done
# La guardia de configuración (exigirConfiguracionDeServicio, exigirBucketPublico) no debe poder apagarse en staging ni
# en production: ningún parámetro desplegado puede marcar el entorno como pruebas o emulador. Falla cerrado.
prohibidos='^[[:space:]]*(export[[:space:]]+)?(PLATAFORMA_PRUEBAS|FUNCTIONS_EMULATOR)[[:space:]]*='
if grep -Eq "$prohibidos" "$parametros"; then
  error "Los parámetros de Functions incluyen PLATAFORMA_PRUEBAS o FUNCTIONS_EMULATOR; prohibidos fuera del emulador y las pruebas."
fi
echo "FUNCIONES_PARAMETROS=$parametros" >>"${GITHUB_ENV:-/dev/null}"
export FUNCIONES_PARAMETROS="$parametros"
node plataforma/funciones/scripts/empaquetar.mjs
if ! grep -q '^MEDIOS_BASE_URL=' dist/funciones/.env 2>/dev/null \
  || ! grep -q '^MEDIOS_BUCKET_PUBLICO=' dist/funciones/.env 2>/dev/null \
  || ! grep -Eq '^FFMPEG_PATH=/' dist/funciones/.env 2>/dev/null \
  || ! grep -Eq '^FFPROBE_PATH=/' dist/funciones/.env 2>/dev/null; then
  error "empaquetar.mjs no incorporó los parámetros (FUNCIONES_PARAMETROS → dist/funciones/.env). Contrato pendiente: docs/arquitectura/decisiones.md, «Parámetros de Functions en el despliegue»."
fi
# Revisión del resultado empaquetado: firebase deploy lee dist/funciones/.env y .env.<proyecto|alias>.
for archivo in dist/funciones/.env*; do
  [[ -f "$archivo" ]] || continue
  if grep -Eq "$prohibidos" "$archivo"; then
    error "$archivo incluye PLATAFORMA_PRUEBAS o FUNCTIONS_EMULATOR; prohibidos en staging y production."
  fi
done
echo "Hosting: targets sitio y panel aplicados; parámetros de Functions: $(cut -d= -f1 "$parametros" | paste -sd, -)"
