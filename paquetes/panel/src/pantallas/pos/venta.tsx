import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { nuevoId } from '../../api/cliente.js';
import { MONEDAS, type Moneda, type MontosPorMoneda } from '../../api/tipos.js';
import { Alerta, Boton, Campo, Cargando, ErrorCarga, Pestanas, Seccion } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { textoACentavos } from '../../util/dinero.js';
import { VentaCaja, VentaCreditos } from './venta-caja.js';
import { VentaCierre } from './venta-cierre.js';
import { VentaHistorial } from './venta-historial.js';
import { VentaTerminal } from './venta-terminal.js';

const PESTANAS = [
  { id: 'terminal', titulo: 'Terminal' },
  { id: 'caja', titulo: 'Ingresos y egresos' },
  { id: 'creditos', titulo: 'Créditos' },
  { id: 'historial', titulo: 'Ventas y anulaciones' },
  { id: 'cierre', titulo: 'Cierre de turno' },
];
const NOMBRE_MONEDA: Record<Moneda, string> = { BOB: 'Bolivianos (BOB)', USD: 'Dólares (USD)', ARS: 'Pesos argentinos (ARS)' };

function Apertura({ alAbrir }: { alAbrir: () => void }): JSX.Element {
  const { api } = useApp();
  const accion = useAccion();
  const [textos, setTextos] = useState<Record<Moneda, string>>({ BOB: '', USD: '', ARS: '' });
  const [turnoId] = useState(nuevoId);
  const apertura: Partial<Record<Moneda, number>> = {};
  let invalido = false;
  for (const m of MONEDAS) {
    if (textos[m].trim() === '') continue;
    const c = textoACentavos(textos[m]);
    if (c === null) invalido = true;
    else apertura[m] = c;
  }
  const hay = Object.keys(apertura).length > 0;
  const abrir = (e: Event): void => {
    e.preventDefault();
    void accion.ejecutar(async () => {
      await api.llamar('abrirTurno', { turnoId, apertura: apertura as MontosPorMoneda });
      alAbrir();
    });
  };
  return (
    <Seccion titulo="Abrir turno">
      <form onSubmit={abrir} class="formulario" noValidate>
        <p class="texto-suave">Cuente el efectivo con que empieza la caja en cada moneda. Deje vacía la moneda que no use; escriba 0 si la usa y no hay efectivo.</p>
        <div class="cuadricula">
          {MONEDAS.map((m) => (
            <Campo key={m} etiqueta={`Efectivo inicial en ${NOMBRE_MONEDA[m]}`} valor={textos[m]} inputMode="decimal" onInput={(v) => setTextos({ ...textos, [m]: v })} ayuda="Ejemplo: 150,50" />
          ))}
        </div>
        {invalido && <Alerta>Escriba montos válidos, con hasta dos decimales.</Alerta>}
        {accion.error && <Alerta>{accion.error}</Alerta>}
        <Boton tipo="submit" ocupado={accion.ocupado} deshabilitado={!hay || invalido}>
          Abrir turno
        </Boton>
      </form>
    </Seccion>
  );
}

export function PantallaVenta({ sub }: { sub: string }): JSX.Element {
  const { api } = useApp();
  const actual = PESTANAS.some((p) => p.id === sub) ? sub : 'terminal';
  const turno = useCarga(() => api.llamar('turnoActual', {}), []);
  const necesitaTurno = actual === 'terminal' || actual === 'caja' || actual === 'cierre';

  return (
    <div>
      <h1>Venta</h1>
      <Pestanas etiqueta="Secciones de venta" base="venta" actual={actual} items={PESTANAS} />
      {turno.cargando && <Cargando />}
      {turno.error && <ErrorCarga error={turno.error} reintentar={turno.recargar} />}
      {!turno.cargando && !turno.error && necesitaTurno && turno.datos === null && <Apertura alAbrir={turno.recargar} />}
      {!turno.cargando && !turno.error && (!necesitaTurno || turno.datos !== null) && (
        <>
          {actual === 'terminal' && turno.datos && <VentaTerminal turno={turno.datos} alCambiar={turno.recargar} />}
          {actual === 'caja' && turno.datos && <VentaCaja turno={turno.datos} alCambiar={turno.recargar} />}
          {actual === 'cierre' && turno.datos && <VentaCierre turno={turno.datos} alCerrar={turno.recargar} />}
          {actual === 'creditos' && <VentaCreditos alCambiar={turno.recargar} />}
          {actual === 'historial' && <VentaHistorial />}
        </>
      )}
    </div>
  );
}
