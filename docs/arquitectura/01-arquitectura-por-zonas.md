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
| **El camino** | Una tanda cero sin mover archivos (docs, agentes, gancho, medición) y cuatro tandas de movimiento **sin cambiar lógica**, más dos fases de lógica (colecciones con dueño; encendido por tenant). Unas 6 jornadas. Nada de esto bloquea el pase a staging ni a producción de T1 |
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
| `tenants/<t>` | 0 (solo `config.json`) | — |

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
| **Tenants** | Datos y configuración **declarativa** de un cliente: `tenants/{t}/…` en Firestore, `tenants/<t>/config.json` en el repo, `CLIENTES/<T>/` fuera del repo. **Nunca lógica**: la configuración se valida contra los tipos de `paquetes/nucleo/src/extension` (que son del núcleo, no del tenant) | El comercio desde el panel; NovuTienda desde Plataforma | `tenants/<t>/config.json` (hoy nadie lo lee); `CLAUDE.md` l. 71 se alinea con esta redacción en T0 |

Nota (H2, 06/11/2026): la programada de cotización (`programadas/cotizacion.ts`) quedó en la zona **coordinador**, no núcleo; el porqué y la alternativa (fase L) están en §6.5.

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
| Manifiesto de módulo (`colecciones`, `limite`, `emite`, `consume`, `consumeOpcional`, `dependeDe`) | existe | `paquetes/nucleo/src/registro/tipos.ts` |
| Eventos v1 (`venta.confirmada`, `venta.anulada`, `turno.cerrado`, `stock.cambiado`, `stock.bajo`, `recibo.emitido`, `pedido.solicitado`, `pedido.confirmado`, `producto.cambiado`) | existe, congelado | `paquetes/nucleo/src/eventos/*.v1.ts` |
| Puertos módulo↔módulo (consola→inventarios, pos→inventarios, recibos→db) | existen como código, sin documento | `plataforma/adaptadores/*.ts` → documentar en `docs/arquitectura/coordinador.md` |
| Callable por módulo `{accion, tenantId, datos}` con esquema zod y rol | existe | `llamadas/marco.ts`, `docs/produccion/funciones.md` |
| API externa NovuChat v1 / v1.1 | existe, acordado | `docs/integracion-novuchat.md`, `docs/contratos/propiedades-de-producto-v1.1.md` |
| **Pantallas, acciones y programadas que aporta cada módulo** | **falta** (L2-1): hoy el menú filtra por rol, no por módulo | campos nuevos del manifiesto: `zona`, `pantallas[]`, `acciones[]`, `programadas[]`, `requiere[]` (formas abajo) |
| **Colección raíz y almacenamiento del manifiesto** (L1) | **falta**: campos opcionales nuevos, ver abajo | `ambito` en `ColeccionManifiesto`, `almacenamiento` en el manifiesto |
| **Encendido por tenant** (`Tenant.modulos`) | existe el dato, no el uso | el marco de callables y el menú del panel consultan `modulos` del tenant |

**Campos de L1 en el manifiesto** (opcionales; un manifiesto que no los declara se valida igual que antes):

- `ambito?: 'tenant' | 'raiz'` en `ColeccionManifiesto` (por omisión `tenant`). Una colección `raiz` tiene un solo segmento de ruta distinto de `tenants`, `lectura: []`, `escritura: 'servidor'` y no lleva `limite`. El registro rechaza cualquier otra combinación.
- `almacenamiento?` en el manifiesto: rutas de Storage relativas a `tenants/{t}/`, cada una con `lectura: 'servidor' | 'publica'` y `escritura: 'servidor' | { tipo: 'subidaReservada', roles, reserva, archivos: [{ tipo, bytesMax, contentType }] }`. `scripts/generar-reglas.mjs` genera `storage.rules` desde el registro (L1-c), igual que `firestore.rules`; no se amplía a mano.
- **Contrato de la reserva:** los campos `estado`, `venceEn`, `productoId`, `por`, `bytes` y `tipo` del documento de reserva son contrato con `paquetes/consola/src/medios/subidas.ts`; cambiarlos exige cambiar ambos lados en el mismo PR.

**Campos de L2 en el manifiesto** (todos opcionales y aditivos; los define L2-1, se declaran en L2-2):

- `zona?: 'nucleo' | 'central' | 'plataforma' | 'modulo'`. **`NO_ENCENDIBLES = nucleo, panel, plataforma`** es una lista cerrada y es exactamente el conjunto de ids con `zona` distinta de `modulo`; `registro.test.ts` la fija.
- `pantallas?: { id, titulo, roles, orden, tituloPorRol? }[]`: de ellas salen el menú y los roles del panel.
- `acciones?: { callable, nombre, roles, propietario? }[]`: `callable` y `nombre` cumplen `^[a-z][a-zA-Z0-9]*$`; de ellas salen los roles de los callables. Una acción con `propietario` no cabe en zona `nucleo`.
- `programadas?: { id, horario, zonaHoraria, porTenant: boolean }[]`: de ellas salen los parámetros de las programadas (los nombres exportados por Functions siguen estáticos; una prueba exige que el conjunto exportado sea el del registro).
- `requiere?: IdModulo[]`: dependencias de ejecución por puertos (D1 de §6.7). No puede nombrar al propio módulo.

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
Opción A (un proyecto Firebase, `tenants/{t}`); repo público modo A; alcance = PDF + Anexo A; 3 roles; panel único separado de la consola de NovuChat; lectura solo por callables; us-east1; esquema común de propiedades con NovuChat (C′), capacidad apagada para T1.

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

### 6.5 Enmiendas de la revisión H1 y de la tanda T1 (05/11/2026)

**Qué tanda elimina cada entrada de la deuda.** La revisora pidió (H1, observación 1) que §7 y `pruebas/fronteras/deuda.json` digan lo mismo. La fuente de verdad del cruce es `deuda.json` (`resuelveEn`); esta tabla fija lo que cada tanda debe quitar y el método con que lo quita. Las filas de §7 se leen con esta tabla.

| Entrada de `deuda.json` (archivo → importación) | Zona violada | Tanda | Cómo se resuelve |
|---|---|---|---|
| `llamadas/marco.ts → @novutienda/pos` | coordinador → módulo | **T1** | `ActorPos` es solo un tipo: pasa al núcleo (`identidad`, `ActorConRol`) y `pos` lo reexporta type-only con su nombre; `marco.ts` lo importa del núcleo |
| `programadas.ts → @novutienda/consola` | coordinador → módulo | **T1** | partir en `programadas/{cotizacion,consola,tenants}.ts`; el borde `programadas/consola.ts` (módulo) importa el paquete; `cotizacion.ts` lo alcanza por ese borde |
| `pruebas/consola/alineacion.test.ts → @novutienda/inventarios` | pruebas de un módulo → otro módulo | **T3 (hecho)** | es una prueba de integración consola↔inventarios: pasó a `pruebas/integracion/alineacion.test.ts`; la entrada salió de `deuda.json` |
| `panel/src/servicios.ts → ./subidas/almacen.js`, `→ ./subidas/firebase.js`, `panel/src/ui/contexto.ts → ../subidas/almacen.js` | Central → consola | **T2** | **reclasificación** (H1, observación 2): `subidas/almacen.ts` (puerto genérico `subir(ruta, archivo, progreso)`) y `subidas/firebase.ts` (subida reanudable a Storage a una ruta dada) son transporte **Central**, como `api/transporte.ts`; se declaran así en `zonas.ts` y las tres entradas salen sin mover nada |
| `panel/src/index.ts → ./subidas/esperar.js` | Central → consola | **T2** | `esperar.ts` (llama a `estadoSubida`/`finalizarSubida` del callable) **es consola**: va a `pantallas/consola/`; la reexportación de `panel/src/index.ts` la usa solo `pruebas/panel/emulador.test.ts`, que pasa a importar la ruta del módulo (no se agrega `index.ts` a `COMPOSITORES`) |
| `panel/src/pantallas/pos/venta-terminal.tsx → ../recibos/recibo-vista.js` (antes `pantallas/venta-terminal.tsx → ../ui/recibo.js`) | pos → recibos | **decisión de Andres (H2)** | T2 lo movió con sus archivos sin resolverlo: `ReciboVista` es presentación pura, pero `AccionesRecibo` (mismo archivo, mismo consumidor) llama a `enviarRecibo` y `referenciarFacturaSuma`, callables de recibos, así que no es Central. O `pos` declara `dependeDe: recibos` en su manifiesto (una línea, fuera de T2 porque T2 no toca manifiestos), o se parte la vista y `AccionesRecibo` queda en recibos con el cruce |
| `panel/src/servicios.ts → ./doble/doble.js` | Central → material de prueba | **L2** | el plano preveía sacar el doble a `pruebas/`, pero `servicios.ts` (producción) lo monta con un `import()` condicional en modo `humo` y el tsconfig del paquete solo alcanza `src/`: moverlo rompe el build o deja el cruce igual. T2 llevó los dobles de módulo a `src/doble/<m>/` (zona `pruebas:modulo:<m>`); quitar o inyectar el montaje del doble cambia la composición (fase L2) |
| `http/router.ts → @novutienda/website` | coordinador → módulo | **T4** | partir `http/website.ts` (zona `modulo:website`) con `despacharApi`, `lectorCotizacion`, `DepsContacto` y los verificadores; `router.ts` queda solo componiendo (H1, observación 3); `LimiteTasa` al núcleo en la misma tanda |
| `http/novuchat.ts → @novutienda/website`, `index.ts → @novutienda/website` | conector/coordinador → módulo | **T4** | `limiteMemoria`/`LimiteTasa` al núcleo con reexportación transitoria desde `website` |
| `http/sitio.ts → @novutienda/inventarios` | conector → módulo | **T4** | `verificarFirma` (HMAC) al núcleo con reexportación transitoria desde `inventarios` |

T4 actualiza además los **cuatro archivos de `conectores/firebase/`** (antes `adaptadores/firebase/`) que importan `website` (`limite-tasa`, `verificadores`, `disponibilidad`, `contacto`): como `conector:firebase` sirve a todas las zonas, esa importación no cuenta como cruce y la deuda no la empuja (H1, observación 5); la revisora lo comprueba con `grep`, no con la prueba. Al cerrar T4, `pnpm zonas` debe dar cero cruces y `deuda.json` quedar vacía.

**Lo que T1 encontró distinto del plano** (05/11/2026, agente `coordinador`; a confirmar por Andres al cerrar H2):

- **`programadas/cotizacion.ts` es coordinador, no núcleo.** §5.3 y la tabla de §3 lo preveían núcleo, pero `ejecutarCotizaciones` recibe el `Entorno` completo, recorre los tenants y a las 07:00 dispara la reconstrucción diaria del sitio (módulo consola): responde «sí» a la pregunta 6 de la prueba de ubicación, igual que `listarTenants`/`porTenant` (H0). Declararla núcleo habría creado tres cruces nuevos (`Entorno`, `tenants.ts`, consola) que la tanda no puede corregir sin cambiar la lógica ni los casos de `programadas.test.ts`. Se declaró **coordinador** en `zonas.ts`, y el borde `programadas/consola.ts` expone `ejecutarReconstruccion` para que el coordinador no importe el paquete fuera de un compositor. El núcleo de la cotización sigue en `paquetes/nucleo/src/tipo-cambio`. Para que `cotizacion.ts` llegue a ser núcleo hay que inyectar la corrida diaria (una decisión de lógica: fase L, no tanda T). La fila `nucleo` de §8 y la ficha `.claude/agents/nucleo.md` siguen nombrando `programadas/cotizacion.ts`: se corrigen con la sesión principal.
- `ActorPos` se llama `ActorConRol` en el núcleo (el núcleo no nombra módulos); `pos` conserva el nombre para sus consumidores.
- `UID` (esquema zod del uid) sube de `llamadas/consola.ts` a `llamadas/comunes.ts` porque lo usan la auditoría de consola y las acciones de usuarios.

**Lo que T2 encontró distinto del plano** (05/11/2026, agente `central`; a confirmar por Andres al cerrar H2):

- **Carpeta por módulo, con las piezas que solo ese módulo usa.** `pantallas/pos/` lleva también `arqueo.ts` y `pagos.ts` (antes `util/`); `pantallas/consola/`, `plantillas-vista.ts` (antes `util/`) y `esperar.ts` (antes `subidas/`); `pantallas/recibos/`, `recibo-vista.tsx` (antes `ui/recibo.tsx`). `pantallas/{usuarios,configuracion}.tsx` quedan en la raíz de `pantallas/` (Central), igual que `gestion.test.ts`, que prueba pantallas de Central y de tres módulos a la vez (`pruebas:central` puede importar módulos). `util/util.test.ts` sigue en `util/` y prueba `arqueo`, `pagos` y `plantillas-vista` desde su carpeta nueva: partir la prueba habría tocado el contenido de una suite.
- **Los dobles de módulo no pueden salir a `pruebas/`.** `servicios.ts` (Central, producción) monta `doble/doble.ts` en modo `humo` y `doble/transporte.ts` compone los handlers de pos e inventarios; el tsconfig del panel (`rootDir: src`) no alcanza `pruebas/`, y desde `pruebas/` el camino de vuelta sería una importación profunda a `/src/` que ESLint y el verificador prohíben. Quedaron en `src/doble/{pos,inventario}/` con zona `pruebas:modulo:<m>` (carpeta = zona). La entrada `servicios.ts → ./doble/doble.js` pasa a L2.
- **`esperarSubida` sale de la entrada pública de Central y entra por `@novutienda/panel/consola`.** `pruebas/panel/emulador.test.ts` no puede importar `pantallas/consola/esperar.ts` por ruta (importación profunda a `/src/`, fuera del `rootDir` de `pruebas/`), así que `package.json` del panel exporta `./consola` → `src/pantallas/consola/index.ts` (solo reexporta) y `zonas.ts` cuenta `@novutienda/panel/<m>` como `modulo:<m>`. Es la forma de «importar la ruta del módulo» que la tabla pedía sin tocar `COMPOSITORES`; en L2, cuando el registro aporte las pantallas, esa entrada por módulo es la que crece.
- **El cruce pos → recibos no se resuelve moviendo.** Ver la fila de la tabla: `AccionesRecibo` no es presentación pura. T2 no tocó `paquetes/pos/src/manifiesto.ts` (no es un movimiento).

**Lo que T3 hizo y encontró distinto del plano** (05/11/2026, agente `coordinador`; a confirmar por Andres al cerrar H2):

- **`bandeja-memoria.ts` se partió sin cambiar lógica.** `Consumidor` y `consumidoresDePlataforma` quedaron en `plataforma/coordinador/consumidores.ts` (producción); `BandejaMemoria`, `publicarEnBandeja` y los tipos de entrega (`OrdenEntrega`, `OpcionesEntrega`, `ResumenEntrega`) pasaron a `pruebas/integracion/bandeja-memoria.ts`, que ya no se reexporta desde `index.ts`. `bus.ts` no cambió de import (sigue entrando por `index.ts`). Cobertura de la carpeta de puertos: sube (sentencias 91,39 % → 96,61 %), porque el doble sale del denominador; el umbral de 70 % sigue en verde.
- **Se renombró.** El costo medido fue de unos 26 archivos (imports en `servidor/*` y `pruebas/*`, `vitest.config.ts`, `zonas.ts`, `CODEOWNERS`, docs y agentes), por debajo del tope de 40, y sin tocar `empaquetar.mjs`, `firebase.json` ni los `tsconfig` (ninguno nombraba la carpeta). `plataforma/adaptadores/` pasó a `plataforma/coordinador/` y `adaptadores/firebase/` a `plataforma/conectores/firebase/`. Un solo import dejó de ser relativo-hermano: `base-datos.ts` (firebase) importa el tipo `LectorColecciones` de `../../coordinador/colecciones.js` (solo tipo; el conector de Firebase sirve a todas las zonas). La cobertura incluye ahora `plataforma/conectores/**`.
- **Pendiente fuera de esta tanda:** `.claude/zona` de los worktrees del coordinador debe pasar a `plataforma/coordinador/:plataforma/conectores/:plataforma/funciones/servidor/:pruebas/funciones/:pruebas/integracion/` (el clasificador bloquea escribirlo desde el agente); mientras no se cambie, el gancho rechazará las escrituras del agente en las rutas nuevas. La prueba `pruebas/funciones/adaptadores.test.ts` conserva su nombre (prueba los adaptadores de Firestore).
- `deuda.json` baja de 7 a 6 entradas.
- **`api/real.ts` no se partió.** Sigue siendo el transporte Central con la tabla acción → rol de todos los módulos escrita a mano (H0, observación 3); partirla por módulo cambia la composición del cliente y queda legítimo solo en L2, cuando las acciones salgan del manifiesto.
- `pruebas/fronteras/fronteras.test.ts` cambió las rutas de sus expectativas (`pantallas/venta-cobro.tsx` → `pantallas/pos/venta-cobro.tsx`, el árbol inventado de `login.tsx`) y ganó una comprobación de `@novutienda/panel/<m>`; ningún caso se quitó.

**Lo que T4 hizo y encontró distinto del plano** (06/11/2026, agente `nucleo`; a confirmar por Andres al cerrar H2):

- **Movimiento sin cambiar lógica.** `limite-tasa.ts` (website) pasó a `paquetes/nucleo/src/limite-tasa/limite-tasa.ts` y `firma.ts` (inventarios) a `paquetes/nucleo/src/firma/firma.ts`, con `git mv`; el núcleo los exporta desde `@novutienda/nucleo`. `website` e `inventarios` los reexportan desde sus rutas viejas (transitorio); los consumidores del servidor (`index.ts`, `http/novuchat.ts`, `http/router.ts`, `http/sitio.ts`, `conectores/firebase/limite-tasa.ts`, `unidades.test.ts`) importan ya del núcleo. Ninguno de los dos archivos tenía prueba propia (el límite se prueba en `api.test.ts` de website y la firma vía `pedido.test.ts` de inventarios); no se movió ninguna prueba.
- **`http/website.ts` (zona `modulo:website`).** Contiene la llamada a `despacharApi` y el armado de `DepsContacto` tal como estaban en `router.ts` (función `manejarSitioPublico` y el tipo `ConfigWebsite`); `ConfigRouter` extiende `Pick<ConfigWebsite, 'recaptcha' | 'appCheck'>` para que el router no importe `@novutienda/website`. Los cuerpos no cambiaron; solo se extrajeron.
- **El tsconfig del núcleo declara `types: ["node"]`** porque la firma usa `node:crypto` y `Buffer`.
- **Hallazgo:** `@novutienda/nucleo` lo importa también el panel (navegador) y su entrada pública incluye ahora `node:crypto`. `pnpm build` emite el aviso de Vite «Module node:crypto has been externalized», pero el bundle del panel no contiene `createHmac` ni `timingSafeEqual` (tree-shaking). Si el aviso molesta, la salida es una entrada `@novutienda/nucleo/servidor`; no se hizo porque cambia la superficie pública.
- **Conectores de Firebase:** `limite-tasa.ts` ya no importa `website`. `disponibilidad.ts`, `contacto.ts` y `verificadores.ts` (y `entorno.ts`, compositor) siguen importando tipos de puerto de `@novutienda/website` (`LectorDisponibilidad`, `GuardarContacto`, `VerificadorAppCheck`, `VerificadorRecaptcha`): implementan puertos que declara el módulo, y el conector de Firebase sirve a todas las zonas, así que la compuerta no los cuenta como cruce.
- `deuda.json` baja de 6 a 2 entradas (quedan `venta-terminal → recibo-vista` y `servicios.ts → doble`). `zonas.ts` solo ganó el patrón de `http/website.ts`: `paquetes/nucleo/` ya cubría las carpetas nuevas.

### 6.6 Enmienda L1 (06/11/2026): colecciones con dueño

- **D1: `novuchatTokens` → manifiesto `plataforma`** (`plataforma/operador/manifiesto.ts`, `dependeDe: ['nucleo']`, zona Plataforma, pregunta 3 de la prueba de ubicación: los tokens de integraciones los ve y opera solo NovuTienda). Alternativas rechazadas: **núcleo** (no lo corre todo tenant igual: es dato del operador, y el núcleo no debe cargar con integraciones) y **conector** (el conector habla con el sistema externo, pero no es dueño del dato).
- `alertas` y `limitesTasa` (colecciones raíz) → **núcleo**. `reconstrucciones` → **consola**.
- `privado/` tiene dos dueños: el dueño de Storage se declara **por subruta** en `almacenamiento`.
- El documento raíz `tenants/{t}` queda **sin dueño** hasta L2.
- `publico/**` se mantiene **amplio** (lectura pública); no se parte en L1.
- Las colecciones raíz y las rutas de Storage se declaran con `ambito` y `almacenamiento` (§4).

### 6.7 Enmienda L2 (06/11/2026): encendido por tenant y manifiesto completo

Plan: `NOVUTIENDA_plan-L2-encendido-por-tenant_2026-11-06.md` (en `~/CLAUDE_DESCARGAS/`). Un PR por bloque L2-0…L2-9 (§7).

**Alcance (los 8 puntos de H3):**
1. Campo `zona` en los manifiestos y lista cerrada `NO_ENCENDIBLES` (§4).
2. `pantallas[]`, `acciones[]` y `programadas[]` (y `requiere[]`); de ellos salen los roles del panel, el menú, los roles de los callables y los parámetros de las programadas.
3. Encendido en ejecución: el marco de callables, el menú y las programadas consultan `Tenant.modulos`, respetando `dependeDe` y `requiere`.
4. Alta de tenant desde `tenants/<t>/config.json` y dueño para el documento `tenants/{t}` (manifiesto `plataforma`).
5. El doble sale de la composición de `servicios.ts`; `deuda.json` vacío.
6. `publico/**` acotado.
7. Prueba que ata la plantilla `reservaValida` a consola; el emulador de Storage se exige.
8. Método: este plano, pre-commit y `.claude/zona`.

**Lo que no entra, y por qué:**
- **Encendido en HTTP (`api`), en el bus `eventos` y en el disparador `subidaFinalizada`: L3.** Se creyó que HTTP era de un solo tenant por construcción; es falso (corregido en §6.8). Al bus solo llegan eventos de módulos que ya pasaron el control del callable. El disparador solo recibe archivos con reserva, que exige el callable `medios`, ya controlado.
- **Versiones de módulo por tenant:** L2 solo mira si el módulo está encendido; hoy nadie lee la versión.
- **Paso `reglas:verificar` en el job `calidad`:** ya lo cubre `pruebas/reglas/generador.test.ts`, que corre en `calidad`. Se descarta.
- **`.claude/zona` del coordinador:** no hay worktrees vigentes y `.claude/agents/coordinador.md` ya trae las rutas nuevas; pasa a ser un paso de arranque de cada worktree, sin PR.

**Regla: el control de encendido es por dueño de la acción, no por callable.** El callable `consola` lleva acciones de Central (usuarios); una acción de un manifiesto con `zona` distinta de `modulo` no se controla. Controlar por callable apagaría la gestión de usuarios.

**Decisiones de Andres del 06/11/2026 (botones):**
- **D1: campo `requiere[]`.** Dependencias de ejecución por puertos (pos→inventarios, consola→inventarios, website→consola e inventarios). Cuenta para el encendido y el alta, **no autoriza importaciones**; `dependeDe` queda sin cambios. Descartado sumarlas a `dependeDe` (aflojaría la frontera) y descartado no declararlas («pos sin inventarios» fallaría al ejecutar).
- **D2: `tenants/<t>/config.json` v2** = `{ version: 2, plan, zonaHoraria, monedas, modulos: [ids] }`, con las versiones tomadas del manifiesto. T1 con inventarios, pos, recibos, consola y website. Descartadas la copia literal del documento `Tenant` y mantener `modulosActivos`.
- **D3: acción central `modulosActivos` en el callable `consola`**, como las de usuarios (sin Function nueva). Descartados un callable nuevo y el claim.
- **D4: `publico/**` se acota a `publico/medios/**` en L2-8** (reduce permisos).
- **D5: el encendido en L2 llega a callables, menú y programadas.** HTTP, bus y disparador, a L3.

**Lo que el plano tenía mal o incompleto:**
1. «Pre-commit `--all-files` limpio en main» no puede cumplirse: `no-commit-to-branch` falla siempre sobre `main`. Se mide en una rama que parte de `main`, o con `SKIP=no-commit-to-branch`.
2. §7 estimaba L2 en 1,5 jornadas; son unas 4 a 5.
3. `dependeDe` no recoge las dependencias de ejecución por puertos (D1).
4. `tenants/<t>/config.json` contradecía al documento de staging y al tipo `Tenant` (D2).
5. `index.ts` no puede derivar sus exportaciones del registro (Firebase necesita nombres estáticos): se derivan los parámetros y una prueba exige que el conjunto exportado sea el del registro.
6. El callable `consola` lleva acciones de Central: el control es por dueño de la acción.
7. El registro prohíbe la raíz `tenants`: darle dueño exige una excepción explícita limitada al manifiesto `plataforma`.
8. El paso `reglas:verificar` en `calidad` ya existe a través de `generador.test.ts`.
9. Las fixtures de emulador siembran `modulos: {}`: sin cambiarlas, el control de L2-6 tumbaría `test:funciones`.

### 6.8 Enmienda L3 (09/11/2026): encendido en HTTP, bus de eventos y disparador de Storage

Plan: `NOVUTIENDA_plan-L3_2026-11-09.md` (en `~/CLAUDE_DESCARGAS/`). Un PR por bloque L3-0…L3-6 (§7). Corrige el diagnóstico de L2 (§6.7, D5).

**Hallazgos:**
1. HTTP **no** es «de un solo tenant por construcción». El tenant de las rutas del sitio (`/api/cotizacion`, `/api/disponibilidad`, `/api/contacto`) y del pedido firmado sale del host (`x-forwarded-host`, tabla `dominios`; PR B), ya no de `TENANT_ID`. El catálogo y el inventario de NovuChat toman el tenant del token (`autenticarToken`) y `/api/sitio/v1/*` del `tenantId` firmado. Con un segundo tenant con token de NovuChat o reconstrucción del sitio el hueco ya existe, y apagar `inventarios` no corta su catálogo.
2. Al bus llegan eventos que no pasaron por un callable: el pedido firmado (HTTP) llama a `confirmarPedido` → `aplicarSalida` y publica `stock.cambiado` y `stock.bajo`. Hoy nadie consume `stock.*`.
3. `limpiezaSubidas` salta los tenants con consola apagada (desde L2-6): sus reservas vencidas y borrados pendientes no se limpian nunca.
4. Las respuestas de NovuChat llevan `Cache-Control: private, max-age=60`; sumado a la caché de 60 s de `modulosDelTenant`, apagar un módulo puede tardar hasta ~120 s en notarse en NovuChat. Se documenta.

**Decisiones de Andres del 09/11/2026 (botones):**
- **D1 = A: L3-3 se fusiona antes del alta de cualquier tenant con módulos apagados y antes de apagar un módulo a cualquier tenant** (incluido el primero). Descartadas B (antes del tercer tenant, deja ventana) y C (antes del pase a producción).
- **D2 = A: con el módulo apagado, NovuChat recibe 401 `credencial_invalida`** (cero cambios de contrato). El sitio y `/api/sitio/v1/*` responden 404. Descartadas B (403 `modulo_apagado`, cambia el contrato) y C (404 en NovuChat).
- **D3 = A: el bus se controla con una invariante estática** (`pruebas/registro.test.ts`): todo emisor de un evento que consume el módulo C tiene a C en su cierre de `dependeDe`/`requiere`. Sin control en ejecución. Descartadas B (control en ejecución) y C (nada).
- **D4 = A: con consola apagada el disparador `subidaFinalizada` no procesa y `limpiezaSubidas` corre para todos los tenants.** Descartadas B (la limpieza sigue saltando) y C (dejar como está).

**Cierre (L3-6):** el encendido en HTTP quedó fusionado (PR 42 a 46); la condición de D1 (L3-3 antes de apagar un módulo o dar de alta un tenant con módulos apagados) está cumplida. L3-5 espera su fusión. Antes de desplegar en un ambiente, `tenants/{t}` debe existir en él.

**No entra:** volver multitenant las rutas de tenant fijo (sitio por dominio, pedido firmado por tenant): corresponde al segundo tenant con website. Versiones de módulo por tenant y límites de tasa por plan en HTTP.

### 6.9 Enmienda multitenant (10/11/2026): por tenant y compartido

Decisiones y riesgos: `decisiones.md` (entrada «Multitenant»). Este plano fija solo la ubicación.

| Pieza | Alcance |
|---|---|
| Proyecto Firebase, Firestore, bucket, función `api`, callables, panel | Compartido; aislamiento por ruta, claim y estado. El tenant del panel sale del claim y lo elige un selector |
| Sitio público, dominio, target y CSP de Hosting | Por tenant; el tenant de las rutas públicas sale del host |
| Secretos de NovuChat y de reconstrucción | Por tenant (derivados) |
| Medios | Bucket y base de URL compartidos; rutas y cuota por tenant |
| Topes por plan, almacén de cotización | Por tenant |
| Demo | Tenant aparte, solo en staging |

| Pieza nueva | Zona |
|---|---|
| Lector host a tenant (`plataforma/coordinador/dominios.ts`) | Coordinador |
| Colección `dominios/{host}` (lectura y escritura `false` en reglas) | Plataforma (manifiesto) |
| `scripts/dominio-tenant.mjs`, `plataforma/operador/dominio.ts`, `componer-hosting.mjs`, guardias de demo, verificación de aislamiento | Plataforma |
| `derivarSecretoTenant` (`paquetes/nucleo/src/firma/`); campo `uso` del tenant | Núcleo |
| Uso de la derivación en `http/novuchat.ts` y `http/sitio.ts` | Coordinador |
| `http/website.ts` | Módulo `website` |
| Selector del panel (`sesion/claim.ts`, `sesion.ts`, `ui/app.tsx`) | Central |
| Workflow y preparación del despliegue | `devsecops` |

### 6.10 Mercados y monedas son configuración del tenant

Regla de Andres: la triple moneda es opcional para los clientes de NovuTienda y particular del tenant de tres monedas. Cada tenant declara sus
mercados (identificador, nombre, moneda de venta, moneda base de precios, zona horaria, tipo de cambio o ninguno, redondeo) y sus
monedas de caja; es configuración **declarativa** del tenant (zona Tenant, validada por tipos del núcleo), nunca lógica. Sin tipo de
cambio en un mercado, el precio es el precio base, sin cotización. Si falta la declaración, el sistema falla cerrado: no se toma un tenant de referencia por defecto. Los identificadores, precios guardados, cotizaciones y eventos existentes se conservan.

Decisiones de Andres:

- **D1** Caja en otra moneda: solo las monedas que declare el comercio.
- **D2** Moneda base de precios: la de cada mercado (el tenant de tres monedas sigue en dólares).
- **D3** Tipo de cambio: opcional por mercado.
- **D4** Tope por plan: el plan base admite 1 mercado y 1 moneda; varios, en un plan superior (el del tenant de tres monedas).
- **D5** Quién edita los mercados: solo NovuTienda; el administrador del comercio los ve, no los cambia.
- **D6** Segundo comercio de prueba en staging, con autorización antes de crearlo.

**Regla de la batería de equivalencia:** el comportamiento del tenant de referencia está fijado por `pruebas/equivalencia/` (fotos versionadas,
comparación byte a byte). Todo cambio del modelo de mercados y monedas debe dejarla idéntica. Si una foto cambia a propósito, se
regenera con `pnpm equivalencia:actualizar` (nunca en CI) y la razón se escribe en `pruebas/equivalencia/CAMBIOS.md`; la prueba
`candado.test.ts` falla si las referencias cambian sin ese registro.

## 7. Camino, por tandas y fases

| # | Qué | Prueba | Despliega | Jornadas |
|---|---|---|---|---|
| **T0** | Sin mover archivos: `pruebas/fronteras/zonas.ts` (`ZONA_POR_ARCHIVO`, §3) y `deuda.json`; `docs/arquitectura/{zonas,coordinador}.md`; `CODEOWNERS` real; `scripts/zonas.mjs` (tabla pieza→zona completa y cruces, solo lectura); agentes por zona en `.claude/agents/` (`nucleo`, `central`, `plataforma`, `modulo`, `coordinador`, `metodo`, `planificador`, `implementador`, `revisor-codigo`) y gancho de zona de escritura probado con un intento fuera de carpeta; `CLAUDE.md` con la regla de zonas, sin cifras; pre-commit con fronteras; `ESTADO.md` actualizado o retirado | `fronteras.test.ts` ampliado a `plataforma/` y `pruebas/` con zona por archivo y deuda que solo baja; ningún archivo sin zona | no | 1,5 |
| **T1** | Partir `programadas.ts` y sacar las acciones de usuarios de `llamadas/consola.ts` | funciones 123/123 sin tocar casos | no | 0,5 |
| **T2** | `panel/src/pantallas/<modulo>/` | build del panel, pruebas del panel | no | 0,5 |
| **T3** | `bandeja-memoria` → `consumidores` + doble en pruebas; renombrar `plataforma/adaptadores` → `plataforma/coordinador`, `adaptadores/firebase` → `plataforma/conectores/firebase` | integración y cobertura | no | 0,5 |
| **T4** | `limite-tasa` y HMAC al núcleo con reexportación transitoria | unitarias de núcleo, funciones | no | 0,5 |
| **T5** | (06/11/2026, PR 23) Retirados los puentes transitorios de T4 (`website/src/api/limite-tasa.ts`, `inventarios/src/firma.ts`); entrada `@novutienda/nucleo/servidor` para lo que depende de Node (firma HMAC); observaciones 2 y 3 de H2 | unitarias de núcleo, funciones, build del panel | no | 0,5 |
| **L1** | Colecciones con dueño: `alertas`, `reconstrucciones`, `novuchatTokens`, `limitesTasa`; `storage.rules` generado | matriz negativa de reglas regenerada | sí (reglas) | 1 |
| **L2-0** | Método: esta enmienda (§6.7), §7 y §8, `zonas.md`, `@novutienda/panel/manifiesto` como Central en `zonas.ts`, `ESTADO.md` | fronteras en verde; 0 sin zona | no | 0,2 |
| **L2-1** | Contrato del manifiesto sin efecto: `zona`, `pantallas`, `acciones`, `programadas`, `requiere`; `tenant/encendido.ts` (`modulosEfectivos`, `validarEncendido`) | `pruebas/tenant/encendido.test.ts`; `registro.test.ts` (rechazos, `NO_ENCENDIBLES`); `reglas:verificar` idéntico | no | 0,4 |
| **L2-2** | Cada manifiesto declara lo que aporta (incl. `paquetes/panel/src/manifiesto.ts`, Central); conformidad con las tablas actuales de `llamadas/*.ts`, `ITEMS_MENU` y los `onSchedule` | 5 casos de conformidad en `registro.test.ts`; comportamiento sin cambios | no | 0,5 |
| **L2-3** | El servidor deriva del manifiesto: `tablaDeCallable`, `onSchedule` con horario del registro, exportaciones = registro | `exportaciones.test.ts`; conformidad de acciones sin cambiar su contenido; `test:funciones` | sí | 0,6 |
| **L2-4** | El panel deriva del manifiesto: `api/real.ts` sin tabla a mano, menú desde `pantallas`, mapa id → componente en el compositor; generador `scripts/registro-panel.mjs` | `pantallas.test.ts`, `generado.test.ts`; `util.test.ts` y `contrato.test.ts` sin cambiar | no | 0,5 |
| **L2-5** | Alta de tenant (`plataforma/operador/alta.ts`, `scripts/alta-tenant.mjs`) y dueño del documento raíz `tenants/{t}` (manifiesto `plataforma`); `config.json` v2 | `alta.test.ts`; mutante «lectura abierta en `tenants/{t}`»; diff de reglas = un bloque `if false` | sí (reglas; alta en staging) | 0,6 |
| **L2-6** | Encendido en ejecución: marco, `porTenant` y menú consultan `Tenant.modulos`; acción `modulosActivos` | «módulo apagado → `permission-denied` y sin pantalla»; «pos sin recibos rechazado»; `test:funciones` | sí | 0,8 |
| **L2-7** | El doble de `servicios.ts` sale de la composición (`doble/arranque.tsx`); `deuda.json` vacío | `pnpm zonas` en 0 cruces; humo del panel | no | 0,3 |
| **L2-8** | `publico/**` → `publico/medios/**` (dueño consola); `CAMPOS_RESERVA` atado a la plantilla; Storage exigido en pruebas | contrato de reserva; negativo `publico/otro`; matriz y mutantes | sí (Storage, más restrictivo) | 0,5 |
| **L2-9** | Higiene del pre-commit (5 archivos hallados) | pre-commit limpio en una rama desde `main` | no | 0,1 |
| **L3-0** | Método: esta enmienda (§6.8), esta fila partida, `website.md`, `ESTADO.md`. **Hecho (PR 42)** | fronteras en verde; 0 sin zona | no | 0,1 |
| **L3-1** | Contrato `rutasHttp` en el manifiesto y `registro.rutasHttp()`, sin efecto. **Hecho (PR 43)** | `registro.test.ts` (rechazos); `reglas:verificar` idéntico | no | 0,3 |
| **L3-2** | website, inventarios y consola declaran sus rutas; conformidad con `router.ts`. **Hecho (PR 45)** | caso de conformidad; comportamiento sin cambios | no | 0,3 |
| **L3-3** | Encendido en HTTP: `rutas-http.ts`, `router.ts`, `novuchat.ts`, `sitio.ts` (D2 = A). **Se fusiona antes del alta de cualquier tenant con módulos apagados y antes de apagar un módulo a cualquier tenant (D1 = A)**. **Hecho (PR 46)** | `encendido-http.test.ts`; caso con emulador; `api.test.ts` intacto; `test:funciones`; humo de staging | sí | 0,8 |
| **L3-4** | Disparador `subidaFinalizada` sin procesar con consola apagada; `limpiezaSubidas` para todos (D4 = A). **Hecho (PR 44)** | `programadas.test.ts`, `encendido.test.ts` | sí | 0,3 |
| **L3-5** | Invariante estática del bus (D3 = A). **Escrito; pendiente de fusión (rama `test/l3-5-invariante-bus`)** | `registro.test.ts`; consumidores = `consume` de los manifiestos | no | 0,2 |
| **L3-6** | Cierre: `funciones.md`, `website.md`, `coordinador.md`, `ESTADO.md`. **Hecho** | fronteras en verde | no | 0,1 |

Cada PR declara costo en tres unidades: escrituras en GitHub y corridas de CI, escrituras en la nube (0 en T0–T4), y **cero cambios de contrato** con NovuChat. Precondición de toda tanda: baseline local en verde (`pnpm test`, `lint`, `typecheck`, `reglas:verificar`, `build -- --mode staging`, `test:funciones`).

## 8. Ejecución con agentes

| Agente | Zona de escritura | Tandas |
|---|---|---|
| `metodo` | `docs/`, `.claude/`, `CLAUDE.md`, `CODEOWNERS`, `scripts/zonas.mjs`, `pruebas/fronteras/` | T0 |
| `coordinador` | `plataforma/funciones/servidor/` (incluida `programadas/cotizacion.ts`, T1; salvo los archivos de módulo y `llamadas/usuarios.ts`), `plataforma/adaptadores|coordinador/`, `pruebas/{funciones,integracion}/` | T1, T3 |
| `central` | `paquetes/panel/src/` salvo las piezas de módulo (§5.1), `llamadas/usuarios.ts`, `pruebas/panel/` | T1, T2 |
| `modulo:<m>` | `paquetes/<m>/`, `panel/src/pantallas/<m>/` y sus piezas (§5.1), `llamadas/<m>.ts` (consola incluye `medios.ts`, `trigger-medios.ts`, `disparador-sitio.ts`; recibos incluye `enlace-pdf.ts`), `pruebas/<m>/` | T2, L1, L2 |
| `nucleo` | `paquetes/nucleo/`, `redondeo.ts`, `notificador.ts`, `pruebas/{identidad,limites,tipo-cambio,reglas,tenant}/` | T4, L1 |
| `seguridad` | solo lectura | cada PR que toque reglas, IAM, secretos o Functions expuestas |

**Regla de integración dura** (nada se fusiona si falla una): `fronteras.test.ts` y `registro.test.ts` en verde; todas las suites sin quitar un caso (en tandas T, sin tocar su contenido); `reglas:verificar` idéntico en tandas T; costo declarado; revisión de `seguridad` cuando toque. Un escritor por archivo; ramas desde `main`; un PR por tanda; la sesión principal concilia `CLAUDE.md` y `docs/`.

**Quién autoriza:** cada fusión de tanda la autoriza Andres con un botón por PR (aprobación en GitHub ejecutada por Claude como `segurolotengopy`, con constancia); la revisora comprueba el hito contra este documento y el código antes de que Andres autorice la fase siguiente.

**Hitos:** H0 = este documento aprobado (05/11/2026, con observaciones incorporadas); H1 = T0 fusionada (frontera ampliada en CI); H2 = T1–T4 fusionadas (cero cruces en la medición); H3 = L1; H4 = L2 completa (L2-0…L2-9; HTTP, bus y disparador quedan en L3). Cada hito se cierra con informe (PR, sha, números reales, costo, lo que quedó fuera, lo que el plano tenía mal) y espera el OK de Andres.

## 9. Cómo se sostiene

Carpeta = zona; `fronteras.test.ts` en CI y pre-commit sobre todo el repo con `deuda.json` que solo baja; gancho de zona de escritura por agente; `scripts/zonas.mjs` como estado generado (nunca cifras en los documentos); el manifiesto declara todo lo que un módulo aporta y `registro.test.ts` lo exige; `CODEOWNERS` por zona.

## 10. Riesgos

Mover con lógica mezclada en un repo público con squash es irrevisable → tandas puras. Rutas acopladas (`firebase.json`, `empaquetar.mjs`, `build.mjs`, `vitest`, `eslint`, `verificador.ts`, CI) → por eso no se mueven paquetes de primer nivel. Agentes que escriben a la vez → un escritor por archivo y análisis antes de ejecutar. La arquitectura escrita y no aplicada → la frontera ampliada entra en T0, antes de mover nada.

## 11. Lo que NO se hace en este cambio

No se mueven paquetes de primer nivel ni se parte `plataforma/funciones` en paquetes; no se cambia ningún contrato con NovuChat; no se agregan planes ni se cambian límites; no se construyen propiedades de producto ni la copia de medios al bucket público (van en sus propios PR); no se toca el pase a staging ni a producción de T1, que siguen su guion.

- **Decisión de Andres (06/11/2026, botón, cierre de H2):** el cruce `pantallas/pos/venta-terminal.tsx → recibos/recibo-vista` se resuelve con `dependeDe: ['nucleo', 'recibos']` en el manifiesto de pos (el POS imprime y envía recibos: la dependencia es real y el registro la ordena); descartado partir la vista. La deuda queda en 1 (`servicios.ts → doble`, L2).
