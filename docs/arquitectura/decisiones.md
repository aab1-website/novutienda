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
- 04/11/2026 — **La CSP del panel la define su build.** `paquetes/panel/scripts/sellar.mjs` escribe `dist/panel/_cabeceras.json` (CSP y demás
  cabeceras) y `componer-hosting.mjs` lo incorpora a la regla `**` del target `panel` de `dist/firebase.json`, igual que el sello del sitio:
  una sola fuente de verdad. La sección del target `panel` de `firebase.json` versionado es solo el valor base y una prueba
  (`pruebas/panel/cabeceras.test.ts`) exige que sea idéntica a lo que genera el build, de modo que `dist/firebase.json` solo difiere del
  versionado en la regla `**` del sitio y la comprobación de `preparar-despliegue-firebase.sh` sigue válida sin cambios. Contenido:
  `connect-src` con Firebase Auth (`identitytoolkit`, `securetoken`), funciones (el host exacto `https://us-east1-<proyecto>.cloudfunctions.net` cuando el build tiene `VITE_FIREBASE_PROJECT_ID`; sin esa variable, el respaldo `https://*.cloudfunctions.net`; el SDK de callables no usa `*.a.run.app`, que se eliminó), Cloud Storage
  (`firebasestorage.googleapis.com`) y App Check/reCAPTCHA Enterprise; `img-src` y `media-src` limitados a Cloud Storage y `blob:`; sin
  Firestore (el panel no usa su SDK); HSTS 63072000; `Permissions-Policy` con `usb=()`. **Desviación:** CSP solo admite comodín en la primera
  etiqueta (`*.`), así que `https://us-east1-*.cloudfunctions.net` no es una fuente válida y se usa `https://*.cloudfunctions.net`; restringir a
  `us-east1-<proyecto>` exigiría el id del proyecto en la CSP versionada (repositorio público). `Cross-Origin-Opener-Policy: same-origin`:
  reCAPTCHA Enterprise de App Check usa un marco invisible y el inicio de sesión no usa ventanas emergentes, así que no se relaja a
  `same-origin-allow-popups`; si una prueba con reCAPTCHA real lo exigiera, se cambia solo en `sellar.mjs` (y la prueba lo detecta en `firebase.json`).
- 04/11/2026 — **Lectura solo por callables (M2).** Los manifiestos de recibos, inventarios y consola declaran `lectura: []` en todas sus colecciones: el panel no usa
  Firestore (ni el SDK ni su CSP) y consulta todo por los callables, que aplican el rol. `firestore.rules` se regenera y niega toda lectura directa de esas colecciones.
  **Paso del pase:** en la consola de Firebase, App Check debe quedar **«Enforced»** en Firestore y en Storage (además de `APP_CHECK_EXIGIDO=true` en los callables); sin eso, un
  token de usuario robado podría llamar a las APIs de Firestore y Storage directamente. (POS y sitio conservan lecturas declaradas por sus dueños: pendiente de la misma decisión.)
- 04/11/2026 — **Riesgo anotado de la CSP del panel (acotado).** Ya no hay `*.a.run.app`. Con `VITE_FIREBASE_PROJECT_ID` el build sella el host exacto de funciones y un script inyectado no puede
  enviar datos a funciones de otros proyectos. Queda el respaldo `https://*.cloudfunctions.net` solo para compilaciones sin esa variable (locales y el valor base versionado); el CI de staging y producción
  debe exportarla para que el sello definitivo sea el exacto. Alternativa a futuro: servir las funciones por el dominio de Hosting (`/api/**`).
- 04/11/2026 — **El build de producción del sitio no admite contenido de ejemplo; el redondeo sale de la configuración.** `cargarContenido` lanza con `APP_ENV=production` y
  `esEjemplo`; `GET /api/sitio/v1/publicado` entrega `redondeo` desde `tenants/{t}/config/redondeo` y la reconstrucción lo inyecta en `config.redondeo` (`reconstruccion-sitio.md`).
  `construir` compila `production` solo en tags y `workflow_dispatch`, con `SITIO_CONTENIDO`.
- 04/11/2026 — **Límite de tasa y origen.** `ipDelCliente` toma el elemento de `X-Forwarded-For` a `PROXY_SALTOS` (2) posiciones del final: Fastly añade la IP del cliente y el GFE la de
  Fastly. Se descartan `Fastly-Client-IP` y el primer elemento (los escribe el cliente; la función es invocable por su URL directa). **Supuesto a verificar en staging** con una petición
  real. App Check va antes del límite en `/api/contacto`; NovuChat y `/api/disponibilidad` tienen un límite en memoria por instancia antes de autenticar.
- 04/11/2026 — **Variables nuevas del build del panel:** `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY_*`, `VITE_FIREBASE_STORAGE_BUCKET_*`, `VITE_FIREBASE_APP_ID_*` (`_STAGING`/`_PROD`). El SDK de
  App Check arma `…/apps/{appId}:exchange…` con `app.options.appId`: sin `appId` el intercambio de token falla. `construir` falla si falta alguna con proyecto configurado.
- 04/11/2026 — **App Check de un solo uso en el formulario del sitio.** El servidor consume el token (`consume: true`) y el navegador lo entrega con `window.cbAppCheck` (`islas/appcheck.ts`): SDK de Firebase con
  `ReCaptchaEnterpriseProvider` y `getLimitedUseToken` por envío; se descarga solo al enfocar el formulario. Sin el bloque `config.appCheck` del contenido publicado (clave de sitio de reCAPTCHA Enterprise registrada para App Check, `apiKey`, `appId`
  y `projectId` de la app web; públicos, fuera del repositorio) no se inicializa y el formulario avisa que no está disponible. La app de Firebase del sitio se llama `cb-contacto`. CSP del sitio: cuando existe ese bloque se agrega
  `https://content-firebaseappcheck.googleapis.com` (el host que usa el SDK, no `firebaseappcheck.`) a `connect-src` (canje del token) y se habilitan los orígenes de reCAPTCHA Enterprise que ya usa el antiabuso (`www.google.com/recaptcha/`, `www.gstatic.com/recaptcha/`, marco de `www.google.com`); nada más.
  Dependencia `firebase` 13.1.0, igual que el panel (la 13.2.0 tenía menos de 7 días). Pasos del pase: registrar la app web del sitio en App Check con reCAPTCHA Enterprise y cargar el bloque en el contenido publicado.
