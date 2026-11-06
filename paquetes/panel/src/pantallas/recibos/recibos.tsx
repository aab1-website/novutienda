import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { ConsultaArchivo, Recibo } from '../../api/tipos.js';
import { Alerta, Boton, Campo, Cargando, ErrorCarga, Seccion, Vacio, fechaHora } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { useCarga } from '../../ui/hooks.js';
import { AccionesRecibo, ReciboVista } from '../../ui/recibo.js';
import { formatearMonto } from '../../util/dinero.js';
import type { Moneda } from '../../api/tipos.js';

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
        {lista.cargando && <Cargando />}
        {lista.error && <ErrorCarga error={lista.error} reintentar={lista.recargar} />}
        {lista.datos && lista.datos.length === 0 && <Vacio titulo="No hay recibos que coincidan" detalle="Cambie los filtros o haga una venta." />}
        {lista.datos && lista.datos.length > 0 && (
          <table class="tabla">
            <caption class="solo-lectores">Recibos emitidos</caption>
            <thead>
              <tr><th scope="col">Número</th><th scope="col">Fecha</th><th scope="col">Cliente</th><th scope="col" class="num">Total</th><th scope="col">Estado</th><th scope="col"><span class="solo-lectores">Acciones</span></th></tr>
            </thead>
            <tbody>
              {lista.datos.map((r) => (
                <tr key={r.reciboId}>
                  <th scope="row">{r.numero}</th>
                  <td>{fechaHora(r.emitidoEn)}</td>
                  <td>{r.cliente?.nombre ?? '—'}</td>
                  <td class="num">{formatearMonto(r.total, r.moneda as Moneda)}</td>
                  <td>{r.estado === 'ANULADO' ? 'ANULADO' : 'Emitido'}{r.facturaSuma ? ` · SUMA ${r.facturaSuma}` : ''}</td>
                  <td>
                    <Boton chico variante="secundario" onClick={() => setElegido(r.reciboId)} etiqueta={`Ver recibo ${r.numero}`}>Ver</Boton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Seccion>
      {sel && (
        <Seccion titulo={`Recibo ${sel.numero}`} acciones={<Boton chico variante="secundario" onClick={() => setElegido(null)}>Cerrar vista</Boton>}>
          {sel.envioWhatsapp.estado !== 'no_enviado' && <Alerta tipo="info">WhatsApp: {sel.envioWhatsapp.estado === 'enlace_generado' ? 'enlace preparado' : sel.envioWhatsapp.estado === 'sin_telefono' ? 'sin teléfono del cliente' : sel.envioWhatsapp.estado}.</Alerta>}
          <AccionesRecibo recibo={sel} alCambiar={lista.recargar} />
          <ReciboVista recibo={sel} registradoPor={{ qr: 'el vendedor' }} />
        </Seccion>
      )}
    </div>
  );
}
