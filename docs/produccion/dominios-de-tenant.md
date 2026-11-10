# Dominios de un tenant (ficha del operador)

La colección raíz `dominios/{host}` guarda el mapeo host -> tenant: `{ tenantId, creado, actualizado }`. Es dato del operador
(manifiesto `plataforma`): las reglas de Firestore la niegan a todo cliente (`allow read, write: if false`) y solo la escribe el
servidor. La lógica vive en `plataforma/operador/dominio.ts` y el script es `scripts/dominio-tenant.mjs`. El enrutador del coordinador lee
la tabla: el tenant de las rutas públicas sale del host (`x-forwarded-host`), y un host sin mapeo responde `404`. El host elige el tenant pero NO autentica: la función es pública y, en pedidos, la firma sigue siendo obligatoria. Un cambio de mapeo tarda hasta 60 s en verse por instancia. Hay un límite global por instancia (300/min) y por origen (60/min) para hosts fuera de caché.

## Paso A′ y compuerta D-B1

- **Antes de desplegar**, mapear cada host que sirve el sitio del tenant: `<sitio>.web.app`, `<sitio>.firebaseapp.com` y el dominio propio (ejemplo: `tienda-a.test` para `tenant-a`). Sin el mapeo, `/api/cotizacion`, `/api/disponibilidad`, `/api/contacto` y `/api/novuchat/v1/pedidos/confirmar` dan `404`.
- **Compuerta D-B1 (la impone el código):** `dominio-tenant.mjs` rechaza mapear el host de un segundo tenant con `inventarios` encendido mientras el secreto de pedidos sea compartido. No mapear el host de un segundo tenant con `inventarios` encendido hasta el PR D (secreto de firma por tenant). Hoy el secreto de pedidos es compartido y una firma de un tenant valdría 5 minutos en otro.
- **NovuChat** debe configurar `baseUrl` con el dominio del sitio del tenant, no con la URL de la función.
- **Riesgo R1:** la cabecera de host que llega tras Firebase Hosting no está confirmada en la documentación oficial; la verificación en staging está en `docs/produccion/pase-a-staging.md` (§11).

## Reglas

- El host va en minúsculas, sin esquema, puerto, ruta ni consulta; formato DNS (al menos dos etiquetas; no se aceptan IP).
- Un host pertenece a un solo tenant. Si ya es de otro, se rechaza salvo `--reasignar`.
- El tenant debe existir y estar `activo` o `suspendido`; uno en `baja` no admite dominios (la baja es terminal).
- Cada cambio queda auditado en el tenant afectado (`dominio.asignar`, `dominio.reasignar`, `dominio.eliminar`), sin el host (la entrada apunta a la colección `dominios`).

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
exista o no esté `activo`; la lectura del estado y la escritura van en una sola transacción. El tope de dos tokens activos se cuenta antes, fuera de ella: dos registros simultáneos podrían superarlo (riesgo aceptado: solo opera el operador). Desactivar y listar no exigen estado, para poder cerrar un token de un tenant suspendido.
