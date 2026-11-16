# Ciclo de vida de un tenant (ficha del operador)

El estado vive en `tenants/{t}.estado` y es obligatorio. Lo cambia solo el operador con `scripts/estado-tenant.mjs`
(lógica en `plataforma/operador/estado.ts`). Decisiones de fondo: `docs/arquitectura/decisiones.md` (entrada del ciclo de vida).

## Estados y transiciones

| Estado | Significado |
|---|---|
| `activo` | Opera con normalidad. Es el estado con el que el alta crea el tenant. |
| `suspendido` | Sus usuarios no operan; el tenant se conserva y puede reactivarse. |
| `baja` | Terminal: no admite ninguna transición posterior. |

Transiciones: `activo` <-> `suspendido`, y `activo` o `suspendido` -> `baja`. La regla es `transicionValida` del núcleo.
Pedir el estado en que el tenant ya está no hace nada, salvo con `--aplicar` en suspendido o baja, que repite la revocación de sesiones. Si el documento no existe o no tiene un estado válido, el script se detiene
(corra primero el alta, `docs/produccion/alta-de-tenant.md`).

## Quién autoriza

Opera la persona del operador de NovuTienda, siempre con el «sí» de Andres antes de `--aplicar` (escribe en un servicio externo). La baja,
por ser irreversible, exige además repetir el id del tenant. Cada cambio queda auditado (`tenant.estado`, con estado anterior y nuevo).

## Uso de `scripts/estado-tenant.mjs`

```
NOVUTIENDA_AMBIENTE=staging GCP_PROJECT_ID_STAGING=<proyecto> GOOGLE_CLOUD_PROJECT=<proyecto> node scripts/estado-tenant.mjs <tenant> --proyecto <proyecto> --a suspendido --verificar
NOVUTIENDA_AMBIENTE=staging GCP_PROJECT_ID_STAGING=<proyecto> GOOGLE_CLOUD_PROJECT=<proyecto> node scripts/estado-tenant.mjs <tenant> --proyecto <proyecto> --a suspendido --aplicar
```

- `--a suspendido|activo|baja` es obligatorio. Sin bandera, o con `--verificar`, **solo lee**: muestra la transición (`estado: de -> a`) y no escribe.
- `--aplicar` escribe: en una transacción relee el estado (si cambió, aborta y pide reintentar), lo actualiza y audita.
- `--confirmar-baja <tenant>`: obligatorio para `--a baja`; debe repetir exactamente el id del tenant. Sin él la baja se rechaza, incluso sin `--aplicar`.
- `--confirmar-produccion`: parte de la guardia de entorno compartida con el alta (`scripts/guardia-operador.mjs`); en producción exige además
  `NOVUTIENDA_AMBIENTE=produccion` y `GCP_PROJECT_ID_PROD` igual al proyecto. Ver `docs/produccion/alta-de-tenant.md`.
- No imprime identificadores de proyecto ni de tenant.

### Sesiones

Al pasar a `suspendido` o a `baja`, tras escribir el estado se revocan los refresh tokens de los miembros listados en
`tenants/{t}/miembros`. Al reactivar no se revoca nada. La revocación es una defensa adicional: **no corta el ID token vigente** (dura hasta
1 h) **ni alcanza a quien tenga claim sin documento en `miembros`**. El control efectivo es la lectura del estado en las reglas y en los callables.
Si la revocación falla para alguien, el estado ya quedó escrito y el script termina con error y el conteo de fallidos: repita el mismo
comando con `--aplicar`, que revoca de nuevo (es idempotente), hasta que no haya error, o revoque desde la consola.

## Ventana residual

El rechazo no es instantáneo en todas partes:

- **Reglas de Firestore: inmediato.** Leen `tenants/{t}` en cada evaluación, sin caché.
- **Callables y HTTP del servidor: hasta 60 s al suspender.** El estado se lee con la misma caché por instancia que el encendido de módulos
  (ver «Apagar o encender un módulo» en `alta-de-tenant.md`); la caché positiva dura 60 s.
- **Reactivar: hasta 10 s.** Es la caché negativa (un tenant suspendido se cachea como no operativo 10 s) y demora la reactivación en callables y HTTP.
- Un ID token ya emitido sigue vigente hasta 1 h, pero sin estado operativo las reglas y los callables lo rechazan igual.

Es el comportamiento esperado, no un fallo: espere y vuelva a probar antes de reportar.

## Orden de despliegue

Antes de fusionar o desplegar este cambio, los tenants existentes sin `estado` deben migrarse con `alta-tenant --verificar` y luego
`--aplicar` (normaliza el estado ausente a `activo`; ver `alta-de-tenant.md`). Quien no se migre queda denegado.

## Excepciones y alcance

- **El propietario de la plataforma pasa solo ante un tenant suspendido** y solo en acciones de propietario (para poder atender, corregir y reactivar). Ante un tenant inexistente, dado de baja o con documento inválido se rechaza. Un usuario del tenant no pasa.
- **`storage.rules` no cambia.** La ventana residual en Storage es la vigencia de una reserva de subida ya emitida antes de suspender.
- **El sitio publicado y los medios públicos siguen visibles al suspender:** lo que ya ve el público se acepta tal cual. Para retirarlos hay que
  despublicar o reconstruir el sitio por separado (`docs/produccion/reconstruccion-sitio.md`).

## Verificar el redondeo de un tenant (`scripts/verificar-comercial.mjs`)

Solo lectura, solo staging o emulador: `NOVUTIENDA_AMBIENTE=staging GCP_PROJECT_ID_STAGING=<proyecto> GOOGLE_CLOUD_PROJECT=<proyecto> node scripts/verificar-comercial.mjs <tenant> --proyecto <proyecto>`.
Imprime la forma del tenant (anterior o `comercial`), el plan y una línea por moneda (`<MONEDA>: cumple D7` o `NO cumple (motivo)`); no vuelca documentos.
Salida 0 si todo cumple, 1 si alguna moneda no cumple, 2 si no pudo leer o el entorno no es válido. Lógica en `plataforma/operador/verificar-comercial.ts`.
