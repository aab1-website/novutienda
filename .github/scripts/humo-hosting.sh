#!/usr/bin/env bash
# humo-hosting.sh — humo post-despliegue de los dos sitios de Hosting.
# Uso: humo-hosting.sh <URL_SITIO> <URL_PANEL> [RUTA_SALUD]
#   - Sitio: RUTA_SALUD (por defecto /healthz) responde 200 «ok» desde la función
#     api (prueba que Functions y el rewrite de Hosting están vivos), y / responde
#     200 con CSP y HSTS.
#   - Panel: / responde 200 con CSP y HSTS.
# 10 intentos cada 15 s por comprobación (propagación del despliegue).
set -uo pipefail

URL_SITIO="${1:?URL del sitio}"
URL_PANEL="${2:?URL del panel}"
RUTA_SALUD="${3:-/healthz}"
INTENTOS="${HUMO_INTENTOS:-10}"
ESPERA="${HUMO_ESPERA:-15}"

comprobar() { # descripcion url cuerpo_esperado(opcional) exigir_cabeceras(si|no)
  local desc="$1" url="$2" esperado="$3" cabeceras="$4" i codigo cuerpo encabezados
  for ((i = 1; i <= INTENTOS; i++)); do
    encabezados="$(mktemp)"
    cuerpo="$(curl -sS --max-time 15 -D "$encabezados" -o - -w '\n%{http_code}' "$url" 2>/dev/null || printf '\n000')"
    codigo="${cuerpo##*$'\n'}"
    cuerpo="${cuerpo%$'\n'*}"
    if [[ "$codigo" == "200" ]] \
      && { [[ -z "$esperado" ]] || [[ "$(printf '%s' "$cuerpo" | tr -d '[:space:]')" == "$esperado" ]]; } \
      && { [[ "$cabeceras" == "no" ]] || { grep -qi '^content-security-policy:' "$encabezados" && grep -qi '^strict-transport-security:' "$encabezados"; }; }; then
      rm -f "$encabezados"
      echo "OK  $desc ($url, intento $i)"
      return 0
    fi
    rm -f "$encabezados"
    echo "…   $desc: HTTP $codigo (intento $i/$INTENTOS)"
    sleep "$ESPERA"
  done
  echo "::error::Humo fallido: $desc ($url)"
  return 1
}

fallos=0
comprobar "salud del sitio (función api)" "${URL_SITIO%/}${RUTA_SALUD}" "ok" no || fallos=$((fallos + 1))
comprobar "portada del sitio con CSP y HSTS" "${URL_SITIO%/}/" "" si || fallos=$((fallos + 1))
comprobar "panel con CSP y HSTS" "${URL_PANEL%/}/" "" si || fallos=$((fallos + 1))
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  echo "### Humo post-despliegue: $((3 - fallos))/3 comprobaciones correctas" >>"$GITHUB_STEP_SUMMARY"
fi
exit $((fallos > 0))
