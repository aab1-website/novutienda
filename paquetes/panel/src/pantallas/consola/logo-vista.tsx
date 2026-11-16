import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { Alerta, Boton, BotonConfirmado, Cargando, ErrorCarga, Seccion } from '../../ui/comun.js';
import { useAvisos } from '../../ui/avisos.js';
import { useApp } from '../../ui/contexto.js';
import { useAccion, useCarga } from '../../ui/hooks.js';
import { baseDeMedios, urlDelLogo } from '../../util/logo.js';
import { mensajeDeError } from '../../api/errores.js';
import { ACEPTA_LOGO, TEXTO_FORMATOS_LOGO, useSubidaLogo } from './subidas-logo.js';

const ETAPAS = { revisando: 'Revisando el archivo…', reservando: 'Preparando la subida…', subiendo: 'Subiendo', procesando: 'Procesando el logo' } as const;

/** Bloque «Logo del negocio» de Apariencia: el logo se sube y se guarda aparte de «Guardar apariencia». */
export function BloqueLogo(): JSX.Element {
  const { api, usuario } = useApp();
  const avisos = useAvisos();
  const esAdm = usuario.rol === 'adm';
  const logo = useCarga(() => api.llamar('leerLogo', {}), []);
  const quitar = useAccion();
  const entrada = useRef<HTMLInputElement>(null);
  const [falloImagen, setFalloImagen] = useState<string | null>(null);
  const subida = useSubidaLogo(() => {
    setFalloImagen(null);
    logo.recargar();
    avisos.ok('Logo guardado. Falta publicar el sitio.');
  });
  const actual = logo.datos ?? null;
  const url = actual === null ? null : urlDelLogo(baseDeMedios(), actual);
  const hayLogo = actual !== null;

  const vista = ((): JSX.Element => {
    if (logo.cargando && logo.datos === undefined) return <Cargando />;
    if (logo.error) return <ErrorCarga error={logo.error} reintentar={logo.recargar} />;
    if (!hayLogo) return <p class="texto-suave">Todavía no hay un logo subido.</p>;
    if (url === null || falloImagen === url) return <p class="texto-suave">Logo cargado (la vista previa no está disponible).</p>;
    return <img src={url} alt="Logo del negocio" referrerpolicy="no-referrer" width={128} height={128} style="width:128px;height:128px;object-fit:contain" onError={() => setFalloImagen(url)} />;
  })();

  const elegido = (e: Event): void => {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f !== undefined && !quitar.ocupado) subida.elegir(f);
  };
  const quitarLogo = (): void =>
    void quitar.ejecutar(async () => {
      try {
        const r = await api.llamar('quitarLogo', {});
        logo.recargar();
        avisos.ok(r.quitado ? 'Logo quitado. Falta publicar el sitio.' : 'No había un logo que quitar.');
      } catch (e) {
        avisos.error(`No se pudo quitar el logo: ${mensajeDeError(e)}`);
      }
    });

  return (
    <Seccion titulo="Logo del negocio">
      {vista}
      {esAdm ? (
        <>
          <p class="texto-suave">{TEXTO_FORMATOS_LOGO}, hasta 2 MB (no se admite SVG). El logo se guarda al subirlo: no depende de «Guardar apariencia».</p>
          <div class="fila">
            <Boton onClick={() => entrada.current?.click()} motivo={subida.enCurso ? 'Hay una subida en curso' : quitar.ocupado ? 'Se está quitando el logo' : undefined}>
              {hayLogo ? 'Reemplazar logo' : 'Subir logo'}
            </Boton>
            {hayLogo && <BotonConfirmado texto="Quitar logo" pregunta="¿Quitar el logo del negocio?" resumen="El sitio dejará de mostrarlo cuando se publique." textoConfirmar="Sí, quitar" peligro deshabilitado={subida.enCurso || quitar.ocupado} onConfirmar={quitarLogo} />}
            <input ref={entrada} type="file" hidden aria-label="Archivo del logo" accept={ACEPTA_LOGO} onChange={elegido} />
          </div>
          {subida.enCurso && (
            <p role="status">
              {subida.nombre}: {subida.fase === 'subiendo' ? `${ETAPAS.subiendo} ${String(Math.round(subida.progreso))} %` : subida.fase === 'procesando' ? `${ETAPAS.procesando} (${String(subida.segundos)} s)` : ETAPAS[subida.fase as keyof typeof ETAPAS]}
            </p>
          )}
          {subida.fase === 'error' && (
            <Alerta tipo="error">
              {subida.nombre === '' ? '' : `${subida.nombre}: `}
              {subida.motivo}{' '}
              {subida.reintentable ? (
                <Boton chico variante="secundario" onClick={subida.reintentar}>Reintentar</Boton>
              ) : (
                <Boton chico variante="secundario" onClick={() => entrada.current?.click()}>Elegir otro archivo</Boton>
              )}
            </Alerta>
          )}
        </>
      ) : (
        <p class="texto-suave">Solo el administrador cambia el logo.</p>
      )}
    </Seccion>
  );
}
