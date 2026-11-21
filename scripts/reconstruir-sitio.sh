#!/usr/bin/env bash
# reconstruir-sitio.sh — reconstruye, despliega y certifica el sitio público de UN tenant.
#
# Son los pasos 2 a 9 del job `reconstruir` de .github/workflows/reconstruir-sitio.yml, sin depender de GitHub:
# corre igual en el job de Actions y en un paso de Cloud Build (imagen scripts/constructor-sitio/Dockerfile).
# Contrato con las funciones: docs/produccion/reconstruccion-sitio.md.
#
# Uso: reconstruir-sitio.sh [reconstruir|certificar]      (por defecto: reconstruir)
#   reconstruir  toma el trabajo (en_curso; 409 = otro corredor, termina sin desplegar), genera, compila, prueba
#                dist-real (EXIGIR_DIST=1), prepara firebase.json, guarda la copia `previa`, despliega (revisando
#                también el registro), humo, certificación (un reintento a los 20 s solo con código 1), cierra
#                completada o fallida (con la etapa y las causas) y cierra pendientes cubiertos y rezagados.
#   certificar   solo certifica contra lo publicado: no toma trabajo, no compila, no despliega, no cierra nada.
#
# Entradas (variables de entorno; los valores nunca se imprimen: Cloud Build no enmascara, y el repositorio es
# público; las salidas de build, clon y despliegue pasan por un filtro que los oculta):
#   CLAVE (^[a-z0-9]{1,12}$) · TENANT · SITIO · URL_SITIO (https, sin ruta) · PROYECTO
#   SITIO_RECONSTRUCCION_SECRETO · SITIO_NEGOCIO (o SITIO_NEGOCIO_<CLAVE en mayúsculas>)
#   VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_API_KEY, VITE_RECAPTCHA_ENTERPRISE_SITE_KEY, VITE_FIREBASE_APP_ID,
#   MEDIOS_BASE_URL
#   SITIOS_PROHIBIDOS (o FIREBASE_SITE_PANEL): sitios que nunca se despliegan aquí (el panel); obligatoria.
#   TRABAJO (opcional): id del trabajo ya conocido (lo manda la plataforma); sin él se consulta el primero
#     `pendiente`, y entonces MODO_SONDEO (pendientes | todos) es obligatorio, como en el workflow.
#   APP_ENV (staging por defecto) · FIREBASE_TOOLS_VERSION · OMITIR_INSTALAR=1 (imagen con dependencias ya
#   instaladas) · VITE_APP_VERSION · COMMIT_SHA · SIMULAR=1 (valida y lista los pasos; no toca la red)
#   RAIZ_REPO (solo pruebas): raíz del repositorio; por defecto, la de este script.
# Autenticación: no la hace este script. Con credenciales por defecto de la aplicación (Cloud Build: la cuenta de
# servicio del paso) o con la que fija el job de GitHub (WIF), `firebase` y `contenido-sitio.mjs` las usan tal cual.
# Resúmenes: se escriben en GITHUB_STEP_SUMMARY solo si existe.
# Salida: 0 correcto (o sin trabajo/409), distinto de 0 fallo; el trabajo queda cerrado `fallida` con su etapa.
set -Eeuo pipefail

MODO="${1:-reconstruir}"
[[ "$MODO" == "reconstruir" || "$MODO" == "certificar" ]] || { echo "uso: reconstruir-sitio.sh [reconstruir|certificar]" >&2; exit 2; }

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
  [[ -n "${SITIOS_PROHIBIDOS//[[:space:],]/}" ]] || falla "falta SITIOS_PROHIBIDOS (al menos el sitio del panel)."
  [[ -z "$TRABAJO" || "$TRABAJO" =~ ^[A-Za-z0-9._-]{1,128}$ ]] || falla "TRABAJO no cumple el formato de un id."
  if [[ "$MODO" == "reconstruir" && -z "$TRABAJO" ]]; then
    [[ "$MODO_SONDEO" == "pendientes" || "$MODO_SONDEO" == "todos" ]] \
      || falla "sin TRABAJO hace falta MODO_SONDEO (pendientes o todos)."
  fi
  local host
  host="${URL_SITIO#https://}"; host="${host%/}"
  # Valores que el filtro oculta en las salidas de las herramientas (más largos primero).
  OCULTOS=("$URL_SITIO" "${URL_SITIO%/}" "$host" "$TENANT" "$SITIO")
  [[ -z "$PROYECTO" || ${#PROYECTO} -lt 4 ]] || OCULTOS+=("$PROYECTO")
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
  [[ -n "${SITIO_NEGOCIO:-}" ]] || FALTAN+=("SITIO_NEGOCIO_$(tr '[:lower:]' '[:upper:]' <<<"$CLAVE")")
}

validar_entradas

simular() {
  echo "SIMULAR=1: sin red; modo $MODO, sitio $CLAVE."
  local n=0 p
  local pasos=()
  if [[ "$MODO" == "certificar" ]]; then
    pasos=(
      "instalar dependencias (pnpm install --frozen-lockfile)"
      "comprobar secreto y variables"
      "certificar a pedido (sin --contenido; un reintento a los 20 s solo con código 1)"
    )
  else
    pasos=(
      "tomar el trabajo (en_curso; 409 = terminar sin desplegar)"
      "instalar dependencias (pnpm install --frozen-lockfile)"
      "generar el contenido publicado"
      "build del sitio (solo sitio)"
      "prueba dist-real con EXIGIR_DIST=1"
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
  fi
  for p in "${pasos[@]}"; do n=$((n + 1)); echo "SIMULAR paso $n: $p"; done
}

if [[ "${SIMULAR:-}" == "1" ]]; then
  simular
  exit 0
fi

# --- Estado de la ejecución ---
DIR="${RUNNER_TEMP:-$(mktemp -d)}"
mkdir -p "$DIR/sitio"
ETAPA="inicio"        # etapa en curso; define la `etapa` del cierre fallida
CERRADO=""            # 1 cuando ya no corresponde cerrar el trabajo como fallida
CONTINUAR="false"
TRABAJO_ID=""
GENERAR_INICIO_MS=""
SITIO_CONTENIDO=""
ID_EJECUCION="${GITHUB_RUN_ID:-${BUILD_ID:-local}}"
SHA="${GITHUB_SHA:-${COMMIT_SHA:-sin-sha}}"
export VITE_APP_VERSION="${VITE_APP_VERSION:-${GITHUB_REF_NAME:-local}-$SHA}"

contenido() { node scripts/contenido-sitio.mjs "$@" --tenant "$TENANT" --url "$URL_SITIO"; }

cerrar_fallida() { # etapa
  [[ "$MODO" == "reconstruir" && -n "$TRABAJO_ID" && -z "$CERRADO" ]] || return 0
  CERRADO=1
  local args=(estado "$TRABAJO_ID" fallida --etapa "$1")
  [[ -f "$DIR/sitio/causas.json" ]] && args+=(--causas "$DIR/sitio/causas.json")
  contenido "${args[@]}" || advertencia "$CLAVE: no se pudo cerrar el trabajo como fallida."
  aviso "$CLAVE: etapa fallida: $1."
  falla_msg "$CLAVE: reconstrucción fallida; trabajo cerrado como fallida. Rollback: clonar previa → live del sitio."
}

al_fallar() { # código
  local rc="$1"
  trap - ERR
  set +e
  case "$ETAPA" in
    inicio | tomar | cierre | posterior) ;;
    instalar) cerrar_fallida generar ;;
    certificar_a_pedido) ;;
    *) cerrar_fallida "$ETAPA" ;;
  esac
  exit "$rc"
}
# shellcheck disable=SC2329  # se invoca por trap
al_cancelar() {
  trap - ERR TERM INT HUP
  set +e
  [[ "$ETAPA" == "cierre" || "$ETAPA" == "posterior" ]] || cerrar_fallida cancelado
  exit 143
}
trap 'al_fallar $?' ERR
trap al_cancelar TERM INT HUP

certificar() { # args extra del script; deja RC e INTENTO. Una sola repetición, a los 20 s, solo con código 1.
  local resumen_ruta="$DIR/certificacion.md"
  RC=3
  for INTENTO in 1 2; do
    rm -f "$resumen_ruta"
    RC=0
    node scripts/certificar-sitio.mjs --tenant "$TENANT" --url "$URL_SITIO" --resumen "$resumen_ruta" "$@" || RC=$?
    (( RC == 1 && INTENTO == 1 )) || break
    aviso "$CLAVE: la certificación encontró diferencias (intento 1/2); se repite en 20 s por si el CDN de Hosting aún servía la versión anterior."
    sleep 20
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

instalar_dependencias() {
  if [[ "${OMITIR_INSTALAR:-}" == "1" ]]; then
    echo "Dependencias ya instaladas en la imagen (OMITIR_INSTALAR=1)."
  else
    pnpm install --frozen-lockfile
  fi
}

# --- Certificación a pedido ---
if [[ "$MODO" == "certificar" ]]; then
  ETAPA="certificar_a_pedido"
  [[ -n "${SITIO_RECONSTRUCCION_SECRETO:-}" ]] \
    || { falla_msg "$CLAVE: no se pudo certificar (error de operación): falta SITIO_RECONSTRUCCION_SECRETO."; exit 3; }
  [[ -z "$EN_GITHUB" ]] || echo "::add-mask::$SITIO_RECONSTRUCCION_SECRETO"
  SITIO_NEGOCIO="${SITIO_NEGOCIO:-}"
  if [[ -z "$SITIO_NEGOCIO" ]]; then
    var_negocio="SITIO_NEGOCIO_$(tr '[:lower:]' '[:upper:]' <<<"$CLAVE")"
    SITIO_NEGOCIO="${!var_negocio:-}"
  fi
  export SITIO_NEGOCIO
  instalar_dependencias
  faltantes_publicacion
  if (( ${#FALTAN[@]} > 0 )); then
    falla_msg "$CLAVE: no se pudo certificar (error de operación): faltan ${FALTAN[*]}. Ver docs/produccion/reconstruccion-sitio.md."
    exit 3
  fi
  certificar || exit "$RC"
  exit 0
fi

# --- Paso 2: tomar el trabajo (en_curso) ---
ETAPA="tomar"
[[ -n "${SITIO_RECONSTRUCCION_SECRETO:-}" ]] || falla "falta SITIO_RECONSTRUCCION_SECRETO."
[[ -z "$EN_GITHUB" ]] || echo "::add-mask::$SITIO_RECONSTRUCCION_SECRETO"
SITIO_NEGOCIO="${SITIO_NEGOCIO:-}"
if [[ -z "$SITIO_NEGOCIO" ]]; then
  var_negocio="SITIO_NEGOCIO_$(tr '[:lower:]' '[:upper:]' <<<"$CLAVE")"
  SITIO_NEGOCIO="${!var_negocio:-}"
fi
export SITIO_NEGOCIO

id="$TRABAJO"
if [[ -z "$id" ]]; then
  id="$(contenido pendiente)"
  if [[ -z "$id" ]]; then
    if [[ "$MODO_SONDEO" == "pendientes" ]]; then
      aviso "$CLAVE: ya no hay trabajo pendiente; nada que hacer."
      exit 0
    fi
    echo "$CLAVE: sin trabajo en la cola; reconstrucción pedida."
    CONTINUAR="true"
  fi
fi
if [[ -n "$id" ]]; then
  rc=0
  contenido estado "$id" en_curso || rc=$?
  case "$rc" in
    0) TRABAJO_ID="$id"; CONTINUAR="true"; echo "$CLAVE: trabajo tomado (en_curso)." ;;
    3) aviso "$CLAVE: el trabajo lo tomó otro corredor (409); este termina sin desplegar."; exit 0 ;;
    *) falla_msg "$CLAVE: no se pudo marcar el trabajo en_curso (código $rc)."; exit 1 ;;
  esac
fi
[[ "$CONTINUAR" == "true" ]] || exit 0

# --- Paso 3: dependencias y contenido publicado ---
ETAPA="instalar"
instalar_dependencias

ETAPA="generar"
faltantes_publicacion
if (( ${#FALTAN[@]} > 0 )); then
  falla_msg "Faltan variables o secretos para reconstruir $CLAVE: ${FALTAN[*]}. Ver docs/produccion/reconstruccion-sitio.md."
  false
fi
SITIO_CONTENIDO="$DIR/sitio/contenido.json"
# Hora de inicio (ms) ANTES de leer lo publicado: tope de «cubiertos».
GENERAR_INICIO_MS="$(date +%s%3N)"
contenido generar --salida "$SITIO_CONTENIDO" --causas "$DIR/sitio/causas.json"

# --- Build ---
ETAPA="build"
export VITE_FIREBASE_AUTH_DOMAIN="${VITE_FIREBASE_PROJECT_ID}.firebaseapp.com"
node scripts/build.mjs --mode "$APP_ENV" --solo sitio --sitio "$SITIO" 2>&1 | ocultar

# --- Prueba del sitio compilado con contenido real ---
ETAPA="pruebas"
EXIGIR_DIST=1 pnpm vitest run pruebas/website/dist-real.test.ts

# --- Despliegue: firebase.json solo de este sitio, previa, deploy ---
ETAPA="despliegue"
bash .github/scripts/preparar-sitio-tenant.sh "$SITIO" 2>&1 | ocultar
actual="$(firebase --version 2>/dev/null || true)"
if [[ "$actual" != "$FIREBASE_TOOLS_VERSION" ]]; then
  npm i -g "firebase-tools@${FIREBASE_TOOLS_VERSION}"
fi
# D7: el rollback es clonar previa → live. Sin copia (primer despliegue) se avisa y se continúa.
firebase hosting:channel:create previa --site "$SITIO" --project "$PROYECTO" --expires 30d \
  --non-interactive >/dev/null 2>&1 || true
{ firebase hosting:clone "$SITIO:live" "$SITIO:previa" --project "$PROYECTO" 2>&1 | ocultar; } \
  || advertencia "$CLAVE: no se pudo guardar la copia para rollback (live → previa). ¿Primer despliegue o sitio sin crear?"

# `firebase deploy` PUEDE SALIR CON CÓDIGO 0 HABIENDO FALLADO: se revisa también el registro.
log="$DIR/despliegue.log"
rc=0
firebase deploy --only hosting --project "$PROYECTO" --non-interactive \
  --message "sitio $CLAVE ${SHA:0:7} (ejecucion ${ID_EJECUCION})" 2>&1 \
  | tee "$log" | ocultar || rc=$?
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
    codigo="$(curl -sS --max-time 15 -D "$cabeceras" -o /dev/null -w '%{http_code}' "${URL_SITIO%/}$ruta" 2>/dev/null || echo 000)"
    if [[ "$codigo" == "200" ]] && { [[ "$csp" == "no" ]] || grep -qi '^content-security-policy:' "$cabeceras"; }; then
      echo "OK  $ruta (intento $i)"; rm -f "$cabeceras"; return 0
    fi
    echo "…   $ruta: HTTP $codigo (intento $i/10)"
    sleep 15
  done
  rm -f "$cabeceras"
  falla_msg "$CLAVE: humo fallido en $ruta"
  return 1
}
fallos=0
comprobar / si || fallos=$((fallos + 1))
# Una página interna sin .html: comprueba las URLs limpias de Hosting.
comprobar /productos si || fallos=$((fallos + 1))
comprobar '/api/cotizacion?mercado=BO' no || fallos=$((fallos + 1))
(( fallos == 0 )) || false

# --- Certificación contra el MISMO contenido con el que se compiló ---
ETAPA="certificacion"
[[ -f "$SITIO_CONTENIDO" ]] || { falla_msg "$CLAVE: no se pudo certificar (error de operación): falta el contenido generado por el build."; false; }
certificar --contenido "$SITIO_CONTENIDO" || al_fallar "$RC"

# --- Cierre: completada. Si lo que falla es este cierre, el sitio ya está desplegado y probado: no se marca fallida. ---
ETAPA="cierre"
if [[ -n "$TRABAJO_ID" ]]; then
  contenido estado "$TRABAJO_ID" completada
fi
CERRADO=1

# --- Pendientes cubiertos y rezagados (un fallo pone la ejecución en rojo, no reabre el trabajo) ---
ETAPA="posterior"
[[ "$GENERAR_INICIO_MS" =~ ^[0-9]{13}$ ]] || { falla_msg "$CLAVE: falta la hora de inicio del build; no se cierran pendientes."; false; }
rc_cubiertos=0
contenido cubiertos --contenido "$SITIO_CONTENIDO" --hasta-ms "$GENERAR_INICIO_MS" || rc_cubiertos=$?
rc_rezagados=0
contenido rezagados || rc_rezagados=$?
(( rc_cubiertos == 0 )) || exit "$rc_cubiertos"
(( rc_rezagados == 0 )) || exit "$rc_rezagados"
exit 0
