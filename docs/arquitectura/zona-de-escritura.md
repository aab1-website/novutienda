# La zona de escritura: el gancho que limita a cada agente a su carpeta

> Pieza del método de la arquitectura por zonas (`01-arquitectura-por-zonas.md` §8 «ejecución con
> agentes» y §9 «cómo se sostiene»). El gancho es `.claude/hooks/zona-de-escritura.sh`; su prueba,
> `.claude/hooks/probar-zona-de-escritura.sh`; su registro, `.claude/settings.json`. Adaptado del
> gancho del mismo nombre de NovuChat, leído como referencia (la idea, no el estado). Sin secretos ni
> identificadores.

## Qué hace

Es un control `PreToolUse` de Claude Code sobre `Edit`, `Write` y `MultiEdit`. Cuando el agente tiene una
zona definida, toda escritura fuera de ella recibe `permissionDecision: deny` con un mensaje que dice la
ruta, la zona y qué hacer («si el cambio corresponde a otra zona, se anota en el PR y lo hace el agente
dueño»). Cuando no hay zona, no hace nada: la sesión de Andres sigue igual que siempre.

Es el candado aplicado a la arquitectura: la zona escrita en la ficha de un agente es un prompt, y el
prompt no es una barrera.

## De dónde sale la zona (dos fuentes, en este orden)

1. **La variable de entorno `NOVUTIENDA_ZONA`**, si existe y no está vacía. Sirve para lanzar una sesión
   con zona desde afuera (`NOVUTIENDA_ZONA=… claude`). Manda sobre el archivo y se ancla en
   `CLAUDE_PROJECT_DIR`.
2. **Todos los `.claude/zona` que aparezcan, a la vez** (intersección): subiendo desde el `cwd` que
   Claude Code manda en el evento (el worktree donde trabaja el agente) y desde el archivo destino, cada
   recorrido hasta su primera **raíz git real** (un `.git` directorio, o un archivo `gitdir:` cuya ruta
   existe). La de `CLAUDE_PROJECT_DIR` entra solo de respaldo, cuando el `cwd` no dio ninguna. El
   destino tiene que caber en cada zona encontrada.

**El archivo `.claude/zona` lo escribe quien lanza al agente** (la sesión coordinadora) al crear el
worktree, **no el agente, y nunca se versiona**: está en `.gitignore` y la prueba del gancho falla si
no lo está. Si llegara a `main`, toda sesión heredaría esa zona (`deny` para todos, incluida la de
Andres). Dos subagentes lanzados desde una misma sesión comparten el entorno, así que una variable no
los distingue; cada uno trabaja en su worktree (`.claude/worktrees/`) y ahí `.claude/zona` lleva su zona.

Las dos fuentes usan la misma sintaxis: prefijos de ruta permitidos separados por `:` (en el archivo,
también uno por línea; las líneas que empiezan con `#` son comentarios), relativos a la raíz del
proyecto o absolutos.

```
# .claude/zona del agente metodo
docs/
.claude/
CLAUDE.md
.github/CODEOWNERS
pruebas/fronteras/
scripts/zonas.mjs
ESTADO.md
```

- Un prefijo que termina en `/` es una carpeta; uno que no, es un archivo exacto o una carpeta
  (`CLAUDE.md` acepta solo ese archivo; `docs` vale como `docs/`). `CLAUDE.md.bak` no entra.
- Un prefijo absoluto sirve para carpetas fuera del proyecto (por ejemplo, el scratchpad de la sesión).
- **Un prefijo que resuelva a la raíz del proyecto, a `/` o a un ancestro de la raíz se rechaza**: una
  zona así no limita nada, y el gancho responde `deny` a toda escritura hasta que la zona nombre
  carpetas concretas.

La zona de cada agente está escrita en su ficha de `.claude/agents/` (`nucleo`, `central`,
`plataforma`, `modulo`, `coordinador`, `metodo`, `implementador`); el mapa de zonas por archivo, en
`zonas.md` y `pruebas/fronteras/zonas.ts`.

## Rutas, `..` y enlaces simbólicos

Destino y prefijos se resuelven con `realpath`; cuando el archivo todavía no existe (un `Write` nuevo),
se resuelve la carpeta padre existente más cercana y se vuelve a pegar el resto. Así:

- `docs/../paquetes/nucleo/src/x.ts` se evalúa como `paquetes/nucleo/src/x.ts`.
- Un enlace simbólico dentro de la zona que apunte afuera se rechaza, también para un archivo nuevo
  debajo del enlace.
- Una ruta relativa se juzga **contra el `cwd` del evento**, que es contra lo que la herramienta la
  escribe; los prefijos relativos, contra la raíz de su zona.
- **Con la zona activa no se escribe un `.git` ni un `.claude/zona`**: sería plantar desde adentro una
  raíz o una zona nuevas. Límite declarado: un `.git` plantado con `Bash` en una subcarpeta donde el
  agente deja su `cwd` corta el recorrido; exige `Bash` con intención, y ese agente ya puede escribir
  directo con `Bash`.

## Fallo cerrado

Con la zona activa, el gancho **niega antes que dejar pasar** lo que no pudo comprobar: un
`.claude/zona` sin prefijos (vacío o solo comentarios), `python3` ausente, un evento que no es JSON, un
evento o `tool_input` que no son objetos, o sin `file_path`. Sin zona, no opina. Sale siempre con 0.

## Lo que no cubre

- **`Bash`.** Un `sed -i` o un `cat >` desde Bash no pasan por acá. Lo cubren la revisión del PR y la
  prueba de fronteras de importación (`pruebas/fronteras`, en CI y en el pre-commit).
- **Secciones de un archivo.** El gancho distingue archivos, no partes.
- **Quién fija la zona.** El gancho no decide: la fija quien lanza al agente.

## Cómo se registra

`.claude/settings.json`:

```json
{ "hooks": { "PreToolUse": [ { "matcher": "Edit|Write|MultiEdit",
  "hooks": [ { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/zona-de-escritura.sh" } ] } ] } }
```

Claude Code ejecuta el gancho desde la copia principal (`CLAUDE_PROJECT_DIR`): un cambio del gancho rige
para los agentes recién cuando la copia principal se pone al día con `main`. Antes de lanzar agentes
con zona, la coordinadora lo comprueba con un intento fuera de zona.

## Cómo se prueba

`.claude/hooks/probar-zona-de-escritura.sh` arma un proyecto de mentira en un directorio temporal e
invoca el gancho como lo invoca Claude Code con 17 casos: sin zona, fuera, dentro, archivo nuevo, otra
herramienta, archivo exacto y parecido, ruta relativa, `..`, prefijo demasiado amplio, JSON inválido,
escritura de `.claude/zona`, zona por archivo en un worktree (afuera, adentro, hacia la copia
principal, archivo vacío) y que `.claude/zona` está ignorado por git. Sale con 1 si un caso falla.

### Prueba manual sobre el repositorio real (T0, 05/11/2026)

Con la zona del agente `metodo` (`docs/:.claude/:CLAUDE.md:pruebas/fronteras/:scripts/zonas.mjs`) y
`CLAUDE_PROJECT_DIR` apuntando al worktree:

```
--- intento fuera de la zona: paquetes/nucleo/src/index.ts
{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
 "permissionDecisionReason": "Zona de escritura: «paquetes/nucleo/src/index.ts» esta fuera de la zona de
 este agente (docs/:.claude/:CLAUDE.md:pruebas/fronteras/:scripts/zonas.mjs). Cada agente escribe solo en
 su carpeta (docs/arquitectura/zonas.md); si el cambio corresponde a otra zona, se anota en el PR y lo
 hace el agente dueño. La zona la fija NOVUTIENDA_ZONA o el archivo .claude/zona."}}
--- intento dentro de la zona: docs/arquitectura/zonas.md
(salida vacía = permitido)
--- sin zona definida: paquetes/nucleo/src/index.ts
(salida vacía = el gancho no opina)
```

La batería automática dio 17/17 el mismo día.
