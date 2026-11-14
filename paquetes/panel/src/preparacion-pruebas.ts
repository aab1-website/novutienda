// Preparación global de vitest (setupFiles). Solo actúa en entorno jsdom.
//
// preact/hooks agenda useEffect con afterNextFrame: un setTimeout de 35 ms más
// requestAnimationFrame, y el temporizador llama a cancelAnimationFrame. Si la
// prueba termina y vitest desmonta jsdom antes de que venza, esa llamada falla
// como excepción no capturada. Con options.requestAnimationFrame definido,
// preact usa ese agendador en lugar de afterNextFrame y no toca ninguna API de
// jsdom. act() de preact/test-utils guarda y restaura esta opción.
if (typeof window !== 'undefined') {
  const { options } = await import('preact');
  options.requestAnimationFrame = (devolucion: () => void): void => {
    setTimeout(devolucion, 0);
  };
}
