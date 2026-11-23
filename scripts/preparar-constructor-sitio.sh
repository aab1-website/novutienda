#!/usr/bin/env bash
# preparar-constructor-sitio.sh — deja listo, en UN proyecto, lo que necesita el constructor del sitio en
# Cloud Build (plan: «Publicar el sitio con Cloud Build», operación P5, pasos O1 a O6).
#
# Uso: preparar-constructor-sitio.sh <proyecto> [--aplicar] [--claves a1,b2] [--neutralizar-cuenta-por-defecto] [--ampliar-despliegue] [--actas-propio]
#   Sin --aplicar es una SIMULACIÓN: imprime lo que haría y no llama a la nube (ni siquiera a gcloud).
#   Con --aplicar ejecuta con gcloud (credenciales de quien lo corra). Idempotente: cada paso comprueba si ya existe.
#   Nunca despliega el sitio, no activa el modo `google` ni crea la alerta (pasos 6 y 7 del plan, aparte).
#
# Entorno:
#   CUENTA_FUNCIONES  correo de la cuenta de servicio con la que corren las Functions (obligatorio con --aplicar).
#   CUENTA_DESPLIEGUE correo de la cuenta de despliegue de staging (la del CI); recibe artifactregistry.writer sobre
#                     el repositorio para publicar la imagen (obligatorio con --aplicar).
#                     (El permiso de encolar NO se da aquí: lo fija el código con `invoker` en cada despliegue, D-P5-2 = A.)
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
#   O3  Cuentas de servicio `sitio-constructor` (la que ejecuta la construcción) y `fn-constructor-sitio` (la propia de las
#       funciones del constructor; su correo es el valor de CUENTA_FN_CONSTRUCTOR_SITIO).
#   O4  Roles de `sitio-constructor`: firebasehosting.admin (no se puede limitar por sitio: lo cubre la guardia
#       SITIOS_PROHIBIDOS de reconstruir-sitio.sh), logging.logWriter, serviceusage.serviceUsageConsumer y artifactregistry.reader
#       sobre el repositorio.
#   O5  Permisos de `fn-constructor-sitio` (no de la cuenta general de las Functions): rol personalizado con SOLO
#       cloudbuild.builds.create y cloudbuild.builds.get; iam.serviceAccountUser únicamente sobre `sitio-constructor`;
#       roles/datastore.user y roles/logging.logWriter; secretAccessor de SITIOS_TENANT (en O6).
#   O5b (solo con --actas-propio) iam.serviceAccountUser de `fn-constructor-sitio` y de la cuenta de las Functions SOBRE SÍ
#       MISMAS, para encolar con token OIDC. No corre por defecto: se usa solo si encolar falla sin él en P6 (no verificado).
#   O5bis  Cuenta de servicio POR DEFECTO de Cloud Build. Cloud Build no permite fijar una propia (no existe
#       `set-default-service-account`): se REDUCE la que ya es. Siempre consulta cuál es y con qué cuenta construyen las
#       Functions de 2.ª generación. SOLO con --neutralizar-cuenta-por-defecto, si es la de Compute o la heredada
#       (@cloudbuild.gserviceaccount.com), le agrega roles/cloudbuild.builds.builder y le quita roles/editor a nivel de
#       proyecto, conservando sus demás roles. ACTO SEGUIDO hay que volver a desplegar las Functions (re-ejecutar
#       `desplegar-staging`) y comprobar que las 12 construyen. Reversión: volver a agregarle roles/editor.
#       La guardia de O5 exige que la cuenta por defecto NO tenga roles/editor ni roles/owner; si los tiene, sale con 3
#       y no otorga el rol lanzador. Los builds del constructor siempre indican `sitio-constructor`.
#       LÍMITES: la guardia solo ve los roles dados en el PROYECTO; no ve los heredados de carpeta u organización ni los
#       dados por grupos (en staging no hay organización; en producción hay que revisarlo a mano). Si CUENTA_FUNCIONES es
#       la misma cuenta por defecto, --neutralizar se niega (salida 3): quitarle Editor rompería las Functions en ejecución.
#   O6  Secretos en Secret Manager: SITIO_RECONSTRUCCION_SECRETO y SITIO_NEGOCIO_<CLAVE> con acceso solo para
#       `sitio-constructor`; SITIOS_TENANT con acceso solo para `fn-constructor-sitio`.
#   N9  (solo con --ampliar-despliegue; no corre por defecto) amplía el rol `despliegueFuncionesIam` de la cuenta de
#       despliegue con lo que firebase-tools usa al exportar construirSitio y avisoConstruccionSitio: crear/leer/actualizar
#       la cola (cloudtasks.queues.create/get/update/getIamPolicy/setIamPolicy: el `invoker` reescribe su política) y crear/
#       leer el tema (pubsub.topics.create/get). La suscripción y el disparador los crea el servicio de Cloud Functions,
#       no firebase-tools. AMPLÍA PERMISOS: revisión de `seguridad` y justificación en el PR antes de aplicarlo.
#   (O2 incluye además roles/artifactregistry.writer sobre el repositorio para CUENTA_DESPLIEGUE.)
# Los roles de O4 y los permisos de Hosting están por verificar en staging (el plan los marca sin verificar).
# La salida muestra <proyecto> en vez del id real.
set -Eeuo pipefail

uso() { echo "uso: preparar-constructor-sitio.sh <proyecto> [--aplicar] [--claves a1,b2] [--neutralizar-cuenta-por-defecto] [--ampliar-despliegue] [--actas-propio]" >&2; exit 2; }

PROYECTO=""
APLICAR=0
NEUTRALIZAR=0
AMPLIAR=0
ACTAS_PROPIO=0
CLAVES="${CLAVES_SITIO:-}"
while (( $# > 0 )); do
  case "$1" in
    --aplicar) APLICAR=1 ;;
    --neutralizar-cuenta-por-defecto) NEUTRALIZAR=1 ;;
    --ampliar-despliegue) AMPLIAR=1 ;;
    --actas-propio) ACTAS_PROPIO=1 ;;
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
CUENTA_FN="fn-constructor-sitio"
FN_EMAIL="${CUENTA_FN}@${PROYECTO}.iam.gserviceaccount.com"
ROL_DESPLIEGUE="despliegueFuncionesIam"
# Permisos que firebase-tools usa al exportar construirSitio (cola) y avisoConstruccionSitio (tema).
PERMISOS_N9="cloudtasks.queues.create,cloudtasks.queues.get,cloudtasks.queues.update,cloudtasks.queues.getIamPolicy,cloudtasks.queues.setIamPolicy,pubsub.topics.create,pubsub.topics.get"
NUMERO="<numero>" # número del proyecto: se calcula con --aplicar, nunca se escribe en el repositorio
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

SECRETOS=(SITIO_RECONSTRUCCION_SECRETO SITIOS_TENANT)
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
  if [[ "$NUMERO" != "<numero>" ]]; then t="${t//"$NUMERO"/<numero>}"; fi
  if [[ "$FUNCIONES" != "<cuenta-de-las-functions>" ]]; then t="${t//"$FUNCIONES"/<cuenta-de-las-functions>}"; fi
  if [[ "$DESPLIEGUE" != "<cuenta-de-despliegue>" ]]; then t="${t//"$DESPLIEGUE"/<cuenta-de-despliegue>}"; fi
  if [[ "${DEFECTO:-<cuenta-por-defecto>}" != "<cuenta-por-defecto>" ]]; then t="${t//"$DEFECTO"/<cuenta-por-defecto>}"; fi
  echo "  $pre $t"
}
# Reemplaza el id del proyecto y los correos de las cuentas en lo que imprime gcloud (stdin → stdout).
quitar_ids() {
  local l
  while IFS= read -r l || [[ -n "$l" ]]; do
    l="${l//"$PROYECTO"/<proyecto>}"
    if [[ "$NUMERO" != "<numero>" ]]; then l="${l//"$NUMERO"/<numero>}"; fi
    if [[ "$FUNCIONES" != "<cuenta-de-las-functions>" ]]; then l="${l//"$FUNCIONES"/<cuenta-de-las-functions>}"; fi
    if [[ "$DESPLIEGUE" != "<cuenta-de-despliegue>" ]]; then l="${l//"$DESPLIEGUE"/<cuenta-de-despliegue>}"; fi
    if [[ "${DEFECTO:-<cuenta-por-defecto>}" != "<cuenta-por-defecto>" ]]; then l="${l//"$DEFECTO"/<cuenta-por-defecto>}"; fi
    printf '%s\n' "$l"
  done
}
# Ejecuta (con --aplicar) o solo muestra (simulación). La salida real de gcloud no imprime el id del proyecto.
# Los enlaces de IAM (idempotentes) se reintentan unos segundos: una cuenta recién creada tarda en propagarse.
ejecutar() {
  if (( APLICAR == 1 )); then
    mostrar "+" "$@"
    local intento=1 maximo=1
    [[ " $* " == *" add-iam-policy-binding "* ]] && maximo=6
    until "$@" 2>&1 | quitar_ids; do
      (( intento < maximo )) || return 1
      intento=$((intento + 1))
      echo "  (la cuenta aún no se propaga; reintento $intento de $maximo)" >&2
      sleep "${ESPERA_PROPAGACION:-5}"
    done
  else mostrar "[simulación]" "$@"; fi
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

paso "O3. Cuentas de servicio $CUENTA y $CUENTA_FN"
if existe gcloud iam service-accounts describe "$CUENTA_EMAIL" --project="$PROYECTO"; then
  echo "  $CUENTA: ya existe"
else
  ejecutar gcloud iam service-accounts create "$CUENTA" --display-name="Constructor del sitio" --project="$PROYECTO"
fi
if existe gcloud iam service-accounts describe "$FN_EMAIL" --project="$PROYECTO"; then
  echo "  $CUENTA_FN: ya existe"
else
  ejecutar gcloud iam service-accounts create "$CUENTA_FN" --display-name="Funciones del constructor del sitio" \
    --project="$PROYECTO"
fi

paso "O4. Roles de $CUENTA"
for rol in roles/firebasehosting.admin roles/logging.logWriter roles/serviceusage.serviceUsageConsumer; do
  ejecutar gcloud projects add-iam-policy-binding "$PROYECTO" --member="serviceAccount:$CUENTA_EMAIL" \
    --role="$rol" --condition=None --quiet --format=none
done
ejecutar gcloud artifacts repositories add-iam-policy-binding "$REPO" --location="$REGION" --project="$PROYECTO" \
  --member="serviceAccount:$CUENTA_EMAIL" --role=roles/artifactregistry.reader --quiet --format=none

paso "O5bis. Cuenta por defecto de Cloud Build (consulta; cambio solo con --neutralizar-cuenta-por-defecto)"
# Va ANTES de O5: con una cuenta por defecto de permisos amplios, el rol lanzador de las Functions permitiría lanzar builds
# con ella (escalada de privilegios).
DEFECTO="<cuenta-por-defecto>"
amplios() { # roles editor/owner que la cuenta por defecto tiene a nivel de proyecto (vacío = ninguno); falla si no se puede leer
  gcloud projects get-iam-policy "$PROYECTO" --flatten="bindings[].members" \
    --filter="bindings.members:serviceAccount:$DEFECTO AND (bindings.role:roles/editor OR bindings.role:roles/owner)" \
    --format="value(bindings.role)" 2>/dev/null
}
if (( APLICAR == 1 )); then
  NUMERO="$(gcloud projects describe "$PROYECTO" --format='value(projectNumber)' 2>/dev/null || true)"
  [[ "$NUMERO" =~ ^[0-9]+$ ]] || { echo "  No se pudo calcular el número del proyecto." >&2; exit 3; }
  DEFECTO="$(gcloud builds get-default-service-account --project="$PROYECTO" --format='value(serviceAccountEmail)' 2>/dev/null || true)"
  DEFECTO="${DEFECTO##*/}"
  if [[ -z "$DEFECTO" ]]; then
    echo "  No se pudo determinar la cuenta por defecto de Cloud Build: no se otorga el rol lanzador (falla cerrado)." >&2
    exit 3
  fi
fi
if (( NEUTRALIZAR == 1 )); then
  if (( APLICAR == 1 )) && [[ "$DEFECTO" == "$FUNCIONES" ]]; then
    echo "  La cuenta por defecto de Cloud Build es la misma que usan las Functions al ejecutar: quitarle Editor las rompería. No se neutraliza." >&2
    exit 3
  fi
  if (( APLICAR == 1 )); then
    case "$DEFECTO" in
      *@cloudbuild.gserviceaccount.com | *-compute@developer.gserviceaccount.com) ;;
      *) echo "  La cuenta por defecto no es la de Compute ni la heredada: no se cambia." ;;
    esac
  fi
  if (( APLICAR == 0 )) || [[ "$DEFECTO" == *@cloudbuild.gserviceaccount.com || "$DEFECTO" == *-compute@developer.gserviceaccount.com ]]; then
    ejecutar gcloud projects add-iam-policy-binding "$PROYECTO" --member="serviceAccount:$DEFECTO" \
      --role=roles/cloudbuild.builds.builder --condition=None --quiet --format=none
    if (( APLICAR == 0 )) || [[ "$(amplios)" == *roles/editor* ]]; then
      ejecutar gcloud projects remove-iam-policy-binding "$PROYECTO" --member="serviceAccount:$DEFECTO" \
        --role=roles/editor --condition=None --quiet --format=none
    fi
    echo "  SIGUIENTE (obligatorio): volver a desplegar las Functions (re-ejecutar desplegar-staging) y comprobar que las 12 construyen."
    echo "  Si fallan: volver a agregar roles/editor a la cuenta por defecto (add-iam-policy-binding) y re-desplegar."
  fi
fi
# Consulta (solo lectura): cuenta por defecto de Cloud Build.
ejecutar gcloud builds get-default-service-account --project="$PROYECTO"
if (( APLICAR == 1 )); then
  if ! roles="$(amplios)"; then
    echo "  No se pudieron leer los roles de la cuenta por defecto: no se otorga el rol lanzador (falla cerrado)." >&2
    exit 3
  fi
  if [[ -n "$roles" ]]; then
    echo "  La cuenta por defecto de Cloud Build tiene roles/editor o roles/owner (permisos amplios)." >&2
    echo "  No se otorga el rol lanzador a las Functions. Use --neutralizar-cuenta-por-defecto y repita; luego vuelva a desplegar las Functions." >&2
    exit 3
  fi
  echo "  La cuenta por defecto de Cloud Build no tiene editor ni owner: sigue O5."
fi
# Cuentas con las que construyen las Functions 2.ª gen: la consulta puede fallar (p. ej. API inactiva) y no detiene el paso.
if ! ejecutar gcloud functions list --v2 --project="$PROYECTO" --format="value(buildConfig.serviceAccount)"; then
  echo "  AVISO: no se pudo consultar las Functions 2.ª gen (¿API inactiva o sin Functions?); verifique a mano antes de neutralizar." >&2
fi

paso "O5. Permisos de $CUENTA_FN (rol mínimo, uso solo de $CUENTA, Firestore, registros)"
if existe gcloud iam roles describe "$ROL_LANZADOR" --project="$PROYECTO"; then
  ejecutar gcloud iam roles update "$ROL_LANZADOR" --project="$PROYECTO" \
    --permissions=cloudbuild.builds.create,cloudbuild.builds.get --quiet --format=none
else
  ejecutar gcloud iam roles create "$ROL_LANZADOR" --project="$PROYECTO" --title="Lanzador del constructor del sitio" \
    --permissions=cloudbuild.builds.create,cloudbuild.builds.get --stage=GA --quiet --format=none
fi
ejecutar gcloud projects add-iam-policy-binding "$PROYECTO" --member="serviceAccount:$FN_EMAIL" \
  --role="projects/$PROYECTO/roles/$ROL_LANZADOR" --condition=None --quiet --format=none
ejecutar gcloud iam service-accounts add-iam-policy-binding "$CUENTA_EMAIL" --project="$PROYECTO" \
  --member="serviceAccount:$FN_EMAIL" --role=roles/iam.serviceAccountUser --quiet --format=none
for rol in roles/datastore.user roles/logging.logWriter; do
  ejecutar gcloud projects add-iam-policy-binding "$PROYECTO" --member="serviceAccount:$FN_EMAIL" \
    --role="$rol" --condition=None --quiet --format=none
done

if (( ACTAS_PROPIO == 1 )); then
  paso "O5b. actAs de cada cuenta que encola sobre sí misma (solo si encolar falla sin él)"
  # El permiso de encolar lo da el código (`invoker` de construirSitio) en cada despliegue; aquí solo el actAs propio.
  for cuenta in "$FN_EMAIL" "$FUNCIONES"; do
    ejecutar gcloud iam service-accounts add-iam-policy-binding "$cuenta" --project="$PROYECTO" \
      --member="serviceAccount:$cuenta" --role=roles/iam.serviceAccountUser --quiet --format=none
  done
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
      # Falla cerrado: si no se puede listar, no se agrega ninguna versión.
      if ! versiones="$(gcloud secrets versions list "$s" --project="$PROYECTO" --limit=1 --format='value(name)' 2>/dev/null)"; then
        echo "  $s: no se pudo consultar sus versiones; no se agrega nada (falla cerrado)" >&2
        exit 3
      fi
      if [[ -n "$versiones" ]]; then
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
  lector="$CUENTA_EMAIL"
  [[ "$s" != "SITIOS_TENANT" ]] || lector="$FN_EMAIL"
  ejecutar gcloud secrets add-iam-policy-binding "$s" --project="$PROYECTO" \
    --member="serviceAccount:$lector" --role=roles/secretmanager.secretAccessor --quiet --format=none
done
unset valor

if (( AMPLIAR == 1 )); then
  paso "N9. Ampliar el rol $ROL_DESPLIEGUE (cola y tema que crea el despliegue; requiere revisión de seguridad)"
  ejecutar gcloud iam roles update "$ROL_DESPLIEGUE" --project="$PROYECTO" --add-permissions="$PERMISOS_N9" --quiet --format=none
fi

echo
if (( APLICAR == 1 )); then echo "Listo."; else echo "Simulación terminada: no se cambió nada. Use --aplicar para ejecutar."; fi
