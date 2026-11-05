# Zonas: carpeta = zona, y cómo se declara la zona de un archivo

> Regla viva de la arquitectura por zonas (plano `01-arquitectura-por-zonas.md` §3, §5 y §9). Este
> documento guarda la regla y cómo se aplica; **las cifras las imprime `pnpm zonas`**, nunca se copian
> aquí. Sin secretos ni identificadores.

## Las cinco zonas y la prueba de ubicación

| Zona | Qué es | Quién la cambia |
|---|---|---|
| **Núcleo** | Lo que todo tenant corre igual aunque nadie lo vea: registro, identidad y roles, límites por plan, auditoría, eventos, tipo de cambio, redondeo, límite de tasa | Solo NovuTienda; cada cambio llega a todos |
| **Central** | Lo que todo comercio ve igual en su panel y su cuenta, tenga los módulos que tenga: sesión, login, menú, usuarios y roles, configuración, transporte de callables, App Check | NovuTienda |
| **Plataforma** | Lo que ve solo el operador de NovuTienda: alta de tenant, planes, propietario, tokens de integraciones, andamiaje de build y despliegue | NovuTienda |
| **Módulos** | Lo que se enciende por tenant con manifiesto y límite por plan: inventarios, pos, recibos, consola, website | NovuTienda, un módulo a la vez, con versión |
| **Tenants** | Datos y configuración **declarativa** de un cliente, validada por tipos del núcleo. Nunca lógica | El comercio desde el panel; NovuTienda desde Plataforma |

Más tres piezas con nombre propio: el **registro** (`plataforma/registro.ts`, el único lugar que enumera los módulos), el **coordinador** (`plataforma/adaptadores`: puertos módulo↔módulo y bandeja; `plataforma/funciones/servidor/{index,entorno,config,origen,serializar,bus}.ts`, `llamadas/marco.ts`: composición y borde de ejecución; ver `coordinador.md`) y los **conectores** (`adaptadores/firebase/*`, `http/novuchat.ts`, `http/sitio.ts`).

**Prueba de ubicación** (en orden; la primera que dice «sí» decide; dos «sí» = pieza mal cortada, se parte):

1. ¿Lo corre todo tenant igual aunque no lo vea nadie? → Núcleo.
2. ¿Lo ve todo comercio en su panel o su cuenta, tenga los módulos que tenga? → Central.
3. ¿Lo ve solo NovuTienda como operador? → Plataforma.
4. ¿Se enciende o apaga por tenant, o tiene límite por plan? → Módulo.
5. ¿Es dato de un cliente? → Tenant.
6. ¿Conecta dos zonas, coordina varias o habla con un sistema externo? → Coordinador o conector, nombrado.

**Dependencias permitidas:** Módulos → Central → Núcleo; Plataforma → Central, Núcleo; un módulo → otro solo si su manifiesto lo declara (`dependeDe`); Núcleo → nada de arriba; Tenants = datos. El coordinador conoce a todas, solo a través del registro y de los puertos. Los conectores dependen de la zona a la que sirven, nunca al revés.

## Carpeta = zona: dónde vive cada zona hoy

| Zona | Carpetas y archivos |
|---|---|
| `nucleo` | `paquetes/nucleo/`; en ejecución, `plataforma/funciones/servidor/{redondeo,notificador}.ts` (y `programadas/cotizacion.ts` desde T1) |
| `central` | `paquetes/panel/` salvo las piezas de módulo; `plataforma/funciones/servidor/llamadas/usuarios.ts` (desde T1) |
| `plataforma` | `scripts/` (salvo `zonas.mjs`), `plataforma/funciones/scripts/` |
| `modulo:<m>` | `paquetes/<m>/`; su borde `plataforma/funciones/servidor/llamadas/<m>.ts` (consola incluye `llamadas/medios.ts`, `trigger-medios.ts`, `disparador-sitio.ts`; recibos incluye `enlace-pdf.ts`); su interfaz en el panel: pos `pantallas/{venta*,supervision,aprobaciones}.tsx`, `util/{arqueo,pagos}.ts`; inventarios `pantallas/{inventario*,mermas}.tsx`; consola `pantallas/catalogo*.tsx`, `subidas/`, `util/plantillas-vista.ts`; recibos `pantallas/recibos.tsx`, `ui/recibo.tsx`; desde T2, `pantallas/<m>/` |
| `coordinador` | `plataforma/registro.ts`, `plataforma/adaptadores/*.ts`, el resto de `plataforma/funciones/servidor/` (incluido `programadas.ts` hasta que T1 lo parta) |
| `conector:<n>` | `conector:firebase` = `plataforma/adaptadores/firebase/`; `conector:novuchat` = `http/novuchat.ts`; `conector:sitio` = `http/sitio.ts` |
| `tenant` | `tenants/` |
| `pruebas:<zona>` | `pruebas/{funciones,integracion}/` y `pruebas/registro.test.ts` → coordinador; `pruebas/panel/` → central; `pruebas/<m>/` → `modulo:<m>`; `pruebas/{identidad,limites,tipo-cambio,reglas,tenant}/` → núcleo; un `*.test.ts` dentro de un paquete → la zona del archivo que prueba; los dobles del panel (`src/doble/`, `ayuda-pruebas.ts`) → pruebas de su zona |
| `metodo` | `pruebas/fronteras/`, `scripts/zonas.mjs` |

La fuente de verdad de esta tabla es **`pruebas/fronteras/zonas.ts`** (`ZONA_POR_ARCHIVO`): esta tabla la resume; si difieren, manda el mapa y se corrige el documento.

## La regla de frontera por archivo

`pruebas/fronteras/fronteras.test.ts` corre en CI y en el pre-commit, y falla si:

1. **Un archivo de código no tiene zona** (`.ts`, `.tsx`, `.mts`, `.astro`, `.mjs` en `paquetes/`, `plataforma/`, `pruebas/`, `tenants/`, `scripts/`).
2. **Una importación cruza una frontera no permitida** y no está en `pruebas/fronteras/deuda.json`.
3. **Una entrada de `deuda.json` ya no es un cruce real** (hay que quitarla: la deuda solo baja).

Reglas de importación por zona declarada (plano §3), con las aproximaciones que la prueba aplica:

| Zona del archivo | Puede importar | Aproximación |
|---|---|---|
| `nucleo` | solo `nucleo` | — |
| `central` | `nucleo`, `coordinador` | piezas de módulo solo desde el compositor `paquetes/panel/src/ui/app.tsx`, hasta que el registro aporte las pantallas (L2) |
| `plataforma` | `nucleo`, `central`, `coordinador` | el coordinador entra por `plataforma/registro.ts` |
| `modulo:<m>` | `modulo:<m>`, `nucleo`, `central`, `coordinador`, `conector:firebase`, y `modulo:<d>` si `dependeDe` lo declara | el borde en `plataforma/` necesita el marco (coordinador) y el `Bucket` (firebase) |
| `coordinador` | todo | un **paquete** de módulo (`@novutienda/<m>`) solo desde un compositor (`registro.ts`, `adaptadores/*.ts`, `servidor/entorno.ts`); un **archivo** de borde de módulo que vive en `plataforma/` siempre, porque existe para que el coordinador lo monte |
| `conector:<n>` | `nucleo`, `coordinador` y las zonas a las que sirve | `firebase` sirve a todas; `novuchat` a inventarios y consola; `sitio` a consola |
| `pruebas:<z>` | lo que importa `z`, más cualquier `pruebas:*` (dobles), `plataforma`, `coordinador` y conectores | `pruebas:coordinador` y `pruebas:central` importan además módulos |
| `tenant` | `@novutienda/nucleo/extension` | lo exige también `verificador.ts` |
| `metodo` | todo | sus pruebas contienen árboles inventados |

Además sigue vigente el verificador anterior sobre `paquetes/` y `tenants/` (`verificador.ts`: ningún módulo importa a otro salvo `dependeDe`, nada a `/src/`, nadie a un tenant) y ESLint como segunda red.

## La deuda: `pruebas/fronteras/deuda.json`

Lista los cruces heredados con `archivo`, `importacion`, `zona`, `destino`, `resuelveEn` (la tanda del plano que lo elimina) y una nota. **Nadie agrega un cruce nuevo a la deuda**: un cruce nuevo se corrige, o se replantea la zona del archivo en `zonas.ts` con su justificación, y eso lo decide la sesión principal con el agente `metodo`. Cuando una tanda elimina un cruce, quita su entrada en el mismo PR (si no, la prueba falla).

`pnpm zonas` imprime los cruces vigentes marcando cuáles están en deuda y cuáles son nuevos, y las entradas ya resueltas que hay que quitar.

## Cómo declarar la zona de un archivo nuevo

1. Responder la prueba de ubicación. Si dos preguntas dicen «sí», partir el archivo antes de crearlo.
2. Ponerlo en la carpeta de su zona (tabla de arriba). En `paquetes/<m>/`, `paquetes/nucleo/`, `pruebas/<x>/`, `tenants/`, `scripts/` la zona ya está dada por la carpeta y no hay que hacer nada más.
3. Si va a `plataforma/funciones/servidor/` o a `paquetes/panel/src/` y **no es** coordinador ni Central, agregar su patrón en `ZONA_POR_ARCHIVO` (`pruebas/fronteras/zonas.ts`) **antes** del patrón general de su carpeta, con una `nota` si hace falta explicar; lo hace el agente `metodo` o la sesión principal.
4. Correr `pnpm zonas` (el archivo aparece en su zona y sin cruces) y `pnpm vitest run pruebas/fronteras`.
5. Si el archivo necesita importar algo que su zona no permite, la respuesta no es un cruce: es un puerto (`plataforma/adaptadores`, agente `coordinador`), una dependencia declarada en el manifiesto, o mover la pieza al núcleo con reexportación transitoria.

## Comandos

| Qué | Comando |
|---|---|
| Inventario pieza → zona, archivos sin zona y cruces | `pnpm zonas` (o `pnpm zonas -- --json`) |
| La compuerta (CI y pre-commit) | `pnpm vitest run pruebas/fronteras` |
| Frontera más registro de módulos | `pnpm vitest run pruebas/fronteras pruebas/registro.test.ts` |
| Pre-commit local (incluye la frontera) | `pre-commit run --all-files` (instalación: `pipx install pre-commit && pre-commit install --install-hooks`) |

## Cómo se sostiene (plano §9)

Carpeta = zona; `fronteras.test.ts` en CI y pre-commit sobre todo el repositorio con `deuda.json` que solo baja; gancho de zona de escritura por agente (`zona-de-escritura.md`); `scripts/zonas.mjs` como estado generado; el manifiesto declara todo lo que un módulo aporta y `registro.test.ts` lo exige; `CODEOWNERS` por zona.
