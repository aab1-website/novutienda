# Renombre del repositorio a `novutienda`

Estado: **sin ejecutar**. Lo corre Claude con el «sí» de Andres; Andres no corre comandos. Va **antes** de la federación de staging
(`pase-a-staging.md`, paso 5). `OWNER` y el nombre actual (`NOMBRE_ACTUAL`) se cargan de `CONFIGURACION.local.md`.

## 1. Antes (modo lectura)

```bash
gh repo view "$OWNER/$NOMBRE_ACTUAL" --json name,visibility,defaultBranchRef
gh api "repos/$OWNER/$NOMBRE_ACTUAL/rulesets" --jq '.[].name'
gh api "repos/$OWNER/$NOMBRE_ACTUAL/environments" --jq '.environments[].name'
gh variable list --repo "$OWNER/$NOMBRE_ACTUAL"; gh secret list --repo "$OWNER/$NOMBRE_ACTUAL"   # nombres, nunca valores
gh repo view "$OWNER/novutienda" >/dev/null 2>&1 && echo "YA EXISTE un repositorio con ese nombre: detenerse"
```

Sin runs en curso: `gh run list --repo "$OWNER/$NOMBRE_ACTUAL" --status in_progress`.

## 2. Renombre (escritura en GitHub; requiere autorización)

```bash
gh repo rename novutienda --repo "$OWNER/$NOMBRE_ACTUAL" --yes
```

GitHub conserva rulesets, Environments, variables, secretos, issues y PR, y redirige la URL vieja (web y git). La redirección se pierde si
alguien crea otro repositorio con el nombre viejo: no reutilizarlo.

## 3. Después

1. **Remoto local** (escritura solo en el repositorio local; la redirección funciona, pero no se depende de ella):
   `git -C /home/andres-alberdi/NovuTienda remote set-url origin "https://github.com/$OWNER/novutienda.git"` y comprobar con
   `git ls-remote origin HEAD`. Los worktrees de `.claude/worktrees/` comparten ese remoto.
2. **Federación (WIF)**: el binding `principalSet://…/attribute.repository/OWNER/REPO` usa el nombre. Si ya se había federado con el nombre
   viejo, volver a correr `setup-oidc-gcp.sh --repo novutienda` en cada proyecto (staging y, después, producción) y quitar el binding del
   nombre viejo (`gcloud iam service-accounts remove-iam-policy-binding`), para que un repositorio nuevo con el nombre viejo no herede el
   acceso. Desde el 15/07/2026 el claim `sub` de GitHub cambia en repositorios renombrados; el script no depende de `sub`.
3. **Variables, secretos y Environments**: no cambian de nombre ni de valor (son del repositorio, no de su nombre). Verificar con los
   mismos comandos del paso 1 sobre `OWNER/novutienda`. Lo único que puede contener el nombre es una URL guardada a mano: revisar los valores
   de `STAGING_URL`, `PROD_URL` y `PANEL_URL` (no deberían contenerlo).
4. **Rulesets**: siguen aplicando; comprobar que `compuerta-pr` sigue siendo el status check requerido (`gh api repos/$OWNER/novutienda/rulesets/<ID>`).
5. **Fuera del repositorio**: badges o enlaces en documentos, la ficha del registro de proyectos (`~/Claude-Proyectos/proyectos/`, la
   actualiza la sesión de este proyecto), integraciones que clonen por URL (n8n, si las hubiera) y la configuración de Scorecard/CodeQL
   (no requieren cambios). El nombre de la carpeta local del proyecto **no** cambia sin una decisión aparte de Andres (cada carpeta de
   `~/` es un proyecto; moverla rompe rutas de otras sesiones).
6. Primer run tras el renombre: un PR trivial confirma que Actions y la compuerta funcionan; OIDC se confirma con el primer despliegue a staging.
