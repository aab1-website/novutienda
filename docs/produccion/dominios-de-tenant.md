# Dominios de un tenant (ficha del operador)

La colección raíz `dominios/{host}` guarda el mapeo host -> tenant: `{ tenantId, creado, actualizado }`. Es dato del operador
(manifiesto `plataforma`): las reglas de Firestore la niegan a todo cliente (`allow read, write: if false`) y solo la escribe el
servidor. La lógica vive en `plataforma/operador/dominio.ts` y el script es `scripts/dominio-tenant.mjs`. El enrutador que lee
la tabla llega en un PR posterior; este solo prepara los datos.

## Reglas

- El host va en minúsculas, sin esquema, puerto, ruta ni consulta; formato DNS (al menos dos etiquetas; no se aceptan IP).
- Un host pertenece a un solo tenant. Si ya es de otro, se rechaza salvo `--reasignar`.
- El tenant debe existir y estar `activo` o `suspendido`; uno en `baja` no admite dominios (la baja es terminal).
- Cada cambio queda auditado en el tenant afectado (`dominio.asignar`, `dominio.reasignar`, `dominio.eliminar`), sin el host.

## Uso

Entorno como `alta-tenant`: `GOOGLE_CLOUD_PROJECT` igual a `--proyecto`, `NOVUTIENDA_AMBIENTE=staging|emulador` (producción solo
con `GCP_PROJECT_ID_PROD` y `--confirmar-produccion`, dentro de su pase). Sin bandera, o con `--verificar`, solo lee.

```
node scripts/dominio-tenant.mjs --host <host> --tenant <tenant> --proyecto <proyecto> --verificar
node scripts/dominio-tenant.mjs --host <host> --tenant <tenant> --proyecto <proyecto> --aplicar
node scripts/dominio-tenant.mjs --host <host> --tenant <otro> --proyecto <proyecto> --aplicar --reasignar
```

Antes de `--aplicar` se pide el «sí» de Andres (escribe en un servicio externo).

## Cómo se deshace

- Asignación: `--host <host> [--tenant <tenant>] --eliminar --aplicar` borra el mapeo (si se indica `--tenant`, debe ser el dueño).
- Reasignación: repetir con `--reasignar` hacia el tenant anterior.
- La auditoría no se borra: queda el rastro de cada movimiento.

## Registro de tokens de NovuChat

`plataforma/funciones/scripts/token-novuchat.mjs` aplica la misma guardia de entorno y, en `registrar`, rechaza un tenant que no
exista o no esté `activo`. Desactivar y listar no exigen estado, para poder cerrar un token de un tenant suspendido.
