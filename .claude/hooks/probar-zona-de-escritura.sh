#!/usr/bin/env bash
# Prueba del gancho zona-de-escritura.sh: lo invoca como lo invoca Claude Code
# (JSON por stdin, CLAUDE_PROJECT_DIR) sobre un proyecto de mentira en un
# directorio temporal. Sale con 1 si un caso falla. Casos: sin zona (no opina),
# fuera de la zona (deny), dentro (nada), otra herramienta (nada), archivo nuevo
# dentro de carpeta permitida (nada), «..» que escapa (deny), prefijo
# demasiado amplio (deny), `.claude/zona` del worktree sin variable (deny
# afuera, nada adentro), y `.claude/zona` versionado (debe estar ignorado).
set -uo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
GANCHO="$AQUI/zona-de-escritura.sh"
RAIZ_REPO="$(cd "$AQUI/../.." && pwd -P)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PROY="$TMP/proyecto"
mkdir -p "$PROY/.git" "$PROY/docs" "$PROY/paquetes/nucleo/src" "$PROY/.claude"
: > "$PROY/docs/a.md"
: > "$PROY/paquetes/nucleo/src/index.ts"

fallos=0
caso() { # caso <nombre> <esperado: deny|nada> <salida>
  local nombre="$1" esperado="$2" salida="$3"
  local obtenido="nada"
  [[ "$salida" == *'"permissionDecision": "deny"'* ]] && obtenido="deny"
  if [[ "$obtenido" == "$esperado" ]]; then
    printf 'ok    %-58s %s\n' "$nombre" "$obtenido"
  else
    printf 'FALLA %-58s esperado %s, obtenido %s\n  %s\n' "$nombre" "$esperado" "$obtenido" "$salida"
    fallos=$((fallos + 1))
  fi
}
evento() { # evento <tool> <file_path> [cwd]
  printf '{"tool_name": "%s", "tool_input": {"file_path": "%s"}, "cwd": "%s"}' "$1" "$2" "${3:-$PROY}"
}
correr() { # correr <zona-env> <evento-json>
  printf '%s' "$2" | NOVUTIENDA_ZONA="$1" CLAUDE_PROJECT_DIR="$PROY" bash "$GANCHO" 2>&1
}

caso "sin zona: no opina" nada "$(correr "" "$(evento Write "$PROY/paquetes/nucleo/src/index.ts")")"
caso "fuera de la zona (docs/ → paquetes/nucleo): deny" deny "$(correr "docs/" "$(evento Edit "$PROY/paquetes/nucleo/src/index.ts")")"
caso "dentro de la zona (docs/a.md): nada" nada "$(correr "docs/" "$(evento Edit "$PROY/docs/a.md")")"
caso "archivo nuevo dentro de la zona: nada" nada "$(correr "docs/" "$(evento Write "$PROY/docs/nuevo/b.md")")"
caso "otra herramienta (Bash) con zona: nada" nada "$(correr "docs/" "$(evento Bash "$PROY/paquetes/nucleo/src/index.ts")")"
caso "archivo exacto permitido (CLAUDE.md): nada" nada "$(correr "docs/:CLAUDE.md" "$(evento Write "$PROY/CLAUDE.md")")"
caso "archivo parecido no permitido (CLAUDE.md.bak): deny" deny "$(correr "docs/:CLAUDE.md" "$(evento Write "$PROY/CLAUDE.md.bak")")"
caso "ruta relativa fuera, juzgada contra el cwd: deny" deny "$(correr "docs/" "$(evento Write "paquetes/nucleo/src/x.ts")")"
caso "«..» que escapa de la zona: deny" deny "$(correr "docs/" "$(evento Write "$PROY/docs/../paquetes/nucleo/src/x.ts")")"
caso "prefijo demasiado amplio (./): deny" deny "$(correr "./" "$(evento Write "$PROY/docs/a.md")")"
caso "evento que no es JSON con zona: deny" deny "$(printf 'no-json' | NOVUTIENDA_ZONA="docs/" CLAUDE_PROJECT_DIR="$PROY" bash "$GANCHO" 2>&1)"
caso "escribir .claude/zona con zona activa: deny" deny "$(correr "docs/:.claude/" "$(evento Write "$PROY/.claude/zona")")"

# Zona por archivo `.claude/zona` en el worktree del agente, sin variable.
WT="$PROY/.claude/worktrees/agente"
mkdir -p "$WT/.claude" "$WT/docs" "$WT/paquetes/nucleo/src" "$PROY/.git/worktrees/agente"
printf 'gitdir: %s\n' "$PROY/.git/worktrees/agente" > "$WT/.git"
printf '# zona del agente\ndocs/\n' > "$WT/.claude/zona"
caso ".claude/zona del worktree, destino afuera (nucleo): deny" deny "$(correr "" "$(evento Write "$WT/paquetes/nucleo/src/index.ts" "$WT")")"
caso ".claude/zona del worktree, destino adentro (docs/): nada" nada "$(correr "" "$(evento Write "$WT/docs/c.md" "$WT")")"
caso ".claude/zona del worktree, destino en la copia principal: deny" deny "$(correr "" "$(evento Write "$PROY/docs/a.md" "$WT")")"
caso ".claude/zona vacío (solo comentarios): deny" deny "$(printf '# nada\n' > "$WT/.claude/zona"; correr "" "$(evento Write "$WT/docs/c.md" "$WT")")"

# El archivo de zona nunca se versiona en este repositorio.
if git -C "$RAIZ_REPO" check-ignore -q .claude/zona; then
  printf 'ok    %-58s %s\n' ".claude/zona está en .gitignore" "ignorado"
else
  printf 'FALLA %-58s\n' ".claude/zona NO está en .gitignore"; fallos=$((fallos + 1))
fi

echo
if [[ $fallos -eq 0 ]]; then echo "Todos los casos pasaron."; else echo "$fallos caso(s) fallaron."; exit 1; fi
