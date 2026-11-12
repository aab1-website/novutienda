# El coordinador: puertos, composición y bus de eventos

> Pieza con nombre propio de la arquitectura por zonas (plano `01-arquitectura-por-zonas.md` §3 y §4,
> «puertos módulo↔módulo: existen como código, sin documento»). Este documento escribe lo que hoy es
> implícito: qué puertos hay, quién los implementa, dónde se componen y cómo viajan los eventos. Las
> rutas son las posteriores a T3 (`plataforma/coordinador`, `plataforma/conectores/firebase`).
> Sin cifras (las da `pnpm zonas`) ni identificadores.

## Qué es y qué no es

El coordinador es la única pieza que **conoce a todas las zonas**, y las conoce solo de dos formas: por
el **registro** (`plataforma/registro.ts`, que enumera los manifiestos) y por los **puertos** que cada
módulo define en su entrada pública y que el coordinador implementa con otro módulo o con
infraestructura. Un módulo nunca importa a otro: define el puerto que necesita (una interfaz en su
`@novutienda/<m>`) y el coordinador lo cablea. Así los módulos quedan comprobables con dobles y el
orden de dependencia es el del plano: Módulos → Central → Núcleo.

El coordinador **no tiene lógica de negocio**: convierte tipos entre módulos, valida en el borde lo que
un módulo expresa con un tipo más laxo que otro, y decide el orden de composición. Si una regla de
negocio aparece en un adaptador, está mal ubicada.

## Los puertos (`plataforma/coordinador/`)

| Archivo | Puerto que implementa (quién lo define) | Con qué lo implementa | Para qué |
|---|---|---|---|
| `inventarios-pos.ts` | `PuertoInventarios` y `PuertoCatalogo` (pos) | funciones de `inventarios` (`aplicarSalida`, `aplicarReversion`, lectura de producto) | el POS descuenta y repone stock **dentro de su propia transacción** y lee el producto que vende, con precios en USD decimales; el plan de stock es opaco para el POS y se comprueba su marca antes de entregarlo |
| `catalogo-consola.ts` | `CatalogoPuerto` (consola) | `crearProducto`/`actualizarProducto` de `inventarios`, dueño de productos y stock | la consola edita el catálogo sin escribir las colecciones de Inventarios; la transacción la abre la consola y es la misma que anota el cambio y la auditoría |
| `producto-inventarios.ts` | conversión | — | centavos ↔ dólares entre la forma de Inventarios y la de la consola |
| `ejecutor-recibos.ts` | `EjecutorRecibos` (recibos) | `BaseDatosIdentidad` (núcleo) | Recibos escribe con la misma base transaccional que los demás; el adaptador difiere las escrituras para respetar «todas las lecturas antes de la primera escritura» de Firestore |
| `almacen-cotizaciones.ts` | `AlmacenCotizaciones` (núcleo) | `BaseDatosIdentidad` | la cotización que el POS lee dentro de su transacción es la que escribió la programada o la carga manual |
| `colecciones.ts` | `LectorColecciones` | — | lectura de colecciones que usan los puertos y el doble de pruebas |
| `consumidores.ts` | `Consumidor` y `consumidoresDePlataforma` | los consumidores reales de Recibos (2), Inventarios (2) y Consola (`producto.cambiado`, opcional) | `consume` es el consumo que el módulo necesita para funcionar; `consumeOpcional` es el que solo aplica si el emisor está activo, y el registro lo valida igual. El bus real (`servidor/bus.ts`) y las pruebas usan esta misma lista. La bandeja en memoria (`BandejaMemoria`, `publicarEnBandeja`) es un **doble de pruebas** y vive en `pruebas/integracion/bandeja-memoria.ts` |
| `index.ts` | entrada pública de los puertos | — | lo único que importan `entorno.ts`, `bus.ts` y las pruebas |

Regla: **cada puerto lo define el módulo que lo necesita** (en su paquete) y **lo implementa el
coordinador**; el módulo que provee la capacidad no sabe quién la consume. Un puerto nuevo es un cambio
de contrato entre dos zonas: lo planifica `planificador`, lo escribe `coordinador` y lo documenta aquí.

## Los conectores (`plataforma/conectores/firebase/`, `servidor/http/`)

Un conector habla con un sistema externo en nombre de una zona, y depende de ella, nunca al revés.

| Conector | Sirve a | Qué hace |
|---|---|---|
| `conectores/firebase/*` | todas | `BaseDatosIdentidad` sobre Firestore (`base-datos.ts`), `AuthMin` (`auth.ts`), traducción de errores de los módulos a códigos de borde (`errores.ts`), límite de tasa (`limite-tasa.ts`), medios en Storage y procesamiento (`almacen-medios.ts`, `procesador-medios.ts`, `consulta-subidas.ts`), lectura y ejecutor de recibos sobre Firestore, disponibilidad pública, contacto, verificadores de App Check y reCAPTCHA |
| `http/novuchat.ts` | inventarios y consola | la API externa v1/v1.1 que consume NovuChat (catálogo, inventario, pedidos), con firma, límite de tasa y control de encendido tras autenticar (módulo apagado: 401 `credencial_invalida`); contrato en `docs/integracion-novuchat.md` |
| `http/sitio.ts` | consola | endpoints de reconstrucción del sitio (contrato en `docs/arquitectura/decisiones.md`); con consola apagada responden 404 |
| parsers BCB/BNA/BCRA | núcleo | viven en `paquetes/nucleo/src/tipo-cambio/` y se clasifican como núcleo por carpeta |

## La composición (`plataforma/funciones/servidor/`)

- **`entorno.ts`**: arma, en un solo lugar, los puertos reales sobre `firebase-admin` y los entrega como un `Entorno` a toda función. Es el **compositor**: el único archivo del borde de ejecución autorizado a importar paquetes de módulo directamente, porque su trabajo es juntarlos. Las pruebas construyen otro `Entorno` con `crearEntorno` (reloj fijo, puertos simulados).
- **`index.ts`**: declara las Cloud Functions y las cablea con el `Entorno`: un callable por módulo (`pos`, `inventarios`, `consola`, `recibos`, `medios`), la función HTTP `api`, el disparador `eventos` (bus), `subidaFinalizada` (Storage) y las programadas (`cotizacion`, `limpiezaSubidas`, `temporizadorSitio`). Importa los **bordes** de módulo (`llamadas/<m>.ts`), no sus paquetes; la excepción heredada (`limiteMemoria`/`LimiteTasa` de website) está en `deuda.json` y la resuelve T4. El callable `consola` se compone como `{ ...accionesConsola, ...accionesUsuarios }`: las acciones de usuarios (`llamadas/usuarios.ts`, Central) viajan en él para que el contrato del panel no cambie (T1).
- **`llamadas/marco.ts`**: el marco común de callables `{accion, tenantId, datos}` con esquema zod y rol; autenticación, App Check, traducción de errores y serialización. Tipa el actor con rol con `ActorConRol` del núcleo (desde T1 no importa ningún paquete de módulo). Cada `llamadas/<m>.ts` es el **borde del módulo**: su tabla de acciones, y nada más; `llamadas/comunes.ts` guarda los esquemas zod compartidos por los bordes.
- **`config.ts`, `origen.ts`, `serializar.ts`, `autenticacion.ts`, `http/{router,tipos}.ts`**: parámetros y secretos por nombre, IP del cliente, JSON seguro, sesión y roles, enrutamiento HTTP puro sobre `PeticionHttp`. El dueño de cada ruta sale de `rutasHttp` de los manifiestos (`plataforma/coordinador/rutas-http.ts`) y `router.ts` controla el encendido por tenant (falla cerrado; `docs/produccion/funciones.md` §4).
- **`programadas/`** (T1 partió `programadas.ts`): `tenants.ts` (coordinador: `listarTenants`/`porTenant`, recorrer tenants para ejecutar lo de cada zona sin que uno roto detenga a los demás); `cotizacion.ts` (coordinador: `ejecutarCotizaciones` corre el núcleo `actualizarMercado` por tenant y a las 07:00 dispara la reconstrucción diaria de consola a través del borde; el plano la preveía núcleo, ver §6.5 del plano); `consola.ts` (borde del módulo consola: `ejecutarLimpiezaSubidas`, `ejecutarTemporizadorSitio`, y expone `ejecutarReconstruccion` para el coordinador).

## El bus de eventos (`servidor/bus.ts`)

1. Un módulo **publica dentro de la transacción del negocio** en `tenants/{t}/eventos/{id}` con `publicarEvento` (núcleo); el sobre y los datos cumplen los contratos v1 congelados (`paquetes/nucleo/src/eventos/*.v1.ts`).
2. El disparador `eventos` (`onDocumentCreated`, con `retry`) lee el documento, lo **valida contra el contrato completo** (sobre, tipo, versión, datos); lo que está fuera de contrato se descarta y se registra, nunca llega a un consumidor ni se relanza.
3. Se entrega a los consumidores que piden ese tipo (`consumidoresDePlataforma`: Recibos para `venta.confirmada` y `venta.anulada`; Inventarios para `venta.anulada` y `pedido.confirmado`). `consumir` (núcleo) es **idempotente por id y por clave**, así la entrega «al menos una vez» de Functions es segura; tras cinco fallos de un consumidor con un evento, queda «descartado» y deja de reintentarse.
4. Si un consumidor falla, se intentan todos y se relanza el primer error después: los que terminaron quedan registrados como procesados y no se repiten.

`venta.confirmada` **no** la consume Inventarios: el POS descuenta stock con el puerto dentro de su propia transacción (coherencia fuerte donde importa; eventos donde alcanza la eventual).

## Reglas para quien toca el coordinador

- Importa paquetes de módulo solo desde `registro.ts`, `coordinador/*.ts` y `entorno.ts`; en todo lo demás, por puertos o montando bordes (`pruebas/fronteras/zonas.ts`, `COMPOSITORES`).
- Un puerto nuevo o un cambio de forma de un puerto se documenta en la tabla de arriba en el mismo PR.
- Las Functions expuestas, App Check, autenticación y cabeceras son superficie de seguridad: revisión del agente `seguridad` en cada PR que las toque.
- Cero cambios de contrato con NovuChat sin decisión de Andres.
