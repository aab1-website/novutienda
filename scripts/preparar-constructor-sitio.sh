#!/usr/bin/env bash
# preparar-constructor-sitio.sh — deja listo, en UN proyecto, lo que necesita el constructor del sitio en
# Cloud Build (plan: «Publicar el sitio con Cloud Build», operación P5, pasos O1 a O6).
#
# Uso: preparar-constructor-sitio.sh <proyecto> [--aplicar] [--claves a1,b2] [--neutralizar-cuenta-por-defecto]
#   Sin --aplicar es una SIMULACIÓN: imprime lo que haría y no llama a la nube (ni siquiera a gcloud).
#   Con --aplicar ejecuta con gcloud (credenciales de quien lo corra). Idempotente: cada paso comprueba si ya existe.
#   Nunca despliega el sitio, no activa el modo `google` ni crea la alerta (pasos 6 y 7 del plan, aparte).
#
# Entorno:
#   CUENTA_FUNCIONES  correo de la cuenta de servicio con la que corren las Functions (obligatorio con --aplicar).
#   CUENTA_DESPLIEGUE correo de la cuenta de despliegue de staging (la del CI); recibe artifactregistry.writer sobre
#                     el repositorio para publicar la imagen (obligatorio con --aplicar).
#   COLA_TAREAS       nombre de la cola de Cloud Tasks (obligatorio con --aplicar; debe existir: la crea el despliegue de
#                     las Functions). cloudtasks.enqueuer se da SOLO sobre esa cola, no sobre el proyecto.
#   CLAVES_SITIO      claves de sitio separadas por comas (o --claves); define los secretos SITIO_NEGOCIO_<CLAVE>.
#   REGION            us-east1 (por defecto; los recursos de nube van siempre allí).
#   REPO_IMAGENES     repositorio de Artifact Registry (sitio-constructor por defecto).
#   Valores de secretos: si la variable SITIO_RECONSTRUCCION_SECRETO o SITIO_NEGOCIO_<CLAVE> está definida, su valor
#   pasa por stdin a Secret Manager (nunca por argumentos ni al log) y solo si el secreto aún no tiene versión
#   (Secret Manager da 6 versiones gratis al mes). Sin la variable solo se crea el secreto y su permiso.
#
# Pasos:
#   O1  Activar las API cloudbuild, artifactregistry y cloudtasks.
#   O2  Repositorio de imágenes en Artifact Registry (formato docker) con limpieza: conserva las 10 versiones más recientes.
#   O3  Cuenta de servicio `sitio-constructor` (la que ejecuta la construcción).
#   O4  Roles de `sitio-constructor`: firebasehosting.admin (no se puede limitar por sitio: lo cubre la guardia de
#       preparar-sitio-tenant.sh), logging.logWriter, serviceusage.serviceUsageConsumer y artifactregistry.reader
#       sobre el repositorio.
#   O5  Permisos de la cuenta de las Functions: rol personalizado con SOLO cloudbuild.builds.create y
#       cloudbuild.builds.get; iam.serviceAccountUser únicamente sobre `sitio-constructor`; cloudtasks.enqueuer
#       sobre la cola COLA_TAREAS.
#   O5bis  Cuenta de servicio POR DEFECTO de Cloud Build. Siempre consulta (sin cambiar nada) cuál es y con qué cuenta
#       construyen las Functions de 2.ª generación. SOLO con la opción explícita --neutralizar-cuenta-por-defecto
#       crea `build-sin-permisos` (sin roles) y la fija como cuenta por defecto. Riesgo: el despliegue de Functions 2.ª gen
#       también construye con Cloud Build; en P5 se usa solo tras verificar lo consultado o tras fijar
#       `--build-service-account` para las Functions. Comando por verificar en staging (`gcloud builds
#       set-default-service-account`). Los builds del constructor siempre indican `sitio-constructor`.
#   O6  Secretos en Secret Manager (SITIO_RECONSTRUCCION_SECRETO y SITIO_NEGOCIO_<CLAVE>) con acceso solo para
#       `sitio-constructor`.
#   (O2 incluye además roles/artifactregistry.writer sobre el repositorio para CUENTA_DESPLIEGUE.)
# Los roles de O4 y los permisos de Hosting están por verificar en staging (el plan los marca sin verificar).
# La salida muestra <proyecto> en vez del id real.
set -Eeuo pipefail

uso() { echo "uso: preparar-constructor-sitio.sh <proyecto> [--aplicar] [--claves a1,b2] [--neutralizar-cuenta-por-defecto]" >&2; exit 2; }

PROYECTO=""
APLICAR=0
NEUTRALIZAR=0
CLAVES="${CLAVES_SITIO:-}"
while (( $# > 0 )); do
  case "$1" in
    --aplicar) APLICAR=1 ;;
    --neutralizar-cuenta-por-defecto) NEUTRALIZAR=1 ;;
    --claves) shift; [[ $# -gt 0 && "$1" != --* ]] || uso; CLAVES="$1" ;;
    -*) uso ;;
    *) [[ -z "$PROYECTO" ]] || uso; PROYECTO="$1" ;;
  esac
  shift
done
[[ "$PROYECTO" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || { echo "falta el proyecto o su formato es inválido" >&2; exit 2; }

REGION="${REGION:-us-east1}"
REPO="${REPO_IMAGENES:-sitio-constructor}"
CUENTA="sitio-constructor"
ROL_LANZADOR="lanzadorConstructorSitio"
CUENTA_EMAIL="${CUENTA}@${PROYECTO}.iam.gserviceaccount.com"
[[ "$REPO" =~ ^[a-z][a-z0-9-]{0,62}$ ]] || { echo "REPO_IMAGENES inválido" >&2; exit 2; }
[[ "$REGION" == "us-east1" ]] || { echo "los recursos van en us-east1" >&2; exit 2; }

FUNCIONES="${CUENTA_FUNCIONES:-}"
if [[ -z "$FUNCIONES" ]]; then
  (( APLICAR == 0 )) || { echo "con --aplicar hace falta CUENTA_FUNCIONES (correo de la cuenta de las Functions)" >&2; exit 2; }
  FUNCIONES="<cuenta-de-las-functions>"
elif ! [[ "$FUNCIONES" =~ ^[a-z0-9._-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$ ]]; then
  echo "CUENTA_FUNCIONES no es un correo de cuenta de servicio" >&2; exit 2
fi

DESPLIEGUE="${CUENTA_DESPLIEGUE:-}"
if [[ -z "$DESPLIEGUE" ]]; then
  (( APLICAR == 0 )) || { echo "con --aplicar hace falta CUENTA_DESPLIEGUE (correo de la cuenta de despliegue de staging)" >&2; exit 2; }
  DESPLIEGUE="<cuenta-de-despliegue>"
elif ! [[ "$DESPLIEGUE" =~ ^[a-z0-9._-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$ ]]; then
  echo "CUENTA_DESPLIEGUE no es un correo de cuenta de servicio" >&2; exit 2
fi

COLA="${COLA_TAREAS:-}"
if [[ -z "$COLA" ]]; then
  (( APLICAR == 0 )) || { echo "con --aplicar hace falta COLA_TAREAS (nombre de la cola de Cloud Tasks)" >&2; exit 2; }
  COLA="<cola>"
elif ! [[ "$COLA" =~ ^[A-Za-z0-9_-]{1,100}$ ]]; then
  echo "COLA_TAREAS inválida" >&2; exit 2
fi

SECRETOS=(SITIO_RECONSTRUCCION_SECRETO)
if [[ -n "$CLAVES" ]]; then
  IFS=',' read -r -a lista <<<"$CLAVES"
  for c in "${lista[@]}"; do
    [[ "$c" =~ ^[a-z0-9]{1,12}$ ]] || { echo "una clave no cumple ^[a-z0-9]{1,12}\$" >&2; exit 2; }
    SECRETOS+=("SITIO_NEGOCIO_$(tr '[:lower:]' '[:upper:]' <<<"$c")")
  done
fi

# Muestra un comando sin el id real del proyecto ni el correo real de la cuenta de las Functions.
mostrar() { # prefijo, comando...
  local pre="$1" t
  shift
  t="$*"
  t="${t//"$PROYECTO"/<proyecto>}"
  if [[ "$FUNCIONES" != "<cuenta-de-las-functions>" ]]; then t="${t//"$FUNCIONES"/<cuenta-de-las-functions>}"; fi
  if [[ "$DESPLIEGUE" != "<cuenta-de-despliegue>" ]]; then t="${t//"$DESPLIEGUE"/<cuenta-de-despliegue>}"; fi
  echo "  $pre $t"
}
# Reemplaza el id del proyecto y los correos de las cuentas en lo que imprime gcloud (stdin → stdout).
quitar_ids() {
  local l
  while IFS= read -r l || [[ -n "$l" ]]; do
    l="${l//"$PROYECTO"/<proyecto>}"
    if [[ "$FUNCIONES" != "<cuenta-de-las-functions>" ]]; then l="${l//"$FUNCIONES"/<cuenta-de-las-functions>}"; fi
    if [[ "$DESPLIEGUE" != "<cuenta-de-despliegue>" ]]; then l="${l//"$DESPLIEGUE"/<cuenta-de-despliegue>}"; fi
    printf '%s\n' "$l"
  done
}
# Ejecuta (con --aplicar) o solo muestra (simulación). La salida real de gcloud no imprime el id del proyecto.
ejecutar() {
  if (( APLICAR == 1 )); then mostrar "+" "$@"; "$@" 2>&1 | quitar_ids; else mostrar "[simulación]" "$@"; fi
}
existe() { # comando de lectura; en simulación se asume que NO existe para mostrar el paso completo
  (( APLICAR == 1 )) || return 1
  "$@" >/dev/null 2>&1
}
paso() { echo; echo "$1"; }

echo "Constructor del sitio — proyecto <proyecto>, región $REGION, modo $( ((APLICAR == 1)) && echo APLICAR || echo SIMULACIÓN )"

paso "O1. API (cloudbuild, artifactregistry, cloudtasks)"
ejecutar gcloud services enable cloudbuild.googleapis.com artifactregistry.googleapis.com cloudtasks.googleapis.com \
  --project="$PROYECTO"

paso "O2. Repositorio de imágenes ($REPO) con limpieza a las 10 versiones más recientes"
if existe gcloud artifacts repositories describe "$REPO" --location="$REGION" --project="$PROYECTO"; then
  echo "  ya existe"
else
  ejecutar gcloud artifacts repositories create "$REPO" --repository-format=docker --location="$REGION" \
    --description="Imagen del constructor del sitio" --project="$PROYECTO"
fi
politica="$(mktemp)"
trap 'rm -f "$politica"' EXIT
cat >"$politica" <<'JSON'
[
  {"name": "conservar-10", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 10}},
  {"name": "borrar-el-resto", "action": {"type": "Delete"}, "condition": {"tagState": "any"}}
]
JSON
ejecutar gcloud artifacts repositories set-cleanup-policies "$REPO" --location="$REGION" --project="$PROYECTO" \
  --policy="$politica" --no-dry-run
# La cuenta de despliegue del CI publica la imagen por digest.
ejecutar gcloud artifacts repositories add-iam-policy-binding "$REPO" --location="$REGION" --project="$PROYECTO" \
  --member="serviceAccount:$DESPLIEGUE" --role=roles/artifactregistry.writer --quiet --format=none

paso "O3. Cuenta de servicio $CUENTA"
if existe gcloud iam service-accounts describe "$CUENTA_EMAIL" --project="$PROYECTO"; then
  echo "  ya existe"
else
  ejecutar gcloud iam service-accounts create "$CUENTA" --display-name="Constructor del sitio" --project="$PROYECTO"
fi

paso "O4. Roles de $CUENTA"
for rol in roles/firebasehosting.admin roles/logging.logWriter roles/serviceusage.serviceUsageConsumer; do
  ejecutar gcloud projects add-iam-policy-binding "$PROYECTO" --member="serviceAccount:$CUENTA_EMAIL" \
    --role="$rol" --condition=None --quiet --format=none
done
ejecutar gcloud artifacts repositories add-iam-policy-binding "$REPO" --location="$REGION" --project="$PROYECTO" \
  --member="serviceAccount:$CUENTA_EMAIL" --role=roles/artifactregistry.reader --quiet --format=none

paso "O5. Permisos de la cuenta de las Functions (rol mínimo, uso solo de $CUENTA, cola de tareas)"
if existe gcloud iam roles describe "$ROL_LANZADOR" --project="$PROYECTO"; then
  ejecutar gcloud iam roles update "$ROL_LANZADOR" --project="$PROYECTO" \
    --permissions=cloudbuild.builds.create,cloudbuild.builds.get --quiet --format=none
else
  ejecutar gcloud iam roles create "$ROL_LANZADOR" --project="$PROYECTO" --title="Lanzador del constructor del sitio" \
    --permissions=cloudbuild.builds.create,cloudbuild.builds.get --stage=GA --quiet --format=none
fi
ejecutar gcloud projects add-iam-policy-binding "$PROYECTO" --member="serviceAccount:$FUNCIONES" \
  --role="projects/$PROYECTO/roles/$ROL_LANZADOR" --condition=None --quiet --format=none
ejecutar gcloud iam service-accounts add-iam-policy-binding "$CUENTA_EMAIL" --project="$PROYECTO" \
  --member="serviceAccount:$FUNCIONES" --role=roles/iam.serviceAccountUser --quiet --format=none
if existe gcloud tasks queues describe "$COLA" --location="$REGION" --project="$PROYECTO" || (( APLICAR == 0 )); then
  ejecutar gcloud tasks queues add-iam-policy-binding "$COLA" --location="$REGION" --project="$PROYECTO" \
    --member="serviceAccount:$FUNCIONES" --role=roles/cloudtasks.enqueuer --quiet --format=none
else
  echo "  la cola de tareas indicada no existe aún (la crea el despliegue de las Functions): despliegue y repita este paso" >&2
  exit 1
fi

paso "O5bis. Cuenta por defecto de Cloud Build (consulta; cambio solo con --neutralizar-cuenta-por-defecto)"
# Solo lectura: qué cuenta usa hoy Cloud Build por defecto y con qué cuenta construyen las Functions de 2.ª generación.
ejecutar gcloud builds get-default-service-account --project="$PROYECTO"
ejecutar gcloud functions list --v2 --project="$PROYECTO" --format="value(buildConfig.serviceAccount)"
if (( NEUTRALIZAR == 1 )); then
  CUENTA_BUILD="build-sin-permisos"
  CUENTA_BUILD_EMAIL="${CUENTA_BUILD}@${PROYECTO}.iam.gserviceaccount.com"
  if existe gcloud iam service-accounts describe "$CUENTA_BUILD_EMAIL" --project="$PROYECTO"; then
    echo "  $CUENTA_BUILD: ya existe"
  else
    ejecutar gcloud iam service-accounts create "$CUENTA_BUILD" --display-name="Cuenta por defecto de Cloud Build (sin permisos)" \
      --project="$PROYECTO"
  fi
  ejecutar gcloud builds set-default-service-account --service-account="projects/$PROYECTO/serviceAccounts/$CUENTA_BUILD_EMAIL" \
    --project="$PROYECTO"
else
  echo "  (no se cambia la cuenta por defecto: use --neutralizar-cuenta-por-defecto en P5, tras verificar lo de arriba)"
fi

paso "O6. Secretos (los valores pasan por stdin; nunca se imprimen)"
for s in "${SECRETOS[@]}"; do
  if existe gcloud secrets describe "$s" --project="$PROYECTO"; then
    echo "  $s: ya existe"
  else
    ejecutar gcloud secrets create "$s" --replication-policy=user-managed --locations="$REGION" --project="$PROYECTO"
  fi
  valor="${!s:-}"
  if [[ -n "$valor" ]]; then
    if (( APLICAR == 1 )); then
      if [[ -n "$(gcloud secrets versions list "$s" --project="$PROYECTO" --limit=1 --format='value(name)' 2>/dev/null)" ]]; then
        echo "  $s: ya tiene versión; no se agrega otra (usar la rotación del plan)"
      else
        printf '%s' "$valor" | gcloud secrets versions add "$s" --project="$PROYECTO" --data-file=- --format=none 2>&1 | quitar_ids
        echo "  $s: versión agregada (valor no mostrado)"
      fi
    else
      echo "  [simulación] gcloud secrets versions add $s --data-file=-  (valor por stdin, no mostrado)"
    fi
  else
    echo "  $s: sin valor en el entorno; solo el contenedor y el permiso"
  fi
  ejecutar gcloud secrets add-iam-policy-binding "$s" --project="$PROYECTO" \
    --member="serviceAccount:$CUENTA_EMAIL" --role=roles/secretmanager.secretAccessor --quiet --format=none
done
unset valor

echo
if (( APLICAR == 1 )); then echo "Listo."; else echo "Simulación terminada: no se cambió nada. Use --aplicar para ejecutar."; fi
