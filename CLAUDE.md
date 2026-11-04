# plataforma — memoria del proyecto para Claude Code

Estándar DevSecOps v2.0 (2026-08-24). Stack: `node-firebase` · Proveedor: `firebase` · Modo: `A` · Estándar local: `/home/andres-alberdi/SeguridadGeneral`

## Descripción

plataforma se construye y despliega según el estándar de seguridad de la organización. Este archivo es la política ejecutable del repositorio: lo que está aquí no admite interpretación. Cuando necesite detalle, lea el documento del estándar indicado en la sección "Documentos de referencia" antes de actuar.

Flujo: trabajo en ramas `feat/*`, `fix/*`, `chore/*`, `hotfix/*` → PR hacia `main` (squash) → merge despliega automáticamente a **staging** → tag `vX.Y.Z` despliega a **producción** con aprobación humana. El manifiesto `.devsecops.yml` declara componentes, proveedores y ambientes; léalo antes de tocar workflows o scripts de despliegue.

## Comandos

| Acción | Comando |
|---|---|
| Instalar dependencias | `pnpm install --frozen-lockfile` |
| Pruebas | `pnpm test` (con cobertura: `pnpm test -- --run --coverage`) |
| Lint y tipos | `pnpm lint` · `pnpm typecheck` |
| Build por ambiente | `APP_ENV=staging pnpm build` |
| Seguridad estática local | `./security-local.sh` (informe en `.security-reports/ultimo/resumen.md`) |
| Desplegar a staging | `./deploy.sh staging` (`--dry-run` para ver los comandos) |
| Desplegar a producción | **No lo ejecute.** Lo hace una persona: tag `vX.Y.Z` + aprobación del Environment (A/B) o `workflow_dispatch` del `ci-*` con `confirmar=DESPLEGAR` (B0). Ver `/pase-a-produccion`. |
| Validar workflows | `actionlint .github/workflows/*.yml` |
| Reglas Firestore | `pnpm reglas:generar` · `pnpm reglas:verificar` · `pnpm test:rules` (levanta el emulador; dentro de `emulators:exec` reutiliza el existente) |

Ajuste esta tabla si los scripts de `package.json`/`pyproject.toml` tienen otros nombres; no invente comandos.

## Reglas obligatorias antes de dar por terminada cualquier tarea

1. **Pruebas en verde**: ejecute la suite completa; si añade funcionalidad, añada pruebas. No marque una tarea como terminada con pruebas fallando o saltadas.
2. **`./security-local.sh` sin CRITICAL ni HIGH** no exceptuados. Si faltan herramientas, indíquelo explícitamente en su respuesta; un análisis vacío no equivale a un análisis limpio.
3. **Conventional Commits** con los tipos admitidos: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `security`, `revert`; descripción en español permitida. Un cambio por commit; sin `--no-verify`.
4. **Nunca confirme (commit) secretos**: ni `.env`, ni claves, ni JSON de service accounts, ni tokens en código o en workflows. Los secretos se referencian por nombre (`secrets.GCP_WIF_PROVIDER`), nunca por valor. Si detecta uno en el historial, deténgase e informe.
5. **Nunca degrade reglas de seguridad de datos ni de IAM**: `firestore.rules`, `storage.rules`, políticas IAM, trust policies OIDC, roles de service accounts. Un cambio que amplíe permisos requiere justificación escrita en el PR y aprobación del propietario.
6. **Nunca despliegue a producción** ni cree el tag `vX.Y.Z` sin instrucción explícita de una persona; nunca use `deploy.sh prod`, `--forzar`, `gh workflow run ci-*.yml` con `confirmar=DESPLEGAR`, ni apruebe un Environment. Prepare el pase (`/pase-a-produccion`) y entregue los comandos para que la persona los ejecute.
7. **No desactive controles**: no comente pasos de workflows, no añada `continue-on-error`, no relaje `bloquear_en`, no cree `.trivyignore`/`.semgrepignore` para ocultar hallazgos. Las excepciones van solo en `seguridad.excepciones` de `.devsecops.yml`, con `vence`, y las aprueba el propietario.
8. **Acciones fijadas por SHA** con comentario de versión en todo workflow que edite (convenciones en `/home/andres-alberdi/SeguridadGeneral/00-gobernanza/00-convenciones.md`; tabla de SHAs vigente en `/home/andres-alberdi/SeguridadGeneral/02-pipelines/README.md`).
9. **Revise el diff antes de proponer el commit** (`git diff --cached`) y use `.github/PULL_REQUEST_TEMPLATE.md` al abrir PRs.

## Documentos de referencia (léalos por ruta cuando la tarea lo requiera)

| Tema | Documento |
|---|---|
| Convenciones (nombres, jobs, variables, manifiesto) | `/home/andres-alberdi/SeguridadGeneral/00-gobernanza/00-convenciones.md` |
| Política maestra, fases, roles, severidades, excepciones | `/home/andres-alberdi/SeguridadGeneral/00-gobernanza/01-politica-cicd-devsecops.md` |
| Flujo git, ramas, tags, Conventional Commits | `/home/andres-alberdi/SeguridadGeneral/00-gobernanza/02-flujo-git-y-versionado.md` |
| Ambientes, modos A/B/B0, aprobaciones | `/home/andres-alberdi/SeguridadGeneral/00-gobernanza/03-ambientes-modos-y-aprobaciones.md` |
| Herramientas y costos | `/home/andres-alberdi/SeguridadGeneral/00-gobernanza/04-matriz-herramientas-y-costos.md` |
| Multicloud y manifiesto | `/home/andres-alberdi/SeguridadGeneral/00-gobernanza/05-estrategia-multicloud.md` |
| Secretos y variables (nombres exactos) | `/home/andres-alberdi/SeguridadGeneral/01-seguridad/01-gestion-de-secretos.md` |
| OIDC / WIF por nube | `/home/andres-alberdi/SeguridadGeneral/01-seguridad/02-identidad-federada-oidc.md` |
| Hardening GCP/Firebase, AWS, OCI | `/home/andres-alberdi/SeguridadGeneral/01-seguridad/03-hardening-por-nube.md` |
| Contenedores, IaC, SBOM, firma | `/home/andres-alberdi/SeguridadGeneral/01-seguridad/04-contenedores-iac-y-cadena-de-suministro.md` |
| Checklist de pase a producción | `/home/andres-alberdi/SeguridadGeneral/01-seguridad/05-checklist-pase-a-produccion.md` |
| Rollback e incidentes | `/home/andres-alberdi/SeguridadGeneral/01-seguridad/06-rollback-e-incidentes.md` |
| Workflows y configuración de escáneres | `/home/andres-alberdi/SeguridadGeneral/02-pipelines/README.md`, `workflows/`, `config/` |
| Scripts operativos | `/home/andres-alberdi/SeguridadGeneral/03-scripts/` (`deploy.sh`, `security-local.sh`, `bootstrap-repo.sh`, `setup-oidc-*.sh`) |
| Esta integración | `/home/andres-alberdi/SeguridadGeneral/04-claude-code/README.md` |

## Convenciones de código

- Idioma: código e identificadores en inglés; comentarios, commits, documentación y mensajes al usuario en español formal (sin voseo).
- Node: TypeScript o ESM moderno, ESLint + Prettier, Vitest; sin `any` injustificado; validar entradas en el borde (zod o equivalente). Python: 3.12, Ruff (lint y formato), pytest, tipado con `typing`; FastAPI/Flask con validación de esquemas.
- Contenedores: Dockerfile multi-stage, usuario no root, imagen base fijada por digest, sin secretos en `ARG`/`ENV`.
- Configuración por variable de entorno (`APP_ENV`), nunca por archivos con credenciales embebidas. `.env.example` documenta las variables sin valores reales.
- Registros (logs) sin datos personales ni tokens. Errores con mensajes útiles para el usuario y detalle técnico solo en el log.
- Terraform: `terraform fmt`, módulos con versión fijada, estado remoto cifrado; nunca `-auto-approve` en producción desde un agente.

## Invariantes del proyecto

- **Zonas de propiedad por carpeta:** `paquetes/nucleo` (registro, contratos, identidad), `paquetes/<modulo>` (un módulo, un dueño), `tenants/<tenant>` (solo configuración y extensiones), `pruebas/` (fronteras y reglas), `scripts/` y raíz (andamiaje). Un archivo lo escribe un solo agente por vez.
- **Fronteras de importación:** `nucleo` no importa ningún paquete interno; `paquetes/<m>` importa solo `@plataforma/nucleo` y lo que su manifiesto declare; `tenants/*` importa solo `@plataforma/nucleo/extension`; nunca a `/src/` de otro paquete. Lo verifica `pruebas/fronteras`.
- **Un dueño por dato:** cada colección pertenece al manifiesto de un solo módulo (rutas únicas); Inventarios es dueño de productos y stock; solo el servidor escribe ventas y movimientos. Las reglas de Firestore se generan desde el registro de módulos y nunca se amplían a mano.
- **Repositorio público:** nada de PDF comerciales, identificadores (proyectos, cuentas, teléfonos) ni datos del cliente en el código, la configuración o el historial. Los paquetes no mencionan al cliente; lo propio de un cliente vive en `tenants/<tenant>`.
- **Andres autoriza antes de escribir fuera del repositorio:** GitHub, Firebase, servicios externos y cualquier carpeta distinta de este proyecto.

## Qué hacer ante hallazgos de seguridad

1. Lea `.security-reports/ultimo/resumen.md` (o el SARIF del pipeline). Clasifique por severidad y herramienta.
2. CRITICAL/HIGH: corrija en la misma rama antes de continuar. Si es una dependencia, actualice a la versión con fix y vuelva a correr pruebas; si no hay fix, documente el análisis y proponga al propietario una excepción con `id`, `herramienta`, `componente`, `justificacion`, `aprobado_por`, `creado`, `vence` (máximo 90 días).
3. MEDIUM: corrija si el costo es bajo; si no, regístrelo en el PR con fecha de compromiso (30 días).
4. Secreto detectado (gitleaks, secret scanning): no lo borre "en silencio". Informe al propietario, rote la credencial y luego limpie el historial según `/home/andres-alberdi/SeguridadGeneral/01-seguridad/01-gestion-de-secretos.md`.
5. Falso positivo: justifíquelo con evidencia (línea, contexto, por qué no es explotable) en la excepción; nunca editando la configuración del escáner para silenciar la regla completa.
6. Delegue el análisis detallado al agente `seguridad` cuando el hallazgo no sea trivial; entregue su informe en el PR.

## Subagentes disponibles (`.claude/agents/`)

| Agente | Úselo para | No puede |
|---|---|---|
| `devsecops` | Aplicar o corregir el estándar: workflows, manifiesto, rulesets, pines por SHA, `bootstrap-repo.sh`, migrar de v1 a v2 | Relajar controles; añadir excepciones |
| `seguridad` | Revisar código, reglas Firestore/IAM, Dockerfiles, IaC, dependencias; interpretar informes; proponer remediaciones | Modificar archivos (solo lectura y comandos de análisis) |
| `deploy` | Desplegar a staging con `deploy.sh`, diagnosticar despliegues y health checks, guiar rollbacks | Ejecutar `deploy.sh prod`, crear tags, usar `--forzar` |
| `proyectos` (Opus) | Revisar estado del proyecto frente al estándar, preparar actas de pase a producción, métricas DORA, resúmenes para dirección | Modificar archivos |
| `planificador` (Opus) | Planificar antes de implementar: pasos exactos, pruebas, riesgos y decisiones pendientes | Modificar archivos |
| `implementador` (Sonnet) | Ejecutar un plan ya definido, escribir pruebas, corregir lint/tipos/pruebas | Tomar decisiones de diseño; desplegar |
| `revisor-codigo` (Opus) | Revisar el diff tras implementar y antes del PR: corrección, reglas de este archivo, pruebas | Modificar archivos |

Skills: `/aplicar-estandar-devsecops` (repositorio nuevo o desactualizado) y `/pase-a-produccion` (antes de crear un tag de release).

## Delegación entre agentes y costo

La sesión principal orquesta y no codifica tareas extensas por sí misma. El modelo de cada agente está fijado en el campo `model` de su archivo en `.claude/agents/` (esa es la fuente de verdad): lo decide quién verifica la salida del agente: **Sonnet** cuando después pasan pruebas o un revisor en Opus (ejecutar lo ya planificado); **Opus** cuando la salida es el veredicto, la cifra o el acta y nadie la vuelve a mirar (planificar, revisar, seguridad, actas).

1. Cambio que toca más de un archivo, una regla de negocio, datos persistidos o una integración: `planificador` → `implementador` (o el agente de dominio del repositorio) → `revisor-codigo` (y `seguridad` si el cambio toca autenticación, reglas de acceso, IAM, dependencias o infraestructura).
2. Búsquedas amplias en el código: delegar en el agente integrado `Explore` (modelo económico) en vez de leer muchos archivos en la sesión principal. Al lanzar subagentes de exploración o de lectura masiva, usar `model: haiku`.
3. Planificar con Opus en una sesión corta y separada y ejecutar con Sonnet en otra, que es el modelo por defecto de la sesión. Para abrir la de Opus sin cambiar ese valor por defecto, usar `claude --model opus` o la tecla `s` del selector de `/model`: `/model opus` a secas lo guardaría como nuevo valor por defecto. No alternar de modelo dentro de una misma sesión larga (cada modelo tiene su propia caché de prompts). No dejar a Opus iterando sobre errores de compilación o de pruebas.
4. Al delegar, pasar rutas, el plan y el criterio de terminado; no pegar contenido extenso. Cada subagente vuelve a cargar este archivo y lee lo demás por ruta.
5. No usar el modo rápido (*fast mode*) salvo pedido explícito: cuesta el doble por token.
6. **Este archivo es estable.** No registrar aquí avances, estado, fechas de sesión ni pendientes (van en el historial de git, en los PR o en un `ESTADO.md` aparte). Un `CLAUDE.md` que no cambia entre sesiones permite reutilizar la caché de contexto en la sesión principal y en cada subagente; cada edición la invalida.
