# NovuTienda: arquitectura por zonas (plano, 05/11/2026)

> Documento **para que Andres lo revise antes de ejecutar** (fase F0). Aplica el método con que se planificó la arquitectura de
> NovuChat (`~/NovuChat/Analisis/41-arquitectura-por-capas.md`, leído en modo lectura; método descrito por su sesión de
> rearquitectura el 05/11/2026) como **auditoría de brechas**: NovuTienda ya nació con registro de módulos, reglas generadas y
> frontera de importaciones, así que el plano no reconstruye, corrige lo que la prueba de ubicación muestra mal cortado y
> agrega lo que falta del método. Las zonas de NovuChat no son las de NovuTienda: se derivan aquí. Sin secretos ni identificadores.
> Documento vivo: las enmiendas se agregan fechadas en §6.

## 0. Conclusión

| | |
|---|---|
| **El diagnóstico** | El código está ordenado por **paquete** (`nucleo`, 6 módulos, `plataforma/`) y eso ya coincide en gran parte con «quién es dueño de cada pieza y cuánto varía». Lo que no coincide: el **panel** es a la vez lo que todo comercio ve (sesión, login, usuarios, configuración) y la interfaz de cuatro módulos; la gestión de usuarios y el acceso del propietario viven dentro del callable de un módulo (`consola`); las programadas mezclan núcleo, módulo y operador; seis colecciones se escriben fuera de todo manifiesto; y el «encendido por tenant» existe en el dato (`Tenant.modulos`) pero nadie lo consulta |
| **Lo que ya cumple** | Registro de módulos (`plataforma/registro.ts`) del que se genera `firestore.rules` y se verifica con matriz negativa y mutantes; 7 manifiestos; `fronteras.test.ts` (ningún módulo importa a otro, todos solo al núcleo) y ESLint como segunda red; límites por plan transaccionales; contratos de eventos v1 congelados; lectura solo por callables; CI del estándar en verde (PR 1: 1.149 pruebas, reglas 17/17, funciones 123/123, CodeQL 0) |
| **Las cinco zonas** | **Núcleo** (lo que todo tenant corre igual), **Central** (lo que todo comercio ve igual en su panel y su cuenta), **Plataforma** (lo que ve solo el operador de NovuTienda), **Módulos** (lo que se enciende por tenant con manifiesto), **Tenants** (datos, nunca código). Más tres piezas con nombre: el **registro de módulos**, el **coordinador** (`plataforma/adaptadores` + composición de `plataforma/funciones`) y los **conectores** externos (NovuChat, reconstrucción del sitio, Firebase, bancos) |
| **La unidad** | El **manifiesto de módulo**, que hoy declara colecciones, límite, eventos que emite y consume; le faltan `zona`, pantallas, acciones de callable y programadas (§3) |
| **Cómo se hace cumplir** | Carpeta = zona; `fronteras.test.ts` ampliado a `plataforma/` y `pruebas/`; gancho de zona de escritura por agente; agentes por zona; medición de zonas generada, no escrita |
| **El camino** | Una tanda cero sin mover archivos (docs, agentes, gancho, medición) y cuatro tandas de movimiento **sin cambiar lógica**, más dos fases de lógica (colecciones con dueño; encendido por tenant). Unas 6 jornadas. Nada de esto bloquea el pase a staging ni a producción de Casa Bermejo |
| **Costo** | 0 USD de nube; CI por PR; cero cambios de contrato con NovuChat |

## 1. Relevamiento con números (05/11/2026, `main` en 3f05821)

| Pieza | Archivos | Líneas |
|---|---|---|
| `paquetes/nucleo` | 47 | 3.558 |
| `paquetes/inventarios` / `pos` / `recibos` | 18 / 17 / 11 | 2.589 / 1.941 / 792 |
| `paquetes/consola` / `website` | 26 / 93 | 2.696 / 5.751 |
| `paquetes/panel` | 75 | 9.837 |
| `plataforma/adaptadores` / `plataforma/funciones` | 21 / 24 | 1.209 / 2.352 |
| `pruebas/` | 77 | 10.862 |
| `tenants/casa-bermejo` | 0 (solo `config.json`) | — |

83 suites; 11 Functions exportadas (5 callables, `api`, `eventos`, `subidaFinalizada`, 3 programadas); `firestore.rules` 215 líneas (generadas); `storage.rules` 57 (a mano); 7 manifiestos; 8 páginas del sitio; 17 pantallas del panel. Lección de NovuChat: estas cifras caducan; la fuente viva será `scripts/zonas.mjs` (tanda 0), y este documento solo guarda decisiones.

## 2. Diagnóstico

El sistema se ordenó por **paquete funcional** (qué hace cada pieza). La arquitectura pedida ordena por **dueño y variabilidad**. Coinciden en el núcleo y en los cuatro módulos de negocio; divergen en tres lugares: el panel (una pieza central que contiene la interfaz de cuatro módulos), `plataforma/funciones` (borde de ejecución que mezcla núcleo, módulos y operador en archivos compartidos) y los datos (colecciones sin manifiesto). La dependencia oculta más importante: el panel es Central y depende en ejecución de los cinco callables de los módulos; la regla dice módulos → central → núcleo. Se legitima solo si las pantallas pasan a ser **interfaz del módulo** (§5, pieza 1).

## 3. Las cinco zonas y la prueba de ubicación

| Zona | Definición | Quién la cambia | Hoy en NovuTienda |
|---|---|---|---|
| **Núcleo** | Lo que todo tenant corre igual aunque nadie lo vea: registro, identidad y roles, límites por plan, auditoría, eventos, tipo de cambio, redondeo, límite de tasa | Solo NovuTienda; cada cambio llega a todos | `paquetes/nucleo` (+ `limite-tasa` hoy en `website`, HMAC hoy en `inventarios`) |
| **Central** | Lo que todo comercio ve igual en su panel y su cuenta, tenga los módulos que tenga: sesión, login, menú, usuarios y roles, configuración del negocio, transporte de callables, App Check | NovuTienda | `paquetes/panel/src/{ui,sesion,api,appcheck,subidas,util/menu}`, `pantallas/{usuarios,configuracion}`, acciones de usuarios de `llamadas/consola.ts` |
| **Plataforma** | Lo que ve solo el operador de NovuTienda: alta de tenant, planes, propietario, tokens de integraciones, andamiaje de despliegue | NovuTienda | claim `p`, acciones `propietario: true`, `listarTenants`, `scripts/`, `plataforma/funciones/scripts/` |
| **Módulos** | Lo que se enciende por tenant con manifiesto y límite por plan: inventarios, pos, recibos, consola (catálogo y sitio), website | NovuTienda, un módulo a la vez, con versión | `paquetes/<m>` + su borde en `plataforma/funciones/servidor/llamadas/<m>.ts` + su interfaz en `panel/src/pantallas/*` |
| **Tenants** | Datos y configuración **declarativa** de un cliente: `tenants/{t}/…` en Firestore, `tenants/<t>/config.json` en el repo, `CLIENTES/<T>/` fuera del repo. **Nunca lógica**: la configuración se valida contra los tipos de `paquetes/nucleo/src/extension` (que son del núcleo, no del tenant) | El comercio desde el panel; NovuTienda desde Plataforma | `tenants/casa-bermejo/config.json` (hoy nadie lo lee); `CLAUDE.md` l. 71 se alinea con esta redacción en T0 |

Piezas con nombre propio: **registro** (`plataforma/registro.ts`), **coordinador** (`plataforma/adaptadores`: puertos módulo↔módulo y bus de eventos; `plataforma/funciones/servidor/{index,entorno,marco}`: composición y borde de ejecución) y **conectores** (`adaptadores/firebase/*`, `http/novuchat.ts`, `http/sitio.ts`, parsers BCB/BNA/BCRA).

**Prueba de ubicación** (en orden; la primera que dice «sí» decide; dos «sí» = pieza mal cortada, se parte):
1. ¿Lo corre todo tenant igual aunque no lo vea nadie? → Núcleo.
2. ¿Lo ve todo comercio en su panel o su cuenta, tenga los módulos que tenga? → Central.
3. ¿Lo ve solo NovuTienda como operador? → Plataforma.
4. ¿Se enciende o apaga por tenant, o tiene límite por plan? → Módulo.
5. ¿Es dato de un cliente? → Tenant.
6. ¿Conecta dos zonas, coordina varias o habla con un sistema externo? → Coordinador o conector, nombrado.

**Dependencias permitidas:** Módulos → Central → Núcleo; Plataforma → Central, Núcleo; un módulo → otro solo si su manifiesto lo declara (`dependeDe`); Núcleo → nada de arriba; Tenants = datos. El coordinador conoce a todas, solo a través del registro. Los conectores dependen de la zona a la que sirven, nunca al revés.

**Regla de frontera para `plataforma/` y `pruebas/` (enmienda H0, 05/11/2026).** Hoy `pruebas/fronteras/verificador.ts` solo vigila `paquetes/` y `tenants/`, y en `plataforma/` un cruce es sintácticamente igual a un import legítimo del compositor. Por eso la zona se declara **por archivo**, no se infiere: T0 agrega `pruebas/fronteras/zonas.ts` con un mapa `ZONA_POR_ARCHIVO` (patrones de ruta → zona y, para módulos, el id del módulo) que cubre **todo** archivo de `plataforma/` y `pruebas/`; `fronteras.test.ts` falla si un archivo no tiene zona. Reglas por zona declarada:

| Zona declarada | Puede importar | Ejemplos de archivos |
|---|---|---|
| `coordinador` | todo, pero los módulos solo a través de `plataforma/registro.ts` y de los puertos de `plataforma/adaptadores` | `servidor/{index,entorno,config,origen,serializar,bus}.ts`, `llamadas/marco.ts`, `programadas/tenants.ts`, `adaptadores/*.ts` (puertos y consumidores) |
| `modulo:<m>` (borde) | `@novutienda/nucleo`, `@novutienda/<m>`, Central y los puertos del coordinador | `llamadas/{pos,inventarios,recibos,consola,medios}.ts`, `programadas/consola.ts`, `trigger-medios.ts`, `disparador-sitio.ts`, `enlace-pdf.ts` |
| `central` | núcleo y coordinador | `llamadas/usuarios.ts` |
| `nucleo` (en ejecución) | `@novutienda/nucleo` | `programadas/cotizacion.ts`, `redondeo.ts`, `notificador.ts` |
| `conector:<nombre>` | núcleo y la zona a la que sirve | `http/novuchat.ts` (sirve a inventarios y consola), `http/sitio.ts` (consola), `adaptadores/firebase/*` (infra de todos), parsers de bancos |
| `pruebas:<zona>` | lo mismo que la zona que prueba, más dobles | `pruebas/funciones`, `pruebas/integracion` → coordinador; `pruebas/panel` → central y módulos; `pruebas/<m>` → `modulo:<m>`; `pruebas/{identidad,limites,tipo-cambio,reglas,tenant}` → núcleo; `pruebas/fronteras` → método |

Los cruces heredados se listan en `pruebas/fronteras/deuda.json` (ruta, import, zona violada) y la prueba exige que la lista **solo baje**. Deuda inicial conocida: `limiteMemoria`/`LimiteTasa` importados de `website` (5 archivos, no 1), `verificarFirma` de `inventarios` en `http/sitio.ts`, `ActorPos` de `pos` en `llamadas/marco.ts`.

## 4. Contratos entre zonas (los que hoy son implícitos se escriben)

| Contrato | Estado | Dónde |
|---|---|---|
| Manifiesto de módulo (`colecciones`, `limite`, `emite`, `consume`, `dependeDe`) | existe | `paquetes/nucleo/src/registro/tipos.ts` |
| Eventos v1 (`venta.confirmada`, `venta.anulada`, `turno.cerrado`, `stock.cambiado`, `stock.bajo`, `recibo.emitido`, `pedido.solicitado`, `pedido.confirmado`) | existe, congelado | `paquetes/nucleo/src/eventos/*.v1.ts` |
| Puertos módulo↔módulo (consola→inventarios, pos→inventarios, recibos→db) | existen como código, sin documento | `plataforma/adaptadores/*.ts` → documentar en `docs/arquitectura/coordinador.md` |
| Callable por módulo `{accion, tenantId, datos}` con esquema zod y rol | existe | `llamadas/marco.ts`, `docs/produccion/funciones.md` |
| API externa NovuChat v1 / v1.1 | existe, acordado | `docs/integracion-novuchat.md`, `docs/contratos/propiedades-de-producto-v1.1.md` |
| **Pantallas, acciones y programadas que aporta cada módulo** | **falta**: hoy el menú filtra por rol, no por módulo | campos nuevos del manifiesto: `zona`, `pantallas[]`, `acciones[]`, `programadas[]` |
| **Encendido por tenant** (`Tenant.modulos`) | existe el dato, no el uso | el marco de callables y el menú del panel consultan `modulos` del tenant |

## 5. Inventario: pieza → zona → destino (resumen; el detalle lo da `scripts/zonas.mjs`)

Piezas que responden «sí» a dos preguntas y su partición:
1. **`paquetes/panel`** (Central + interfaz de 4 módulos): `src/pantallas/<modulo>/` por módulo (pos: `venta*`, `supervision`, `aprobaciones`; inventarios: `inventario*`, `mermas`; consola: `catalogo*`; recibos: `recibos`), **y también** las piezas de módulo fuera de `pantallas/` (enmienda H0): `src/subidas/` (consola), `ui/recibo.tsx` (recibos), `util/{arqueo,pagos}.ts` (pos), `util/plantillas-vista.ts` (consola), `doble/{pos,inventario}.ts` (dobles de módulo, a `pruebas/`) y la parte por módulo de `api/real.ts` (se parte por módulo o se deja como transporte central con una tabla por módulo). Lo demás queda Central. Primero solo carpetas; que el registro aporte las pantallas es lógica (fase L2).
2. **`llamadas/consola.ts` → acciones de usuarios** (`listarUsuarios`, `buscarUsuarioPorCorreo`, `asignarRol`, `quitarRol`; Central + Plataforma dentro de un callable de módulo): a `llamadas/usuarios.ts`, compuesto en `index.ts` para no cambiar el contrato del panel.
3. **`programadas.ts`** (Núcleo + Consola + coordinador): `programadas/cotizacion.ts` (núcleo), `programadas/consola.ts` (módulo), `programadas/tenants.ts` (`listarTenants`, `porTenant`: recorre tenants para ejecutar lo de cada zona → **coordinador**, no Plataforma; enmienda H0).
4. **`adaptadores/bandeja-memoria.ts`** (coordinador de producción + doble de pruebas): `consumidores.ts` y `pruebas/integracion/bandeja-memoria.ts`.
5. **`website/src/api/limite-tasa.ts`** y **`verificarFirma` de inventarios** (núcleo dentro de módulos, usados por conectores): al núcleo, con reexportación transitoria.
6. **Datos sin dueño**: `alertas` (→ núcleo), `reconstrucciones` (→ consola), `novuchatTokens` y `limitesTasa` (→ manifiesto de plataforma/conectores, que no existe), rutas de Storage `privado/` y `publico/` (→ `storage.rules` generado). Es lógica: regenera reglas (fase L1).

Cruces de importación hoy: `limiteMemoria`/`LimiteTasa` de `website` en 5 archivos de `plataforma/` (entre ellos `funciones/index.ts`); `http/sitio.ts` importa `verificarFirma` de `inventarios`; `llamadas/marco.ts` tipa con `ActorPos` de `pos`. `fronteras.test.ts` no los ve porque solo vigila `paquetes/` y `tenants/` (§3, regla de frontera).

Piezas de `plataforma/funciones/servidor/` sin zona en la primera versión (enmienda H0), ahora asignadas: `llamadas/medios.ts` y `trigger-medios.ts` → `modulo:consola`; `enlace-pdf.ts` → `modulo:recibos`; `disparador-sitio.ts` → `modulo:consola`; `redondeo.ts` y `notificador.ts` → núcleo; `bus.ts`, `config.ts`, `origen.ts`, `serializar.ts`, `entorno.ts`, `index.ts`, `llamadas/marco.ts` → coordinador. El inventario completo por archivo lo genera `scripts/zonas.mjs` en T0 a partir de `ZONA_POR_ARCHIVO`, y la revisora lo comprueba en H1 antes de T1: ningún archivo sin zona.

Zona sin nombre: `scripts/`, `plataforma/funciones/scripts/`, `deploy.sh`, `security-local.sh` son Plataforma (andamiaje del operador). `CODEOWNERS` es la plantilla del estándar y no refleja las carpetas reales.

## 6. Decisiones por estatus

### 6.1 Ya tomadas por Andres (no se tocan)
Opción A (un proyecto Firebase, `tenants/{t}`); repo público modo A; alcance = PDF + Anexo A; 3 roles; panel único separado de la consola de NovuChat; lectura solo por callables; us-east1; esquema común de propiedades con NovuChat (C′), capacidad apagada para Casa Bermejo.

### 6.2 Recomendadas por este plano (vigentes salvo que Andres diga otra cosa)
1. Cinco zonas con **Central y Plataforma explícitas**, sin mover paquetes de primer nivel: la zona se expresa con `zona` en el manifiesto, subcarpetas y `CODEOWNERS`, no con una mudanza de `pnpm-workspace`, ESLint, vitest, tsconfig, firebase.json y CI (tanda 5 descartada ahora).
2. Los bordes de módulo que viven en `plataforma/funciones/servidor/llamadas/<m>.ts` se quedan ahí (dependen de `firebase-functions`/`zod`) y se declaran del módulo por `CODEOWNERS` y manifiesto.
3. **Mover sin cambiar lógica** en PR separados de los de lógica; squash; un PR por tanda.
4. Las tres cosas del método que faltan se hacen **primero** (tanda 0): docs por zona, agentes por zona con gancho de escritura, medición generada.
5. Encendido por tenant en runtime (fase L2) antes del segundo tenant, no antes.

### 6.3 Decididas por Andres el 05/11/2026 (botones)
1. Adoptar las cinco zonas y la prueba de ubicación como regla de `CLAUDE.md`: **sí**.
2. Cuándo ejecutar las tandas: **después del primer despliegue a staging**.
3. Quién comprueba cada hito: **sesión revisora separada** (iniciada el 05/11; H0 = este documento, APROBADO CON OBSERVACIONES, incorporadas como enmiendas marcadas «H0»).
4. Fase L2 (encendido por tenant y pantallas desde el registro): **antes del segundo tenant**, no antes (recomendación 6.2.5 aceptada por omisión; se confirma con botón al cerrar H2).

### 6.4 Enmiendas de la revisión H0 (05/11/2026)
- Código en tenants: `tenants/<t>/` lleva datos y configuración declarativa validada por tipos del núcleo (`nucleo/extension`); nunca lógica. `CLAUDE.md` l. 71 se reescribe así en T0.
- `listarTenants`/`porTenant` son coordinador, no Plataforma.
- Son cuatro acciones de usuarios (incluye `listarUsuarios`).
- `LimiteTasa` se importa de `website` en 5 archivos.
- Quién autoriza cada fusión: **Andres, con un botón por PR**; la aprobación en GitHub la ejecuta Claude como `segurolotengopy` con constancia; la revisora comprueba el hito, no el PR.
- `fronteras.test.ts` entra también al pre-commit en T0; `ESTADO.md` se actualiza o se retira en T0 (el estado vivo pasa a `scripts/zonas.mjs`).

## 7. Camino, por tandas y fases

| # | Qué | Prueba | Despliega | Jornadas |
|---|---|---|---|---|
| **T0** | Sin mover archivos: `pruebas/fronteras/zonas.ts` (`ZONA_POR_ARCHIVO`, §3) y `deuda.json`; `docs/arquitectura/{zonas,coordinador}.md`; `CODEOWNERS` real; `scripts/zonas.mjs` (tabla pieza→zona completa y cruces, solo lectura); agentes por zona en `.claude/agents/` (`nucleo`, `central`, `plataforma`, `modulo`, `coordinador`, `metodo`, `planificador`, `implementador`, `revisor-codigo`) y gancho de zona de escritura probado con un intento fuera de carpeta; `CLAUDE.md` con la regla de zonas, sin cifras; pre-commit con fronteras; `ESTADO.md` actualizado o retirado | `fronteras.test.ts` ampliado a `plataforma/` y `pruebas/` con zona por archivo y deuda que solo baja; ningún archivo sin zona | no | 1,5 |
| **T1** | Partir `programadas.ts` y sacar las acciones de usuarios de `llamadas/consola.ts` | funciones 123/123 sin tocar casos | no | 0,5 |
| **T2** | `panel/src/pantallas/<modulo>/` | build del panel, pruebas del panel | no | 0,5 |
| **T3** | `bandeja-memoria` → `consumidores` + doble en pruebas; renombrar `plataforma/adaptadores` → `plataforma/coordinador`, `adaptadores/firebase` → `plataforma/conectores/firebase` | integración y cobertura | no | 0,5 |
| **T4** | `limite-tasa` y HMAC al núcleo con reexportación transitoria | unitarias de núcleo, funciones | no | 0,5 |
| **L1** | Colecciones con dueño: `alertas`, `reconstrucciones`, `novuchatTokens`, `limitesTasa`; `storage.rules` generado | matriz negativa de reglas regenerada | sí (reglas) | 1 |
| **L2** | Manifiesto con `zona`, `pantallas`, `acciones`, `programadas`; menú y marco consultan `Tenant.modulos`; `tenants/<t>/config.json` leído por el alta | registro.test ampliado; prueba «módulo apagado → `permission-denied` y sin pantalla» | sí | 1,5 |

Cada PR declara costo en tres unidades: escrituras en GitHub y corridas de CI, escrituras en la nube (0 en T0–T4), y **cero cambios de contrato** con NovuChat. Precondición de toda tanda: baseline local en verde (`pnpm test`, `lint`, `typecheck`, `reglas:verificar`, `build -- --mode staging`, `test:funciones`).

## 8. Ejecución con agentes

| Agente | Zona de escritura | Tandas |
|---|---|---|
| `metodo` | `docs/`, `.claude/`, `CLAUDE.md`, `CODEOWNERS`, `scripts/zonas.mjs`, `pruebas/fronteras/` | T0 |
| `coordinador` | `plataforma/funciones/servidor/` (salvo los archivos de módulo y `llamadas/usuarios.ts`), `plataforma/adaptadores|coordinador/`, `pruebas/{funciones,integracion}/` | T1, T3 |
| `central` | `paquetes/panel/src/` salvo las piezas de módulo (§5.1), `llamadas/usuarios.ts`, `pruebas/panel/` | T1, T2 |
| `modulo:<m>` | `paquetes/<m>/`, `panel/src/pantallas/<m>/` y sus piezas (§5.1), `llamadas/<m>.ts` (consola incluye `medios.ts`, `trigger-medios.ts`, `disparador-sitio.ts`; recibos incluye `enlace-pdf.ts`), `pruebas/<m>/` | T2, L1, L2 |
| `nucleo` | `paquetes/nucleo/`, `redondeo.ts`, `notificador.ts`, `programadas/cotizacion.ts`, `pruebas/{identidad,limites,tipo-cambio,reglas,tenant}/` | T4, L1 |
| `seguridad` | solo lectura | cada PR que toque reglas, IAM, secretos o Functions expuestas |

**Regla de integración dura** (nada se fusiona si falla una): `fronteras.test.ts` y `registro.test.ts` en verde; todas las suites sin quitar un caso (en tandas T, sin tocar su contenido); `reglas:verificar` idéntico en tandas T; costo declarado; revisión de `seguridad` cuando toque. Un escritor por archivo; ramas desde `main`; un PR por tanda; la sesión principal concilia `CLAUDE.md` y `docs/`.

**Quién autoriza:** cada fusión de tanda la autoriza Andres con un botón por PR (aprobación en GitHub ejecutada por Claude como `segurolotengopy`, con constancia); la revisora comprueba el hito contra este documento y el código antes de que Andres autorice la fase siguiente.

**Hitos:** H0 = este documento aprobado (05/11/2026, con observaciones incorporadas); H1 = T0 fusionada (frontera ampliada en CI); H2 = T1–T4 fusionadas (cero cruces en la medición); H3 = L1; H4 = L2. Cada hito se cierra con informe (PR, sha, números reales, costo, lo que quedó fuera, lo que el plano tenía mal) y espera el OK de Andres.

## 9. Cómo se sostiene

Carpeta = zona; `fronteras.test.ts` en CI y pre-commit sobre todo el repo con `deuda.json` que solo baja; gancho de zona de escritura por agente; `scripts/zonas.mjs` como estado generado (nunca cifras en los documentos); el manifiesto declara todo lo que un módulo aporta y `registro.test.ts` lo exige; `CODEOWNERS` por zona.

## 10. Riesgos

Mover con lógica mezclada en un repo público con squash es irrevisable → tandas puras. Rutas acopladas (`firebase.json`, `empaquetar.mjs`, `build.mjs`, `vitest`, `eslint`, `verificador.ts`, CI) → por eso no se mueven paquetes de primer nivel. Agentes que escriben a la vez → un escritor por archivo y análisis antes de ejecutar. La arquitectura escrita y no aplicada → la frontera ampliada entra en T0, antes de mover nada.

## 11. Lo que NO se hace en este cambio

No se mueven paquetes de primer nivel ni se parte `plataforma/funciones` en paquetes; no se cambia ningún contrato con NovuChat; no se agregan planes ni se cambian límites; no se construyen propiedades de producto ni la copia de medios al bucket público (van en sus propios PR); no se toca el pase a staging ni a producción de Casa Bermejo, que siguen su guion.
