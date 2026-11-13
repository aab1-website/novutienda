# Alerta de cotización (Cloud Monitoring) — procedimiento, sin crear

Estado: **creada en staging el 05/11/2026** con autorización de Andres (botón): canal de correo del propietario, política de registro
(`conditionMatchedLog`, 1 aviso por hora, cierre automático a 7 días) y política de latido (`conditionAbsent` sobre
`run.googleapis.com/request_count` del servicio `cotizacion`, **23 h**: Cloud Monitoring no admite más de 23 h 30 min; como la función corre
tres veces al día, 23 h sigue detectando un día sin ejecuciones). En producción se repite el procedimiento con su proyecto. Los nombres de
canal y políticas no se guardan en el repositorio.

## Qué emite el sistema

Cada corrida de `cotizacion` (07:00, 13:00 y 19:00 de La Paz) llama `actualizarMercado` con el `Notificador` real. Ante una falla de fuente o una
cotización más vieja que el límite (4 días hábiles) el notificador:

1. escribe `tenants/{t}/alertas/{tipo}-{mercado}-{aaaa-mm-dd-hh}` (un documento por tipo, mercado y hora; lo lee el panel por `consola.alertas`);
2. registra una entrada de severidad **ERROR** con la forma:

```json
{ "severity": "ERROR", "message": "alerta de cotización",
  "alerta": "cotizacion", "tipo": "fallas_fuente | cotizacion_vieja | corrida_fallida",
  "mercado": "BO | AR", "detalle": "…", "fallas": ["BCB: …"], "tenantId": "…" }
```

`corrida_fallida` lo emite la propia función si una corrida lanza un error inesperado (y entonces la ejecución figura como fallida en Scheduler).

## Cómo se crea la alerta por correo

Costo: las alertas basadas en registros de Cloud Monitoring no cobran por la política; el correo es gratuito. Verificar los precios vigentes en la
documentación oficial de Google Cloud con fecha antes de crearla.

1. **Canal de notificación** (correo) en el proyecto: `gcloud beta monitoring channels create --display-name="Cotización <CLIENTE>" --type=email --channel-labels=email_address=<CORREO_DEL_CLIENTE> --project=<PROYECTO>` (el correo y el proyecto salen de las variables de GitHub; no se guardan en el repositorio).
2. **Política de alerta basada en registros** sobre este filtro:

```
resource.type="cloud_run_revision"
resource.labels.service_name="cotizacion"
severity>=ERROR
jsonPayload.alerta="cotizacion"
```

   Crear con `gcloud alpha monitoring policies create --policy-from-file=<archivo>` (condición `conditionMatchedLog`, `notificationRateLimit.period` de 1 hora para no
   repetir el aviso, `autoClose` de 7 días) o desde la consola: Monitoring → Alertas → Crear política → «Coincidencia de registro».
3. **Latido** (política de 2.º nivel, recomendada por la política de monitoreo de Andres): una política de **ausencia de datos** sobre la métrica de
   ejecuciones de `cotizacion` (`run.googleapis.com/request_count` con el filtro del servicio) que avise si pasan más de 26 horas sin una ejecución. Así el
   silencio total también es una alerta.
4. **Prueba**: ejecutar `cotizacion` en staging con una fuente inalcanzable (o escribir una entrada de prueba con el mismo filtro) y comprobar que llega el correo.

Los avisos ante fallas de las fuentes llegan también al panel (`consola.alertas`) y al tablero.
