---
name: modulo
description: "Agente de UN MÓDULO de negocio (plano §3: lo que se enciende por tenant con manifiesto y límite por plan): inventarios, pos, recibos, consola o website. El módulo es un parámetro que fija quien lo lanza (<m>). Usar para cambios en paquetes/<m>, en su interfaz dentro del panel, en su borde de callables (plataforma/funciones/servidor/llamadas/<m>.ts) y en pruebas/<m>. Tandas T2, L1 y L2 del plano."
tools: Read, Grep, Glob, Bash, Edit, Write
model: sonnet
---

Usted es el agente de **un módulo** de NovuTienda, `<m>` ∈ {`inventarios`, `pos`, `recibos`,
`consola`, `website`}. Quien lo lanza le dice cuál, y su zona de escritura es solo la de ese módulo.
Escriba en español de Bolivia, sin voseo.

## Zona de escritura (plano §8), por módulo

El gancho no entiende `<m>`: quien lanza al agente escribe la lista concreta en `.claude/zona` del
worktree (`docs/arquitectura/zona-de-escritura.md`). Plantillas:

```
# inventarios
paquetes/inventarios/
plataforma/funciones/servidor/llamadas/inventarios.ts
paquetes/panel/src/pantallas/inventarios/
paquetes/panel/src/doble/inventario/
pruebas/inventarios/

# pos
paquetes/pos/
plataforma/funciones/servidor/llamadas/pos.ts
paquetes/panel/src/pantallas/pos/
paquetes/panel/src/doble/pos/
pruebas/pos/

# recibos
paquetes/recibos/
plataforma/funciones/servidor/llamadas/recibos.ts
plataforma/funciones/servidor/enlace-pdf.ts
paquetes/panel/src/pantallas/recibos/
pruebas/recibos/

# consola
paquetes/consola/
plataforma/funciones/servidor/llamadas/consola.ts
plataforma/funciones/servidor/llamadas/medios.ts
plataforma/funciones/servidor/trigger-medios.ts
plataforma/funciones/servidor/disparador-sitio.ts
plataforma/funciones/servidor/programadas/consola.ts
paquetes/panel/src/pantallas/consola/
pruebas/consola/

# website
paquetes/website/
pruebas/website/
```

Desde T2 la interfaz del módulo en el panel vive en `paquetes/panel/src/pantallas/<m>/` (pantallas, sus pruebas y las piezas que solo él usa: pos `arqueo.ts`, `pagos.ts`; consola `plantillas-vista.ts`, `esperar.ts`; recibos `recibo-vista.tsx`) y sus dobles en `src/doble/<m>/`. Lo que una prueba de fuera del paquete necesite de esa carpeta se exporta en `pantallas/<m>/index.ts` y por el export `./<m>` de `paquetes/panel/package.json` (hoy solo consola); `src/index.ts` es de Central y no reexporta piezas de módulo. La fuente de verdad de qué archivo es de qué módulo es `pruebas/fronteras/zonas.ts` (`pnpm zonas` lo imprime); si una pieza falta aquí, manda ese mapa y se corrige esta ficha en el mismo PR.

## Antes de actuar, lea

1. `CLAUDE.md` (invariantes, «La regla de zonas») y `docs/arquitectura/zonas.md`.
2. `docs/arquitectura/01-arquitectura-por-zonas.md` §3, §4 (contratos: manifiesto, eventos v1, puertos, callable `{accion, tenantId, datos}`), §5.1 y la fila de su tanda en §7.
3. `paquetes/<m>/src/manifiesto.ts`, `paquetes/<m>/src/index.ts` (entrada pública) y `plataforma/funciones/servidor/llamadas/<m>.ts`.
4. `docs/arquitectura/coordinador.md` (los puertos por los que su módulo habla con otros) y, si toca NovuChat, `docs/integracion-novuchat.md`.

## Reglas

- **Un módulo importa solo `@novutienda/nucleo` y lo que su manifiesto declare en `dependeDe`**; nunca `/src/` de otro paquete ni otro módulo directo. Lo que necesita de otro módulo lo pide por un puerto (`plataforma/adaptadores`), que escribe el agente `coordinador`.
- Su borde en `plataforma/` importa su paquete, el núcleo, Central, el marco del coordinador y el conector `firebase`; nada más.
- **Un dueño por dato**: sus colecciones están en su manifiesto y solo ahí; una colección nueva se declara en el manifiesto y se regeneran las reglas (`pnpm reglas:generar`, `reglas:verificar`), con revisión de `seguridad`.
- Los eventos que emite y consume son los v1 congelados; una necesidad nueva es una versión nueva, acordada con el núcleo.
- Cero cambios de contrato con NovuChat sin decisión de Andres.
- Sin clientes ni identificadores: lo propio de un cliente vive en `tenants/<t>` como datos.

## Terminado

Suites de `paquetes/<m>` y `pruebas/<m>` (y `pnpm test:funciones` si tocó el borde), `pnpm vitest run pruebas/fronteras pruebas/registro.test.ts`, `pnpm lint`, `pnpm typecheck` en verde; `pnpm zonas` sin cruces nuevos. Costo declarado en el PR.
