import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { ConsultaArchivo, EstadoEnvio, Recibo } from '../../api/tipos.js';
import { Boton, Campo, ConCarga, Seccion, fechaHora } from '../../ui/comun.js';
import { Dialogo } from '../../ui/dialogo.js';
import { Tabla } from '../../ui/tabla.js';
import { useApp } from '../../ui/contexto.js';
import { useCarga } from '../../ui/hooks.js';
import { AccionesRecibo, ReciboVista } from './recibo-vista.js';
import { formatearMonto } from '../../util/dinero.js';

/** Tope de la lista que devuelve el servidor por consulta. */
export const TOPE_LISTA = 50;

const TEXTO_ENVIO: Record<EstadoEnvio, string> = {
  no_enviado: 'Sin enviar',
  sin_telefono: 'Sin teléfono del cliente',
  enlace_generado: 'Enlace preparado',
  enviado: 'Enviado',
  fallido: 'No se pudo preparar',
};

/** Texto legible del estado de envío; un valor desconocido nunca se muestra crudo. */
export function textoEnvio(estado: EstadoEnvio): string {
  return TEXTO_ENVIO[estado] ?? 'Estado desconocido';
}

function textoEstado(r: Recibo): string {
  return `${r.estado === 'ANULADO' ? 'Anulado' : 'Emitido'}${r.facturaSuma ? ` · SUMA ${r.facturaSuma}` : ''}`;
}

export function PantallaRecibos(): JSX.Element {
  const { api, usuario } = useApp();
  const [numero, setNumero] = useState('');
  const [cliente, setCliente] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [consulta, setConsulta] = useState<ConsultaArchivo>({});
  const [elegido, setElegido] = useState<string | null>(null);
  const lista = useCarga(() => api.llamar('buscarComprobantes', { consulta }), [consulta]);
  const sel: Recibo | undefined = lista.datos?.find((r) => r.reciboId === elegido);

  const buscar = (e: Event): void => {
    e.preventDefault();
    setConsulta({
      ...(numero.trim() !== '' ? { numero: numero.trim() } : {}), ...(cliente.trim() !== '' ? { cliente: cliente.trim() } : {}),
      ...(desde !== '' ? { desde } : {}), ...(hasta !== '' ? { hasta } : {}),
    });
    setElegido(null);
  };

  return (
    <div>
      <h1>{usuario.rol === 'caj' ? 'Mis recibos' : 'Archivo de recibos'}</h1>
      <Seccion titulo="Buscar">
        <form class="formulario" onSubmit={buscar} role="search" noValidate>
          <div class="cuadricula">
            <Campo etiqueta="Número de recibo" valor={numero} onInput={setNumero} ayuda="Ejemplo: A-000012" />
            <Campo etiqueta="Cliente" valor={cliente} onInput={setCliente} />
            <Campo etiqueta="Desde" tipo="date" valor={desde} onInput={setDesde} />
            <Campo etiqueta="Hasta" tipo="date" valor={hasta} onInput={setHasta} />
          </div>
          <Boton tipo="submit">Buscar</Boton>
        </form>
      </Seccion>
      <Seccion titulo="Comprobantes">
        <ConCarga carga={lista}>
          {(recibos) => (
            <Tabla
              titulo="Recibos emitidos"
              filas={recibos}
              clave={(r) => r.reciboId}
              porPagina={25}
              vistaCelular="tarjetas"
              buscar={{ etiqueta: 'Buscar en esta lista', en: (r) => [r.numero, r.cliente?.nombre ?? '', r.facturaSuma ?? ''] }}
              cortada={recibos.length >= TOPE_LISTA ? { mostradas: recibos.length, mensaje: `Se muestran los ${String(recibos.length)} recibos más recientes; puede haber más. Acote la búsqueda por número, cliente o fechas para ver el resto.` } : undefined}
              vacio={{ titulo: 'No hay recibos que coincidan' }}
              columnas={[
                { id: 'numero', titulo: 'Número', valor: (r) => r.numero, encabezadoFila: true, ordenable: true },
                { id: 'fecha', titulo: 'Fecha', valor: (r) => r.emitidoEn, celda: (r) => fechaHora(r.emitidoEn), ordenable: true },
                { id: 'cliente', titulo: 'Cliente', valor: (r) => r.cliente?.nombre ?? '—' },
                { id: 'total', titulo: 'Total', valor: (r) => r.total, celda: (r) => formatearMonto(r.total, r.moneda) },
                { id: 'estado', titulo: 'Estado', valor: (r) => textoEstado(r) },
                { id: 'whatsapp', titulo: 'WhatsApp', valor: (r) => textoEnvio(r.envioWhatsapp.estado) },
              ]}
              acciones={(r) => (
                <Boton chico variante="secundario" onClick={() => setElegido(r.reciboId)} etiqueta={`Ver recibo ${r.numero}`}>Ver</Boton>
              )}
            />
          )}
        </ConCarga>
      </Seccion>
      {sel && (
        <Dialogo titulo={`Recibo ${sel.numero}`} foco="cerrar" onCerrar={() => setElegido(null)}>
          <p>WhatsApp: {textoEnvio(sel.envioWhatsapp.estado)}.</p>
          <AccionesRecibo recibo={sel} alCambiar={lista.recargar} />
          <ReciboVista recibo={sel} registradoPor={{ qr: 'el vendedor' }} />
        </Dialogo>
      )}
    </div>
  );
}
