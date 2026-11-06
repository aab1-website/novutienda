import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { MONEDAS, type Moneda, type MontosPorMoneda, type ResultadoCierre, type TurnoPos } from '../../api/tipos.js';
import { Alerta, BotonConfirmado, Campo, Dato, Seccion } from '../../ui/comun.js';
import { useApp } from '../../ui/contexto.js';
import { useAccion } from '../../ui/hooks.js';
import { diferenciaPorMoneda, monedasDelTurno, proyectarTurno } from '../../util/arqueo.js';
import { formatearMonto, textoACentavos } from '../../util/dinero.js';

export function ResumenArqueo({ cierre }: { cierre: ResultadoCierre }): JSX.Element {
  return (
    <table class="tabla">
      <caption>Arqueo del turno cerrado</caption>
      <thead>
        <tr><th scope="col">Moneda</th><th scope="col" class="num">Esperado</th><th scope="col" class="num">Contado</th><th scope="col" class="num">Diferencia</th></tr>
      </thead>
      <tbody>
        {MONEDAS.filter((m) => cierre.arqueo[m] !== undefined).map((m) => {
          const a = cierre.arqueo[m];
          if (a === undefined) return null;
          return (
            <tr key={m}>
              <th scope="row">{m}</th>
              <td class="num">{formatearMonto(a.esperado, m)}</td>
              <td class="num">{formatearMonto(a.contado, m)}</td>
              <td class={`num ${a.diferencia < 0 ? 'texto-error' : ''}`}>{formatearMonto(a.diferencia, m)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function VentaCierre({ turno, alCerrar }: { turno: TurnoPos; alCerrar: () => void }): JSX.Element {
  const { api } = useApp();
  const accion = useAccion();
  const monedas = monedasDelTurno(turno);
  const [textos, setTextos] = useState<Record<Moneda, string>>({ BOB: '', USD: '', ARS: '' });
  const [cierre, setCierre] = useState<ResultadoCierre | null>(null);

  if (cierre !== null) {
    return (
      <Seccion titulo="Turno cerrado">
        <Alerta tipo="ok">El turno se cerró. La diferencia negativa (faltante) queda registrada tal cual.</Alerta>
        <ResumenArqueo cierre={cierre} />
        <button type="button" class="boton boton-cta" onClick={alCerrar}>Continuar</button>
      </Seccion>
    );
  }

  const proy = proyectarTurno(turno);
  const contado: Partial<Record<Moneda, number>> = {};
  let falta = false;
  for (const m of monedas) {
    const c = textoACentavos(textos[m]);
    if (c === null) falta = true;
    else contado[m] = c;
  }
  const dif = diferenciaPorMoneda(turno, contado as MontosPorMoneda);

  return (
    <Seccion titulo="Cierre de turno">
      <p class="texto-suave">Cuente el efectivo de la caja en cada moneda. QR, transferencias y créditos se informan aparte y no suman al efectivo.</p>
      {monedas.map((m) => {
        const p = proy[m];
        if (p === undefined) return null;
        const d = dif[m];
        return (
          <fieldset key={m} class="fila-pago">
            <legend>{m}</legend>
            <dl class="datos">
              <Dato etiqueta="Apertura">{formatearMonto(p.apertura, m)}</Dato>
              <Dato etiqueta="Efectivo esperado">{formatearMonto(p.efectivoEsperado, m)}</Dato>
              <Dato etiqueta="QR (informativo)">{formatearMonto(p.qr, m)}</Dato>
              <Dato etiqueta="Transferencias (informativo)">{formatearMonto(p.transferencia, m)}</Dato>
              <Dato etiqueta="Créditos otorgados (informativo)">{formatearMonto(p.credito, m)}</Dato>
            </dl>
            <Campo etiqueta={`Efectivo contado en ${m}`} valor={textos[m]} onInput={(v) => setTextos({ ...textos, [m]: v })} inputMode="decimal" requerido />
            {d !== undefined && (
              <p class={d < 0 ? 'texto-error' : ''} aria-live="polite" data-prueba={`diferencia-${m}`}>
                Diferencia: {formatearMonto(d, m)} {d < 0 ? '(faltante)' : d > 0 ? '(sobrante)' : '(cuadra)'}
              </p>
            )}
          </fieldset>
        );
      })}
      {accion.error && <Alerta>{accion.error}</Alerta>}
      <BotonConfirmado
        texto="Cerrar turno"
        pregunta="¿Cerrar el turno con estos conteos? No se puede deshacer."
        textoConfirmar="Sí, cerrar turno"
        deshabilitado={falta || accion.ocupado}
        onConfirmar={() => void accion.ejecutar(async () => setCierre(await api.llamar('cerrarTurno', { turnoId: turno.turnoId, contado: contado as MontosPorMoneda })))}
      />
    </Seccion>
  );
}
