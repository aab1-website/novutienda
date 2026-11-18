import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { PlantillaRecibo, Recibo } from '../../api/tipos.js';
import { Alerta, Area, Boton, Cargando, ErrorCarga, Seccion } from '../../ui/comun.js';
import { useAvisos } from '../../ui/avisos.js';
import { useApp } from '../../ui/contexto.js';
import { useCambiosSinGuardar } from '../../ui/guardia.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { ReciboVista } from './recibo-vista.js';

const opc = (t: string): string | undefined => (t.trim() === '' ? undefined : t.trim());

/** Recibo de ejemplo con datos ficticios; solo la plantilla en edición viene de la persona. */
export function reciboDeEjemplo(plantilla: PlantillaRecibo): Recibo {
  return {
    reciboId: 'ejemplo',
    tenantId: 'ejemplo',
    ventaId: 'ejemplo',
    numero: 'A-000123',
    estado: 'EMITIDO',
    fecha: '2026-01-15',
    emitidoEn: '2026-01-15T15:30:00.000Z',
    moneda: 'BOB',
    total: 25000,
    descuento: { monto: 1000, motivo: 'Ejemplo de descuento' },
    cotizacion: null,
    lineas: [
      { productoId: 'ejemplo-1', nombre: 'Producto de ejemplo con serie', cantidad: 1, precioUnitario: 20000, subtotal: 20000, series: ['SN-0001'], garantiaMeses: 12, garantiaHasta: '2027-01-15' },
      { productoId: 'ejemplo-2', nombre: 'Accesorio de ejemplo', cantidad: 2, precioUnitario: 3000, subtotal: 6000, series: [] },
    ],
    pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 25000 }],
    cliente: { nombre: 'Cliente de ejemplo' },
    plantilla,
    envioWhatsapp: { estado: 'no_enviado' },
  };
}

/**
 * Pestaña «Plantilla del recibo»: formulario de edición y, al lado, un recibo de ejemplo completo
 * que cambia mientras se escribe. Sin props.
 */
export function PestanaPlantillaRecibo(): JSX.Element {
  const { api } = useApp();
  const pl = useCarga(() => api.llamar('leerPlantilla', {}), []);
  const accion = useAccion();
  const avisos = useAvisos();
  const [p, setP] = useState<PlantillaRecibo | null>(null);
  const [base, setBase] = useState<string | null>(null);
  const avisoGuardado = useRef(0);
  useEffect(() => { if (pl.datos !== undefined) { setP(pl.datos); setBase(JSON.stringify(pl.datos)); } }, [pl.datos]);
  const sucio = p !== null && base !== null && JSON.stringify(p) !== base;
  const { marcarGuardado } = useCambiosSinGuardar(sucio);
  if (pl.cargando || p === null) return pl.error ? <ErrorCarga error={pl.error} reintentar={pl.recargar} /> : <Cargando />;
  const n = p.negocio;
  const poner = (nueva: PlantillaRecibo): void => {
    if (avisoGuardado.current !== 0) avisos.cerrar(avisoGuardado.current);
    avisoGuardado.current = 0;
    setP(nueva);
  };
  const sinNombre = n.nombre.trim() === '';
  const guardar = (e: Event): void => {
    e.preventDefault();
    if (sinNombre) return;
    const enviado = JSON.stringify(p);
    void accion.ejecutar(async () => {
      // El negocio y el logo se editan en «Datos del negocio»: se toman de lo guardado ahora, no de lo cargado al abrir.
      // Límite aceptado: entre releer y escribir puede colarse otro guardado, porque el servidor reemplaza el registro completo.
      const vigente = await api.llamar('leerPlantilla', {});
      const plantilla: PlantillaRecibo = {
        negocio: vigente.negocio,
        ...(vigente.logoUrl !== undefined ? { logoUrl: vigente.logoUrl } : {}), ...(opc(p.pie ?? '') ? { pie: opc(p.pie ?? '') as string } : {}),
        ...(opc(p.politicaGarantia ?? '') ? { politicaGarantia: opc(p.politicaGarantia ?? '') as string } : {}), ...(opc(p.politicaCambios ?? '') ? { politicaCambios: opc(p.politicaCambios ?? '') as string } : {}),
      };
      await api.llamar('guardarPlantilla', { plantilla });
      marcarGuardado();
      setBase(enviado);
      avisoGuardado.current = avisos.ok('Plantilla guardada.');
    }, { error: 'ambos' });
  };
  return (
    <Seccion titulo="Plantilla del recibo">
      <p class="texto-suave">Los recibos ya emitidos conservan la plantilla que tenían al emitirse. La serie y la numeración se definen en la configuración del POS. El nombre, la dirección, el teléfono, el NIT y el logo se editan una sola vez en «Datos del negocio», en la pestaña «Negocio y POS».</p>
      <form class="formulario" onSubmit={guardar} noValidate>
        <Area etiqueta="Pie de página" valor={p.pie ?? ''} onInput={(v) => poner({ ...p, pie: v })} />
        <Area etiqueta="Política de garantía" valor={p.politicaGarantia ?? ''} onInput={(v) => poner({ ...p, politicaGarantia: v })} />
        <Area etiqueta="Política de cambios" valor={p.politicaCambios ?? ''} onInput={(v) => poner({ ...p, politicaCambios: v })} />
        {accion.error && <Alerta>{accion.error}</Alerta>}
        <Boton tipo="submit" ocupado={accion.ocupado} motivo={sinNombre ? 'Guarde primero los Datos del negocio' : undefined}>Guardar plantilla</Boton>
      </form>
      <section aria-label="Vista previa del recibo">
        <h3>Vista previa</h3>
        <p class="texto-suave">Es un ejemplo con datos ficticios; cambia mientras escribe.</p>
        <ReciboVista recibo={reciboDeEjemplo(p)} />
      </section>
    </Seccion>
  );
}
