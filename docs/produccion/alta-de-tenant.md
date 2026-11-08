# Alta de tenant (ficha del operador)

El documento raíz `tenants/{t}` en Firestore se escribe desde `tenants/<t>/config.json` (v2) con:

```
GOOGLE_CLOUD_PROJECT=<proyecto> node scripts/alta-tenant.mjs <tenant> --verificar
GOOGLE_CLOUD_PROJECT=<proyecto> node scripts/alta-tenant.mjs <tenant> --aplicar
```

- Por omisión (y con `--verificar`) **solo lee**: muestra el diff contra el documento actual y no escribe.
- Exige `GOOGLE_CLOUD_PROJECT`; con `FIRESTORE_EMULATOR_HOST` apunta al emulador. No imprime identificadores de proyecto ni de tenant.
- `--aplicar` hace un `set` completo del documento: **retira los campos ajenos** al contrato y los módulos que sobran en el documento.
  El diff los marca («se retira») antes de escribir; léalo antes de pedir el «sí».
- Después de aplicar, vuelva a correr `--verificar` hasta que diga que el documento coincide con `config.json`.
- En producción, `--aplicar` se corre con el «sí» de Andres (escribe en un servicio externo). Es un paso del pase a producción
  (`docs/produccion/primer-tag.md`): sin el documento, todas las acciones de módulo quedan rechazadas.

## Apagar o encender un módulo

El servidor lee el encendido con una caché de 60 s por instancia de Functions y no hay forma de invalidarla. Apagar o encender un
módulo tarda hasta un minuto en notarse; **no es un fallo**. Espere y vuelva a probar.
