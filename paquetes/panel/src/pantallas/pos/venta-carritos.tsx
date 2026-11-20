import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { CarritoGuardado } from '../../api/tipos.js';
import { Alerta, Boton, Campo } from '../../ui/comun.js';
import { useAccion } from '../../ui/hooks.js';
import { TEXTO_GUARDADO, TOPE_CARRITOS, lineasGuardadas, textoProductos, type CarritoServidor } from './carritos.js';

/**
 * Cancelar con motivo obligatorio, sin ventanas del navegador: el botón abre un formulario en la misma página.
 * `nombre` completa el nombre accesible del botón («Cancelar carrito Cliente 2»).
 */
export function CancelarConMotivo({ nombre, textoBoton = 'Cancelar carrito', alCancelar }: { nombre: string; textoBoton?: string; alCancelar: (motivo: string) => Promise<void> }): JSX.Element {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const accion = useAccion();
  if (!abierto) {
    return (
      <Boton chico variante="peligro" etiqueta={`${textoBoton} ${nombre}`} onClick={() => setAbierto(true)}>
        {textoBoton}
      </Boton>
    );
  }
  const motivoLimpio = motivo.trim();
  return (
    <form class="formulario caja-aviso" onSubmit={(e) => e.preventDefault()} noValidate aria-label={`Cancelar ${nombre}`}>
      <p>Se perderá lo que lleva {nombre}. Escriba por qué lo cancela.</p>
      <Campo etiqueta={`Motivo de la cancelación de ${nombre}`} valor={motivo} onInput={setMotivo} requerido maxLength={200} />
      {accion.error && <Alerta>{accion.error}</Alerta>}
      <div class="fila">
        <Boton
          chico
          variante="peligro"
          etiqueta={`Confirmar cancelación de ${nombre}`}
          ocupado={accion.ocupado}
          motivo={motivoLimpio === '' ? 'Escriba el motivo de la cancelación.' : undefined}
          onClick={() => void accion.ejecutar(async () => { await alCancelar(motivoLimpio); setAbierto(false); setMotivo(''); })}
        >
          Confirmar cancelación
        </Boton>
        <Boton chico variante="secundario" etiqueta={`Volver sin cancelar ${nombre}`} onClick={() => { setAbierto(false); setMotivo(''); }}>
          Volver sin cancelar
        </Boton>
      </div>
    </form>
  );
}

/** Nombre del carrito con su aviso de privacidad y el cambio de nombre. */
function Renombrar({ etiqueta, alGuardar }: { etiqueta: string; alGuardar: (e: string) => Promise<void> }): JSX.Element {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState(etiqueta);
  const accion = useAccion();
  if (!abierto) {
    return (
      <Boton chico variante="secundario" etiqueta={`Renombrar ${etiqueta}`} onClick={() => { setTexto(etiqueta); setAbierto(true); }}>
        Renombrar
      </Boton>
    );
  }
  const limpio = texto.trim();
  return (
    <form class="formulario" onSubmit={(e) => { e.preventDefault(); if (limpio !== '') void accion.ejecutar(async () => { await alGuardar(limpio); setAbierto(false); }); }} noValidate>
      <Campo etiqueta="Nombre del carrito" valor={texto} onInput={setTexto} requerido maxLength={60} />
      {accion.error && <Alerta>{accion.error}</Alerta>}
      <div class="fila">
        <Boton chico tipo="submit" ocupado={accion.ocupado} deshabilitado={limpio === ''}>Guardar nombre</Boton>
        <Boton chico variante="secundario" onClick={() => setAbierto(false)}>Cerrar sin cambiar</Boton>
      </div>
    </form>
  );
}

/** Barra con todos los carritos abiertos del turno: cambiar, abrir uno nuevo, renombrar y cancelar. */
export function BarraCarritos({ c, lineasActivo }: { c: CarritoServidor; lineasActivo: number }): JSX.Element {
  const accion = useAccion();
  const llenos = c.carritos.length >= TOPE_CARRITOS;
  const activo = c.activo;
  return (
    <section class="barra-carritos" aria-label="Carritos abiertos">
      <ul class="lista-simple fila carritos-pestanas">
        {c.carritos.map((k: CarritoGuardado) => {
          const esActivo = k.carritoId === activo?.carritoId;
          const n = esActivo ? lineasActivo : lineasGuardadas(k);
          return (
            <li key={k.carritoId}>
              <button
                type="button"
                class={`boton boton-chico ${esActivo ? 'boton-cta' : 'boton-secundario'}`}
                aria-pressed={esActivo}
                onClick={() => void accion.ejecutar(() => c.activar(k.carritoId))}
              >
                {k.etiqueta} · {textoProductos(n)}
              </button>
            </li>
          );
        })}
        <li>
          <Boton chico variante="secundario" ocupado={accion.ocupado} onClick={() => void accion.ejecutar(c.crear)} motivo={llenos ? `Hay ${TOPE_CARRITOS} carritos abiertos: cobre o cancele alguno para abrir otro.` : undefined}>
            Nuevo carrito
          </Boton>
        </li>
      </ul>
      {accion.error && <Alerta>{accion.error}</Alerta>}
      {c.aviso !== null && (
        <Alerta tipo="info">
          {c.aviso}
          <Boton chico variante="secundario" onClick={c.descartarAviso}>Entendido</Boton>
        </Alerta>
      )}
      {activo !== undefined && (
        <div class="fila fila-alinear carrito-activo">
          <strong>{activo.etiqueta}</strong>
          <span class={`estado-guardado estado-${c.estado}`} role="status" data-prueba="estado-guardado">{TEXTO_GUARDADO[c.estado]}</span>
          <Renombrar key={activo.carritoId + activo.etiqueta} etiqueta={activo.etiqueta} alGuardar={(e) => c.renombrar(activo.carritoId, e)} />
          <CancelarConMotivo nombre={activo.etiqueta} alCancelar={(m) => c.cancelar(activo.carritoId, m)} />
        </div>
      )}
      <p class="texto-suave">No escriba datos personales del cliente en el nombre del carrito.</p>
    </section>
  );
}
