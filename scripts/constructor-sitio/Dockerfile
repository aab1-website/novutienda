# Imagen del constructor del sitio: la usa Cloud Build para reconstruir, desplegar y certificar el sitio de un
# tenant con `bash /app/scripts/reconstruir-sitio.sh` (el mismo script que el job de GitHub).
# Plano: docs/produccion/reconstruccion-sitio.md. Contexto de construcción: la RAÍZ del repositorio.
#
#   docker build -f scripts/constructor-sitio/Dockerfile -t constructor-sitio .
#
# Sin secretos ni identificadores: todo llega por variables de entorno en tiempo de ejecución.
#
# Base fijada por digest del índice multiarquitectura de node:22-slim (consultado en el registro público el
# 21/11/2026). Dependabot/Renovate o el CI deben refrescarlo; el escaneo Trivy del CI bloquea CRITICAL y HIGH.
ARG NODE_IMAGEN=node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
# Mismas versiones que .github/workflows/reconstruir-sitio.yml (FIREBASE_TOOLS_VERSION) y package.json (packageManager);
# una prueba (pruebas/funciones/constructor-sitio.test.ts) verifica que no se desalineen.
ARG FIREBASE_TOOLS_VERSION=15.28.1
ARG PNPM_VERSION=11.25.0

# ---------------------------------------------------------------------------
# Etapa 1: dependencias del repositorio (pnpm install --frozen-lockfile).
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGEN} AS dependencias
ARG PNPM_VERSION
ENV COREPACK_HOME=/opt/corepack
WORKDIR /app
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate
# El lockfile y los package.json primero: la capa de dependencias se reutiliza mientras no cambien.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY paquetes ./paquetes
COPY plataforma/funciones/package.json ./plataforma/funciones/package.json
COPY tenants ./tenants
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Etapa 2: imagen final, sin usuario root, con lo que necesita el script.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGEN} AS constructor
ARG FIREBASE_TOOLS_VERSION
ARG PNPM_VERSION
ENV COREPACK_HOME=/opt/corepack \
    NODE_ENV=production \
    OMITIR_INSTALAR=1 \
    FIREBASE_TOOLS_VERSION=${FIREBASE_TOOLS_VERSION}
# bash, curl y jq: los usa reconstruir-sitio.sh (humo y preparar-sitio-tenant.sh).
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl jq \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
    && npm install -g "firebase-tools@${FIREBASE_TOOLS_VERSION}" \
    && npm cache clean --force
WORKDIR /app
# Todo el repositorio (la lista de exclusiones está en Dockerfile.dockerignore) con sus node_modules ya instalados.
COPY --chown=node:node . .
COPY --from=dependencias --chown=node:node /app/node_modules ./node_modules
COPY --from=dependencias --chown=node:node /app/paquetes ./paquetes
COPY --from=dependencias --chown=node:node /app/plataforma ./plataforma
COPY --from=dependencias --chown=node:node /app/tenants ./tenants
USER node
ENV HOME=/home/node
# Los pasos de Cloud Build lo ejecutan con `bash /app/scripts/reconstruir-sitio.sh [reconstruir|certificar]`.
ENTRYPOINT ["bash", "/app/scripts/reconstruir-sitio.sh"]
CMD ["reconstruir"]
