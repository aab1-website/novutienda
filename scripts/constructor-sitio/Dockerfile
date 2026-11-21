# Imagen del constructor del sitio: la usa Cloud Build para reconstruir, desplegar y certificar el sitio de un
# tenant con `bash /app/scripts/reconstruir-sitio.sh` (el mismo script que el job de GitHub).
# Plano: docs/produccion/reconstruccion-sitio.md. Contexto de construcción: la RAÍZ del repositorio.
#
#   docker build -f scripts/constructor-sitio/Dockerfile -t constructor-sitio .
#
# Sin secretos ni identificadores: todo llega por variables de entorno en tiempo de ejecución.
#
# Base fijada por digest LITERAL en cada FROM (Checkov CKV_DOCKER_7 no acepta ARG) del índice multiarquitectura de
# node:22-slim (consultado en el registro público el 21/11/2026). Al refrescarlo se cambian los dos FROM; el escaneo
# Trivy del CI bloquea CRITICAL y HIGH.
# Mismas versiones que deploy.sh y scripts/reconstruir-sitio.sh (FIREBASE_TOOLS_VERSION) y package.json
# (packageManager); una prueba (pruebas/funciones/constructor-sitio.test.ts) verifica que no se desalineen.
ARG FIREBASE_TOOLS_VERSION=15.37.0
ARG PNPM_VERSION=11.28.13

# ---------------------------------------------------------------------------
# Etapa 1: dependencias del repositorio (pnpm install --frozen-lockfile).
# ---------------------------------------------------------------------------
FROM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS dependencias
ARG PNPM_VERSION
WORKDIR /app
# pnpm se instala con npm (no con corepack): sin bajar versiones de pnpm por la red en cada ejecución.
RUN npm install -g "pnpm@${PNPM_VERSION}"
# El lockfile y los package.json primero: la capa de dependencias se reutiliza mientras no cambien.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY paquetes ./paquetes
COPY plataforma/funciones/package.json ./plataforma/funciones/package.json
COPY tenants ./tenants
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Etapa 2: imagen final, sin usuario root, con lo que necesita el script.
# ---------------------------------------------------------------------------
FROM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS constructor
ARG FIREBASE_TOOLS_VERSION
ARG PNPM_VERSION
ENV NODE_ENV=production \
    OMITIR_INSTALAR=1 \
    FIREBASE_TOOLS_VERSION=${FIREBASE_TOOLS_VERSION}
# bash, curl y jq: los usa reconstruir-sitio.sh (humo y preparar-sitio-tenant.sh).
# Sin npm ni corepack al final: el script no los usa y su árbol de dependencias (brace-expansion, pacote, sigstore…)
# es superficie de ataque que Trivy marca. pnpm y firebase-tools quedan instalados.
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl jq \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g "pnpm@${PNPM_VERSION}" "firebase-tools@${FIREBASE_TOOLS_VERSION}" \
    && npm cache clean --force \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
              /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /root/.npm \
    && mkdir -p /app && chown node:node /app
WORKDIR /app
# Todo el repositorio (la lista de exclusiones está en Dockerfile.dockerignore) con sus node_modules ya instalados.
COPY --chown=node:node . .
COPY --from=dependencias --chown=node:node /app/node_modules ./node_modules
COPY --from=dependencias --chown=node:node /app/paquetes ./paquetes
COPY --from=dependencias --chown=node:node /app/plataforma ./plataforma
COPY --from=dependencias --chown=node:node /app/tenants ./tenants
USER node
ENV HOME=/home/node
# Es un trabajo que corre y termina (lo lanza Cloud Build): no hay servidor ni puerto que sondear.
HEALTHCHECK NONE
# Los pasos de Cloud Build lo ejecutan con `bash /app/scripts/reconstruir-sitio.sh [reconstruir|certificar]`.
ENTRYPOINT ["bash", "/app/scripts/reconstruir-sitio.sh"]
CMD ["reconstruir"]
