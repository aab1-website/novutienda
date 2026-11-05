# Contrato canónico: propiedades (opciones) de producto — v1.1 aditiva (05/11/2026)

Estado: **especificación acordada** entre NovuTienda y NovuChat (decisión de Andres, 05/11/2026, en la sesión de NovuChat: esquema común, dos módulos). Vale para ambas plataformas: NovuTienda lo implementa en su catálogo (fuente para tenants con tienda, POS o almacenes); NovuChat implementa la versión mínima del mismo esquema en su catálogo propio (clientes sin tienda). **Nada de esto está construido** en ninguno de los dos lados. El alcance para el tenant `casa-bermejo` (fuera del PDF firmado) es una decisión aparte de Andres: no se activa por tenant sin ella.

Extiende `docs/integracion-novuchat.md` sin modificar v1: todo campo nuevo es opcional y un consumidor que lo ignore sigue funcionando.

## 1. Esquema del producto (`grupos`)

```
grupos?: [{
  id:          string  ^[a-z0-9][a-z0-9-]{0,39}$   estable, nunca reutilizado dentro del producto
  nombre:      string  1..40
  tipo:        'precio' | 'especificacion'
  obligatorio: boolean
  min:         entero ≥ 0
  max:         entero ≥ 1          // max = 1: elección única; > 1: múltiple. min ≤ max ≤ nº de opciones
  orden:       entero ≥ 0
  opciones: [{
    id:          string  mismo formato; único dentro del grupo
    nombre:      string  1..40
    disponible:  boolean           // «sin queso hoy» sin desactivar el producto
    orden:       entero ≥ 0
    porDefecto?: boolean           // a lo sumo una por grupo cuando max = 1
    // Solo tipo = 'precio'. En 'especificacion' está PROHIBIDO.
    deltaCentavos?: entero         // en la moneda del catálogo servido; puede ser 0 o negativo (ver §3)
  }]
}]
```

Topes duros (reglas de base de datos y servidor, con prueba que los niega): máximo **6 grupos** por producto, **12 opciones** por grupo, **40 caracteres** por nombre. Iguales para todos los planes.

Almacenamiento interno: cada plataforma guarda el delta en su unidad (NovuTienda: `deltaUsd` con dos decimales, porque sus precios base son USD por mercado; NovuChat: en la moneda del tenant). **En el contrato siempre viaja `deltaCentavos` ya convertido.**

## 2. Catálogo (`GET /api/novuchat/v1/catalogo?mercado=`)

El ítem de v1 agrega `grupos?` con la forma del §1. `version` sigue siendo `1` (se documenta como 1.1). Solo se publican productos `disponible`; dentro de ellos, las opciones no disponibles viajan con `disponible: false` para que el asistente pueda decir «hoy no hay».

## 3. Cálculo (siempre por código, en centavos enteros)

Para una línea `{ productoId, cantidad, opciones: [opcionId…] }`:

1. Validar contra el catálogo leído: cada `opcionId` existe en un grupo del producto y está `disponible`; cada grupo `obligatorio` tiene al menos `min` elegidas; ninguno supera `max`; sin repetidos. Errores tipados: `opcion_invalida` (no existe, obligatorio sin elegir, fuera de mín/máx, repetida), `opcion_no_disponible`.
2. `precioUnitarioCentavos = precioCentavos + Σ deltaCentavos` de las opciones elegidas de tipo `precio`.
3. `subtotalCentavos = precioUnitarioCentavos × cantidad`.
4. **Redondeo por componente**: `precioCentavos` y cada `deltaCentavos` llegan ya redondeados con la política del mercado (BOB: dos decimales; ARS: múltiplo de 100 al más cercano). La suma de enteros no se vuelve a redondear, así ambos lados obtienen el mismo total.
5. Delta negativo permitido («sin queso −3») con tope: `precioUnitarioCentavos ≥ 0`; si una combinación lo viola, la plataforma dueña del catálogo la rechaza al guardar el producto, no en la venta.

El modelo de lenguaje y el navegador **nunca** envían precios ni nombres: solo ids y cantidades.

## 4. Pedido congelado

La línea del pedido (y del recibo, en NovuTienda) guarda las opciones **congeladas** al confirmar, para que un cambio posterior del catálogo no reescriba pedidos viejos:

```
opciones: [{ grupoId, grupoNombre, opcionId, nombre, deltaCentavos }]
detalle:  string   // generado por código, p. ej. «Pollo; con queso +5,00»; nunca libre
```

La nota libre del cliente («sin cebolla»), si existe, va aparte (`nota`, ≤ 120), no cambia el precio y se rotula como pedido al comercio, no promesa.

## 5. Confirmar pedido (`POST /api/novuchat/v1/pedidos/confirmar`)

El ítem de v1 `{ productoId, cantidad }` agrega `opciones?: [opcionId…]` (solo ids). La plataforma valida con el §3 y responde: `400 opcion_invalida`, `409 opcion_no_disponible` (misma semántica que `faltantes`: no escribe nada, el flujo pasa al vendedor). Firma HMAC, idempotencia por `pedidoId` y descuento de stock (por producto y almacén `tienda`) sin cambio: **las opciones no tienen stock propio**.

## 6. Fuera de este contrato

Stock por opción, variantes reales (talla × color con precio propio), modificadores anidados, combos y ofertas, imagen por opción, carrito en el sitio de NovuTienda. Cualquiera exige un contrato v2 y decisión de Andres.

## 7. Pruebas de contrato compartidas

Cada lado mantiene fixtures con estos casos y los niega en CI: 7.º grupo rechazado; 13.ª opción rechazada; `deltaCentavos` en grupo `especificacion` rechazado; combinación con precio negativo rechazada al guardar; pedido con opción inexistente → 400; con opción no disponible → 409; pedido sin `opciones` calcula igual que v1.
