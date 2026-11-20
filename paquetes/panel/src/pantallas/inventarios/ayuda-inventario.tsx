import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Dialogo } from '../../ui/dialogo.js';
import { OPCIONES_ALMACEN } from './nombres.js';

/** Temas de la ayuda «Cómo funciona el inventario». Texto fijo: no depende de los datos del comercio. */
export const TEMAS_AYUDA: readonly { readonly titulo: string; readonly texto: string }[] = [
  { titulo: 'Almacenes', texto: `La mercadería está repartida en ${OPCIONES_ALMACEN.length} almacenes: ${OPCIONES_ALMACEN.map((o) => o.texto).join(', ')}. Cada producto tiene su existencia en cada uno.` },
  { titulo: 'Ingreso', texto: 'Registra mercadería que entra a un almacén. Se elige el almacén de destino y los productos con su cantidad (los de serie, con sus series).' },
  { titulo: 'Traspaso', texto: 'Mueve mercadería de un almacén a otro. Resta del origen y suma al destino en una sola operación. Durante un conteo, el traspaso desde o hacia ese almacén queda bloqueado, salvo para el administrador.' },
  { titulo: 'Ajuste', texto: 'Corrige una existencia que no coincide con la realidad. Solo lo hace el administrador y queda con motivo en el historial. Los productos con serie no se ajustan: use ingreso o merma.' },
  { titulo: 'Conteo ciego', texto: 'Se cuenta un almacén sin ver lo que el sistema espera. Mientras dura, el cajero y el supervisor no ven las existencias de ese almacén ni los totales; el administrador sí. Al cerrar, vuelven a verse.' },
  { titulo: 'Series', texto: 'Los productos con serie (por ejemplo, celulares o televisores) se venden y se traspasan por número de serie. «Existencias por almacén» muestra solo cantidades.' },
  { titulo: 'Dónde se ve cada cosa', texto: '«Productos y existencias» muestra todos los almacenes y el total por producto; durante un conteo, el cajero y el supervisor no ven el total ni el almacén en conteo. «Existencias por almacén» muestra un almacén por vez. «Registro de acciones» muestra cada ingreso, traspaso, ajuste y venta, y «Conteo ciego» el conteo de cada almacén.' },
];

/** Botón «Cómo funciona el inventario» para el encabezado de Inventario; abre un panel lateral y devuelve el foco al cerrar. */
export function AyudaInventario(): JSX.Element {
  const [abierta, setAbierta] = useState(false);
  return (
    <>
      <button type="button" class="boton boton-secundario" aria-haspopup="dialog" onClick={() => setAbierta(true)}>Cómo funciona el inventario</button>
      {abierta && (
        <Dialogo titulo="Cómo funciona el inventario" variante="lateral" foco="cerrar" onCerrar={() => setAbierta(false)}>
          <div class="ayuda-inventario">
            {TEMAS_AYUDA.map((t) => (
              <section key={t.titulo}>
                <h3>{t.titulo}</h3>
                <p>{t.texto}</p>
              </section>
            ))}
          </div>
        </Dialogo>
      )}
    </>
  );
}
