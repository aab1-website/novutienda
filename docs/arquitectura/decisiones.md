# Decisiones de arquitectura

- 04/11/2026: opción A (monorepo, un proyecto Firebase de plataforma, datos bajo `tenants/{tenantId}`), con la puerta abierta a un proyecto por tenant.
- 04/11/2026: repositorio público, modo A del estándar DevSecOps. Los documentos comerciales y los datos del cliente no entran al historial (`.gitignore`).
- 04/11/2026: alcance = propuesta comercial firmada y su Anexo A; lo demás no se construye en esta entrega.
- Desviación del CI: `desplegar-staging` y `dast-y-humo` solo corren si `GCP_PROJECT_ID_STAGING` tiene valor. Sin esa condición `main` queda en rojo hasta federar el proyecto. Revisa el agente `seguridad`.
- 04/11/2026 — **Contrato de `dist/`** (cambia el de la plantilla del estándar). `pnpm build -- --mode <staging|production>` (`scripts/build.mjs`)
  entrega `dist/website/` (sitio, con `_cabeceras.json` sellado), `dist/panel/` (panel, con su `_cabeceras.json`) y `dist/firebase.json`
  (copia de `firebase.json` con la CSP sellada del sitio, compuesta por `plataforma/funciones/scripts/componer-hosting.mjs`). Ya no hay
  `dist/index.html` ni `dist/healthz`: `/healthz` lo atiende la función `api` (rewrite de Hosting). El artifact `dist-<ambiente>` lleva los
  tres; el job de despliegue usa `dist/firebase.json` como `firebase.json` tras comprobar que solo difiere del versionado en esa CSP. El
  `firebase.json` versionado no se reescribe nunca. Las Functions (`dist/funciones/`) **no** van en el artifact: las empaqueta el `predeploy`
  de `firebase.json` en el job de despliegue, desde el mismo commit (esbuild, determinista). Es la única excepción a «build una sola vez».
- 04/11/2026 — **CI multi-sitio.** Dos sitios de Hosting por target (`sitio`, `panel`); el CI aplica `firebase target:apply` con los ids de las
  variables de Environment `FIREBASE_SITE_SITIO` y `FIREBASE_SITE_PANEL` (`.firebaserc` efímero e ignorado). `FIREBASE_SITE_ID` de la
  plantilla no se usa. El canal `previa` y el rollback cubren los dos sitios; las Functions se revierten con `git revert` + tag, como las reglas.
  `FIREBASE_DEPLOY_ONLY` por defecto: `hosting,functions,firestore,storage`.
- 04/11/2026 — **Humo del panel fuera de `dast-y-humo`.** `_reusable-dast.yml` acepta un solo objetivo y su nombre de artifact es fijo, así
  que no admite matriz. DAST (ZAP) corre sobre el sitio (`STAGING_URL`); el panel tiene humo propio (200, CSP y HSTS) dentro de
  `desplegar-staging` y de `post-despliegue` (`.github/scripts/humo-hosting.sh`). **El panel queda sin DAST**: para cubrirlo hay que
  parametrizar el nombre del artifact en el reusable, aguas arriba (SeguridadGeneral). En `post-despliegue` se quitó la tolerancia de la
  plantilla (404 en `/healthz` aceptado si `/` da 200): aquí un 404 en `/healthz` significa Functions o rewrite caídos.
- 04/11/2026 — **Parámetros de Functions en el despliegue (contrato propuesto, pendiente del dueño de `plataforma/funciones`).**
  `firebase deploy` lee los parámetros de `dist/funciones/.env*` **después** del `predeploy`, y `empaquetar.mjs` borra `dist/funciones/`
  al empezar: un `.env` escrito antes se pierde y se desplegarían los valores por defecto (`SITIO_URL` y `MEDIOS_BASE_URL` vacíos) sin
  aviso. Propuesta: si la variable `FUNCIONES_PARAMETROS` apunta a un archivo, `empaquetar.mjs` lo copia a `dist/funciones/.env` al
  terminar. El CI ya escribe ese archivo desde variables y **falla** si `dist/funciones/.env` no aparece, en vez de desplegar con valores
  vacíos.
- 04/11/2026 — **Configuración web de Firebase del panel por ambiente.** `construir` no declara Environment (si lo hiciera, cada PR pediría
  la aprobación de `production`), así que no ve variables de Environment: la clave web va en variables de repositorio
  `VITE_FIREBASE_API_KEY_STAGING` y `VITE_FIREBASE_API_KEY_PROD` (clase P, pública por diseño; SEC-005 del estándar usa un solo nombre).
  `VITE_FIREBASE_PROJECT_ID` sale de `GCP_PROJECT_ID_STAGING`/`_PROD` y `VITE_FIREBASE_AUTH_DOMAIN` es `<proyecto>.firebaseapp.com`.
- 04/11/2026 — **`test:funciones` en el job `calidad`** (no en un job propio): así lo cubre `compuerta-pr` sin cambiar sus `needs`. `calidad`
  sube a 30 minutos y usa el JDK 21 que trae el runner (firebase-tools 15).
- 04/11/2026 — **`deploy.sh staging` no sirve para este repositorio todavía:** la copia del estándar despliega `hosting,firestore:rules` al
  sitio por defecto y no conoce targets ni Functions. Staging se despliega por CI (merge a `main`). La corrección va aguas arriba.
