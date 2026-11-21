#!/usr/bin/env bash
# reconstruir-sitio.sh — reconstruye, despliega y certifica el sitio público de UN tenant.
#
# Son los pasos 2 a 9 del job `reconstruir` de .github/workflows/reconstruir-sitio.yml, sin depender de GitHub:
# corre igual en el job de Actions y en un paso de Cloud Build (imagen scripts/constructor-sitio/Dockerfile).
# Contrato con las funciones: docs/produccion/reconstruccion-sitio.md.
#
# Uso: reconstruir-sitio.sh [reconstruir|preparar|desplegar|certificar|cancelar]      (por defecto: reconstruir)
#   preparar     toma el trabajo (en_curso), instala, genera el contenido, compila y prueba dist-real. SIN credenciales
#                de nube: el workflow autentica entre `preparar` y `desplegar`.
#   desplegar    (tras `preparar`) firebase.json de solo este sitio, copia `previa`, deploy (revisando también el
#                registro), humo, certificación (un reintento a los 20 s solo con código 1), cierre `completada` o
#                `fallida` (con etapa y causas), pendientes cubiertos y rezagados.
#   reconstruir  preparar + desplegar en un solo proceso (Cloud Build, que ya corre con su cuenta de servicio).
#   certificar   solo certifica contra lo publicado: no toma trabajo, no compila, no despliega, no cierra nada.
#   cancelar     (paso `if: cancelled()` del workflow) cierra `fallida` con etapa `cancelado` el trabajo que quedó
#                `en_curso` según el estado guardado; no hace nada si no hay trabajo propio o ya se cerró.
#
# Salida: 0 correcto; 10 NO desplegó sin ser un fallo (otro corredor tomó el trabajo -409 o respuesta `repetido`-, o no
# hay trabajo pendiente en modo `pendientes`); 3 certificación a pedido no se pudo hacer (error de operación); 143 por
# cancelación (el trabajo queda `fallida` con etapa `cancelado`); cualquier otro valor, fallo (el trabajo queda `fallida`
# con su etapa: generar, build, pruebas, despliegue, humo o certificacion). `desplegar` tras un `preparar` que terminó
# en 10 también sale con 10 sin hacer nada.
#
# Entradas (variables de entorno; los valores nunca se imprimen: Cloud Build no enmascara, y el repositorio es público;
# las salidas de las herramientas pasan por un filtro que oculta tenant, sitio, URL y proyecto):
#   Todas las fases: CLAVE (^[a-z0-9]{1,12}$) · TENANT · SITIO · URL_SITIO (https, sin ruta) · PROYECTO ·
#     SITIOS_PROHIBIDOS (o FIREBASE_SITE_PANEL; obligatoria) · SITIO_RECONSTRUCCION_SECRETO
#   preparar/reconstruir además: SITIO_NEGOCIO (o SITIO_NEGOCIO_<CLAVE en mayúsculas>), VITE_FIREBASE_PROJECT_ID,
#     VITE_FIREBASE_API_KEY, VITE_RECAPTCHA_ENTERPRISE_SITE_KEY, VITE_FIREBASE_APP_ID, MEDIOS_BASE_URL, VITE_APP_VERSION
#     (o GITHUB_REF_NAME y GITHUB_SHA/COMMIT_SHA), TRABAJO (opcional: id ya conocido; sin él se consulta el primer
#     `pendiente` y MODO_SONDEO=pendientes|todos es obligatorio), APP_ENV (staging por defecto), OMITIR_INSTALAR=1.
#   desplegar/reconstruir además: FIREBASE_TOOLS_VERSION (15.37.0 por defecto); credenciales de nube por defecto de la
#     aplicación o las que fije el job (WIF). No se necesita SITIO_NEGOCIO.
#   certificar: SITIO_NEGOCIO, las VITE_* y MEDIOS_BASE_URL (regenera el contenido para comparar).
#   Opcionales: ESTADO_DIR (carpeta del estado entre fases; por defecto ${RUNNER_TEMP:-${TMPDIR:-/tmp}}/
#     reconstruir-sitio-<CLAVE>), SIMULAR=1 (valida y lista los pasos; no toca la red), RAIZ_REPO (solo pruebas).
# Secretos: SITIO_RECONSTRUCCION_SECRETO y SITIO_NEGOCIO se retiran del entorno del script al arrancar y se pasan SOLO a
# las llamadas que los necesitan (contenido-sitio.mjs; certificar-sitio.mjs sin --contenido), nunca a pnpm, el build,
# vitest ni npm. pnpm, el build y vitest corren además sin las variables de credenciales de nube conocidas.
# Estado entre fases (en ESTADO_DIR, modo 0700): TRABAJO_ID, CONTINUAR, GENERAR_INICIO_MS, PREPARADO, CERRADO y
# sitio/contenido.json (el contenido con que se compila; también se exporta como SITIO_CONTENIDO a build y dist-real).
# Resúmenes: se escriben en GITHUB_STEP_SUMMARY solo si existe.
set -Eeuo pipefail
set -m # cada hijo largo en su propio grupo de procesos: la cancelación puede terminarlo

MODO="${1:-reconstruir}"
case "$MODO" in
  reconstruir | preparar | desplegar | certificar | cancelar) ;;
  *) echo "uso: reconstruir-sitio.sh [reconstruir|preparar|desplegar|certificar|cancelar]" >&2; exit 2 ;;
esac

RAIZ="${RAIZ_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$RAIZ"

EN_GITHUB="${GITHUB_ACTIONS:-}"
aviso() { if [[ -n "$EN_GITHUB" ]]; then echo "::notice::$*"; else echo "AVISO: $*"; fi; }
advertencia() { if [[ -n "$EN_GITHUB" ]]; then echo "::warning::$*"; else echo "ADVERTENCIA: $*"; fi; }
falla_msg() { if [[ -n "$EN_GITHUB" ]]; then echo "::error::$*"; else echo "ERROR: $*" >&2; fi; }
resumen() { if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then cat >>"$GITHUB_STEP_SUMMARY"; else cat >/dev/null; fi; }

CLAVE="${CLAVE:-}"
TENANT="${TENANT:-}"
SITIO="${SITIO:-}"
URL_SITIO="${URL_SITIO:-}"
PROYECTO="${PROYECTO:-}"
TRABAJO="${TRABAJO:-}"
MODO_SONDEO="${MODO_SONDEO:-}"
APP_ENV="${APP_ENV:-staging}"
FIREBASE_TOOLS_VERSION="${FIREBASE_TOOLS_VERSION:-15.37.0}"
SITIOS_PROHIBIDOS="${SITIOS_PROHIBIDOS:-${FIREBASE_SITE_PANEL:-}}"
export APP_ENV SITIOS_PROHIBIDOS

# Los secretos salen del entorno de este proceso: cada llamada que los necesita los recibe explícitamente.
SECRETO="${SITIO_RECONSTRUCCION_SECRETO:-}"
NEGOCIO="${SITIO_NEGOCIO:-}"
if [[ -z "$NEGOCIO" && "$CLAVE" =~ ^[a-z0-9]{1,12}$ ]]; then
  var_negocio="SITIO_NEGOCIO_$(tr '[:lower:]' '[:upper:]' <<<"$CLAVE")"
  NEGOCIO="${!var_negocio:-}"
fi
# shellcheck disable=SC2086 # la expansión de nombres es intencional
unset SITIO_RECONSTRUCCION_SECRETO SITIO_NEGOCIO ${!SITIO_NEGOCIO_@}
[[ -z "$EN_GITHUB" || -z "$SECRETO" ]] || echo "::add-mask::$SECRETO"

falla() { falla_msg "reconstruir ${CLAVE:-?}: $*"; exit 1; }

# --- Validación de entradas (mismos formatos que scripts/sitios-tenant.mjs; mensajes sin valores) ---
validar_entradas() {
  [[ "$CLAVE" =~ ^[a-z0-9]{1,12}$ ]] || falla "la clave no cumple ^[a-z0-9]{1,12}\$."
  local v
  for v in "$TENANT" "$SITIO" "$URL_SITIO"; do
    [[ "$v" != *[$'\n\r']* ]] || falla "un valor del sitio contiene un salto de línea."
    [[ ${#v} -ge 4 ]] || falla "el tenant, el sitio o la URL falta o tiene menos de 4 caracteres."
  done
  [[ "$TENANT" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || falla "tenant ausente o inválido."
  [[ "$SITIO" =~ ^[a-z0-9-]{6,30}$ ]] || falla "sitio ausente o inválido."
  [[ "$URL_SITIO" =~ ^https://[^/?#[:space:]@]+/?$ ]] || falla "url ausente o no es https sin ruta."
  [[ -n "$PROYECTO" && ${#PROYECTO} -ge 4 && "$PROYECTO" != *[$'\n\r']* ]] || falla "falta PROYECTO (o es demasiado corto)."
  [[ -n "${SITIOS_PROHIBIDOS//[[:space:],]/}" ]] || falla "falta SITIOS_PROHIBIDOS (al menos el sitio del panel)."
  # El sitio por defecto de Hosting lleva el id del proyecto: nunca es un sitio de tenant (el panel y el sitio del CI
  # viven ahí). La lista de prohibidos cubre el resto.
  [[ "$SITIO" != "$PROYECTO" && "$SITIO" != "${VITE_FIREBASE_PROJECT_ID:-}" ]] \
    || falla "el sitio pedido es el sitio por defecto del proyecto (reservado)."
  local p
  for p in ${SITIOS_PROHIBIDOS//,/ }; do
    [[ "$p" != "$SITIO" ]] || falla "el sitio pedido es un sitio reservado (panel o sitio del CI); revise SITIOS_TENANT."
  done
  [[ -z "$TRABAJO" || "$TRABAJO" =~ ^[A-Za-z0-9._-]{1,128}$ ]] || falla "TRABAJO no cumple el formato de un id."
  if [[ "$TRABAJO" == "" && ( "$MODO" == "reconstruir" || "$MODO" == "preparar" ) ]]; then
    [[ "$MODO_SONDEO" == "pendientes" || "$MODO_SONDEO" == "todos" ]] \
      || falla "sin TRABAJO hace falta MODO_SONDEO (pendientes o todos)."
  fi
  local host
  host="${URL_SITIO#https://}"; host="${host%/}"
  # Valores que el filtro oculta en las salidas de las herramientas (más largos primero).
  OCULTOS=("$URL_SITIO" "${URL_SITIO%/}" "$host" "$TENANT" "$SITIO" "$PROYECTO")
}

# Oculta los identificadores en lo que imprime una herramienta externa (stdin → stdout).
ocultar() {
  local l v
  while IFS= read -r l || [[ -n "$l" ]]; do
    for v in "${OCULTOS[@]}"; do l="${l//"$v"/***}"; done
    printf '%s\n' "$l"
  done
}

faltantes_publicacion() { # variables de la configuración web y el negocio; deja la lista en FALTAN
  FALTAN=()
  local v
  for v in VITE_FIREBASE_PROJECT_ID VITE_FIREBASE_API_KEY VITE_RECAPTCHA_ENTERPRISE_SITE_KEY VITE_FIREBASE_APP_ID MEDIOS_BASE_URL; do
    [[ -n "${!v:-}" ]] || FALTAN+=("$v")
  done
  [[ -n "$NEGOCIO" ]] || FALTAN+=("SITIO_NEGOCIO_$(tr '[:lower:]' '[:upper:]' <<<"$CLAVE")")
}

validar_entradas

simular() {
  echo "SIMULAR=1: sin red; modo $MODO, sitio $CLAVE."
  local n=0 p
  local pasos=()
  local prep=(
    "tomar el trabajo (en_curso; 409 o repetido = terminar con código 10 sin desplegar)"
    "instalar dependencias (pnpm install --frozen-lockfile)"
    "generar el contenido publicado (exporta SITIO_CONTENIDO)"
    "build del sitio (solo sitio)"
    "prueba dist-real con EXIGIR_DIST=1"
  )
  local desp=(
    "preparar firebase.json (solo este sitio; guardia del panel)"
    "instalar firebase-tools fijado"
    "copia previa (hosting:clone live -> previa)"
    "desplegar solo hosting y revisar el registro"
    "humo de /, /productos y /api/cotizacion"
    "certificar contra el contenido del build (un reintento a los 20 s solo con código 1)"
    "cerrar el trabajo completada (o fallida con etapa y causas)"
    "cerrar pendientes cubiertos"
    "cerrar trabajos rezagados"
  )
  case "$MODO" in
    certificar) pasos=("instalar dependencias (pnpm install --frozen-lockfile)" "comprobar secreto y variables"
      "certificar a pedido (sin --contenido; un reintento a los 20 s solo con código 1)") ;;
    preparar) pasos=("${prep[@]}") ;;
    desplegar) pasos=("${desp[@]}") ;;
    cancelar) pasos=("cerrar fallida con etapa cancelado el trabajo propio que siga en_curso") ;;
    *) pasos=("${prep[@]}" "${desp[@]}") ;;
  esac
  for p in "${pasos[@]}"; do n=$((n + 1)); echo "SIMULAR paso $n: $p"; done
}

if [[ "${SIMULAR:-}" == "1" ]]; then
  simular
  exit 0
fi

# --- Estado de la ejecución (compartido entre fases) ---
DIR="${ESTADO_DIR:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/reconstruir-sitio-${CLAVE}}"
ETAPA="inicio"        # etapa en curso; define la `etapa` del cierre fallida
TRABAJO_ID=""
CONTINUAR="false"
NO_DESPLEGO=0         # 1 cuando termina sin desplegar sin ser un fallo (código 10)
HIJO=""               # proceso largo en segundo plano; la cancelación lo termina
SITIO_CONTENIDO="$DIR/sitio/contenido.json"
ID_EJECUCION="${GITHUB_RUN_ID:-${BUILD_ID:-local}}"
SHA="${GITHUB_SHA:-${COMMIT_SHA:-sin-sha}}"
export VITE_APP_VERSION="${VITE_APP_VERSION:-${GITHUB_REF_NAME:-local}-$SHA}"

guardar() { printf '%s' "$2" >"$DIR/$1"; }
leer_estado() { [[ -f "$DIR/$1" ]] && cat "$DIR/$1" || true; }

# --- Ejecución de procesos ---
# Los hijos largos corren en segundo plano y se espera con `wait`: así una señal de cancelación interrumpe la espera de
# inmediato y la trampa puede cerrar el trabajo (un hijo en primer plano la retrasaría hasta que terminara).
correr() { # comando args...
  "$@" &
  HIJO=$!
  local rc=0
  wait "$HIJO" || rc=$?
  HIJO=""
  return "$rc"
}
filtrado() { "$@" 2>&1 | ocultar; }
# Sin las variables de credenciales de nube conocidas (pnpm, build y vitest no las necesitan).
sin_nube() {
  env -u GOOGLE_APPLICATION_CREDENTIALS -u GOOGLE_GHA_CREDS_PATH -u CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE \
    -u CLOUDSDK_AUTH_ACCESS_TOKEN -u GOOGLE_OAUTH_ACCESS_TOKEN -u FIREBASE_TOKEN "$@"
}
matar_hijo() {
  if [[ -n "${HIJO:-}" ]]; then
    kill -TERM -- "-$HIJO" 2>/dev/null || kill -TERM "$HIJO" 2>/dev/null || true
  fi
}

# contenido-sitio.mjs: recibe el secreto de la cola (y el negocio solo en `generar`); su salida pasa por el filtro.
contenido() {
  local -a e=("SITIO_RECONSTRUCCION_SECRETO=$SECRETO")
  [[ "$1" != "generar" ]] || e+=("SITIO_NEGOCIO=$NEGOCIO")
  local rc=0 salida="$DIR/contenido.out" error="$DIR/contenido.err"
  env "${e[@]}" node scripts/contenido-sitio.mjs "$@" --tenant "$TENANT" --url "$URL_SITIO" >"$salida" 2>"$error" || rc=$?
  ocultar <"$error" >&2
  ocultar <"$salida"
  return "$rc"
}

cerrar_fallida() { # etapa
  [[ -n "$TRABAJO_ID" && ! -f "$DIR/CERRADO" ]] || return 0
  guardar CERRADO 1
  local args=(estado "$TRABAJO_ID" fallida --etapa "$1")
  [[ ! -f "$DIR/sitio/causas.json" ]] || args+=(--causas "$DIR/sitio/causas.json")
  contenido "${args[@]}" || advertencia "$CLAVE: no se pudo cerrar el trabajo como fallida."
  aviso "$CLAVE: etapa fallida: $1."
  falla_msg "$CLAVE: reconstrucción fallida; trabajo cerrado como fallida. Rollback: clonar previa → live del sitio."
}

al_fallar() { # código
  local rc="$1"
  trap - ERR
  set +e
  case "$ETAPA" in
    inicio | tomar | cierre | posterior | certificar_a_pedido) ;;
    instalar) cerrar_fallida generar ;;
    *) cerrar_fallida "$ETAPA" ;;
  esac
  exit "$rc"
}
# shellcheck disable=SC2329  # se invoca por trap
al_cancelar() {
  trap - ERR TERM INT HUP
  set +e
  matar_hijo
  case "$ETAPA" in
    cierre | posterior | certificar_a_pedido) ;;
    *) cerrar_fallida cancelado ;;
  esac
  exit 143
}
trap 'al_fallar $?' ERR
trap al_cancelar TERM INT HUP

instalar_dependencias() {
  if [[ "${OMITIR_INSTALAR:-}" == "1" ]]; then
    echo "Dependencias ya instaladas en la imagen (OMITIR_INSTALAR=1)."
  else
    correr filtrado sin_nube pnpm install --frozen-lockfile
  fi
}

certificar() { # args extra (--contenido ruta); CERT_ENV = variables extra del script. Deja RC e INTENTO.
  local resumen_ruta="$DIR/certificacion.md"
  RC=3
  for INTENTO in 1 2; do
    rm -f "$resumen_ruta"
    RC=0
    correr filtrado env "${CERT_ENV[@]}" node scripts/certificar-sitio.mjs --tenant "$TENANT" --url "$URL_SITIO" --resumen "$resumen_ruta" "$@" || RC=$?
    (( RC == 1 && INTENTO == 1 )) || break
    aviso "$CLAVE: la certificación encontró diferencias (intento 1/2); se repite en 20 s por si el CDN de Hosting aún servía la versión anterior."
    correr sleep 20
  done
  {
    echo "### Certificación del sitio $CLAVE (intento $INTENTO/2)"
    if [[ -f "$resumen_ruta" ]]; then cat "$resumen_ruta"; else echo "Sin tabla: la certificación terminó antes de comparar (código $RC)."; fi
  } | resumen
  case "$RC" in
    0) echo "$CLAVE: el sitio coincide con lo publicado (intento $INTENTO)."; return 0 ;;
    1) falla_msg "$CLAVE: el sitio NO coincide con lo publicado (detalle en el resumen del job)." ;;
    2) falla_msg "$CLAVE: no se pudo certificar (error de uso del script, código 2)." ;;
    3) falla_msg "$CLAVE: no se pudo certificar (error de operación; motivo en el log)." ;;
    *) falla_msg "$CLAVE: no se pudo certificar (código inesperado $RC)." ;;
  esac
  return 1
}

desplegar_firebase() { # el registro completo va a $DIR/despliegue.log; la pantalla lo recibe filtrado
  firebase deploy --only hosting --project "$PROYECTO" --non-interactive \
    --message "sitio $CLAVE ${SHA:0:7} (ejecucion ${ID_EJECUCION})" 2>&1 | tee "$DIR/despliegue.log" | ocultar
}

# --- Fase preparar: tomar, instalar, generar, build, dist-real (sin credenciales de nube) ---
fase_preparar() {
  rm -rf "$DIR"
  (umask 077 && mkdir -p "$DIR/sitio")
  ETAPA="tomar"
  [[ -n "$SECRETO" ]] || falla "falta SITIO_RECONSTRUCCION_SECRETO."
  local id="$TRABAJO" salida rc
  if [[ -z "$id" ]]; then
    id="$(contenido pendiente)"
    if [[ -z "$id" ]]; then
      if [[ "$MODO_SONDEO" == "pendientes" ]]; then
        aviso "$CLAVE: ya no hay trabajo pendiente; nada que hacer."
        guardar CONTINUAR false
        NO_DESPLEGO=1
        return 0
      fi
      echo "$CLAVE: sin trabajo en la cola; reconstrucción pedida."
    fi
  fi
  if [[ -n "$id" ]]; then
    rc=0
    salida="$(contenido estado "$id" en_curso)" || rc=$?
    case "$rc" in
      0)
        if [[ "$salida" == *repetido* ]]; then
          aviso "$CLAVE: el trabajo ya estaba en curso (otro corredor lo tomó); este termina sin desplegar."
          guardar CONTINUAR false
          NO_DESPLEGO=1
          return 0
        fi
        TRABAJO_ID="$id"
        guardar TRABAJO_ID "$id"
        echo "$CLAVE: trabajo tomado (en_curso)." ;;
      3)
        aviso "$CLAVE: el trabajo lo tomó otro corredor (409); este termina sin desplegar."
        guardar CONTINUAR false
        NO_DESPLEGO=1
        return 0 ;;
      *) falla_msg "$CLAVE: no se pudo marcar el trabajo en_curso (código $rc)."; exit 1 ;;
    esac
  fi
  guardar CONTINUAR true

  ETAPA="instalar"
  instalar_dependencias

  ETAPA="generar"
  faltantes_publicacion
  if (( ${#FALTAN[@]} > 0 )); then
    falla_msg "Faltan variables o secretos para reconstruir $CLAVE: ${FALTAN[*]}. Ver docs/produccion/reconstruccion-sitio.md."
    false
  fi
  # Hora de inicio (ms) ANTES de leer lo publicado: tope de «cubiertos».
  guardar GENERAR_INICIO_MS "$(date +%s%3N)"
  contenido generar --salida "$SITIO_CONTENIDO" --causas "$DIR/sitio/causas.json"
  # El build y dist-real compilan y prueban ESTE contenido, no el de ejemplo.
  export SITIO_CONTENIDO

  ETAPA="build"
  export VITE_FIREBASE_AUTH_DOMAIN="${VITE_FIREBASE_PROJECT_ID}.firebaseapp.com"
  correr filtrado sin_nube node scripts/build.mjs --mode "$APP_ENV" --solo sitio --sitio "$SITIO"

  ETAPA="pruebas"
  EXIGIR_DIST=1 correr filtrado sin_nube pnpm vitest run pruebas/website/dist-real.test.ts
  guardar PREPARADO 1
}

# --- Fase desplegar: firebase.json, previa, deploy, humo, certificación, cierres ---
cargar_estado() {
  TRABAJO_ID="$(leer_estado TRABAJO_ID)"
  CONTINUAR="$(leer_estado CONTINUAR)"
  export SITIO_CONTENIDO
}

fase_desplegar() {
  if [[ "$CONTINUAR" != "true" ]]; then
    aviso "$CLAVE: la fase de preparación no dejó trabajo que desplegar."
    NO_DESPLEGO=1
    return 0
  fi
  [[ -f "$DIR/PREPARADO" ]] || falla "falta ejecutar la fase preparar antes de desplegar."
  [[ -n "$SECRETO" ]] || falla "falta SITIO_RECONSTRUCCION_SECRETO."
  local rc log

  ETAPA="despliegue"
  filtrado bash .github/scripts/preparar-sitio-tenant.sh "$SITIO"
  local actual
  actual="$(firebase --version 2>/dev/null || true)"
  if [[ "$actual" != "$FIREBASE_TOOLS_VERSION" ]]; then
    correr filtrado sin_nube npm i -g "firebase-tools@${FIREBASE_TOOLS_VERSION}"
  fi
  # D7: el rollback es clonar previa → live. Sin copia (primer despliegue) se avisa y se continúa.
  correr firebase hosting:channel:create previa --site "$SITIO" --project "$PROYECTO" --expires 30d \
    --non-interactive >/dev/null 2>&1 || true
  correr filtrado firebase hosting:clone "$SITIO:live" "$SITIO:previa" --project "$PROYECTO" \
    || advertencia "$CLAVE: no se pudo guardar la copia para rollback (live → previa). ¿Primer despliegue o sitio sin crear?"

  # `firebase deploy` PUEDE SALIR CON CÓDIGO 0 HABIENDO FALLADO: se revisa también el registro.
  log="$DIR/despliegue.log"
  rc=0
  correr desplegar_firebase || rc=$?
  if grep -qiE 'site not found|404.*site|no site (named|with id)' "$log"; then
    falla_msg "$CLAVE: el sitio de Hosting no existe en el proyecto (paso de alta del tenant)."
    false
  fi
  (( rc == 0 )) || al_fallar "$rc"
  if grep -qiE 'failed to create function|failed to update function|Build failed with status|Deploy failed|had HTTP Error' "$log"; then
    falla_msg "firebase deploy terminó con código 0 pero su registro contiene fallos: el despliegue NO está completo."
    false
  fi
  rm -f "$log"
  echo "### Sitio $CLAVE desplegado" | resumen

  # --- Humo ---
  ETAPA="humo"
  comprobar() { # ruta exigir_csp(si|no)
    local ruta="$1" csp="$2" i codigo cabeceras
    cabeceras="$(mktemp)"
    for ((i = 1; i <= 10; i++)); do
      correr curl -sS --max-time 15 -D "$cabeceras" -o /dev/null -w '%{http_code}' "${URL_SITIO%/}$ruta" >"$DIR/codigo" 2>/dev/null \
        || echo 000 >"$DIR/codigo"
      codigo="$(cat "$DIR/codigo")"
      if [[ "$codigo" == "200" ]] && { [[ "$csp" == "no" ]] || grep -qi '^content-security-policy:' "$cabeceras"; }; then
        echo "OK  $ruta (intento $i)"; rm -f "$cabeceras"; return 0
      fi
      echo "…   $ruta: HTTP $codigo (intento $i/10)"
      correr sleep 15
    done
    rm -f "$cabeceras"
    falla_msg "$CLAVE: humo fallido en $ruta"
    return 1
  }
  local fallos=0
  comprobar / si || fallos=$((fallos + 1))
  # Una página interna sin .html: comprueba las URLs limpias de Hosting.
  comprobar /productos si || fallos=$((fallos + 1))
  comprobar '/api/cotizacion?mercado=BO' no || fallos=$((fallos + 1))
  (( fallos == 0 )) || false

  # --- Certificación contra el MISMO contenido con el que se compiló (sin secretos) ---
  ETAPA="certificacion"
  [[ -f "$SITIO_CONTENIDO" ]] \
    || { falla_msg "$CLAVE: no se pudo certificar (error de operación): falta el contenido generado por el build."; al_fallar 3; }
  CERT_ENV=()
  certificar --contenido "$SITIO_CONTENIDO" || al_fallar "$RC"

  # --- Cierre: completada. Si falla este cierre, el sitio ya está desplegado y probado: no se marca fallida. ---
  ETAPA="cierre"
  if [[ -n "$TRABAJO_ID" ]]; then
    contenido estado "$TRABAJO_ID" completada >/dev/null
  fi
  guardar CERRADO 1

  # --- Pendientes cubiertos y rezagados (un fallo pone la ejecución en rojo, no reabre el trabajo) ---
  ETAPA="posterior"
  local inicio rc_cubiertos=0 rc_rezagados=0
  inicio="$(leer_estado GENERAR_INICIO_MS)"
  if [[ "$inicio" =~ ^[0-9]{13}$ ]]; then
    contenido cubiertos --contenido "$SITIO_CONTENIDO" --hasta-ms "$inicio" || rc_cubiertos=$?
  else
    falla_msg "$CLAVE: falta la hora de inicio del build; no se cierran pendientes (los rezagados sí)."
    rc_cubiertos=1
  fi
  contenido rezagados || rc_rezagados=$?
  (( rc_cubiertos == 0 )) || exit "$rc_cubiertos"
  (( rc_rezagados == 0 )) || exit "$rc_rezagados"
}

# --- Despacho por modo ---
case "$MODO" in
  certificar)
    ETAPA="certificar_a_pedido"
    (umask 077 && mkdir -p "$DIR")
    [[ -n "$SECRETO" ]] \
      || { falla_msg "$CLAVE: no se pudo certificar (error de operación): falta SITIO_RECONSTRUCCION_SECRETO."; exit 3; }
    instalar_dependencias
    faltantes_publicacion
    if (( ${#FALTAN[@]} > 0 )); then
      falla_msg "$CLAVE: no se pudo certificar (error de operación): faltan ${FALTAN[*]}. Ver docs/produccion/reconstruccion-sitio.md."
      exit 3
    fi
    # Sin --contenido el script regenera lo publicado: por eso solo aquí recibe el secreto y el negocio.
    CERT_ENV=("SITIO_RECONSTRUCCION_SECRETO=$SECRETO" "SITIO_NEGOCIO=$NEGOCIO")
    certificar || exit "$RC"
    exit 0 ;;
  cancelar)
    ETAPA="cancelar"
    cargar_estado
    cerrar_fallida cancelado
    exit 0 ;;
  preparar)
    fase_preparar
    (( NO_DESPLEGO == 0 )) || exit 10
    exit 0 ;;
  desplegar)
    (umask 077 && mkdir -p "$DIR")
    cargar_estado
    fase_desplegar
    (( NO_DESPLEGO == 0 )) || exit 10
    exit 0 ;;
  reconstruir)
    fase_preparar
    (( NO_DESPLEGO == 0 )) || exit 10
    cargar_estado
    fase_desplegar
    exit 0 ;;
esac
