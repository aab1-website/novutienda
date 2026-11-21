// Cola de tareas real (Cloud Tasks vía `getFunctions().taskQueue` de firebase-admin) que despierta la construcción del sitio a la
// hora agendada. El nombre de la tarea es idempotente por (tenant, `para`): encolar dos veces lo mismo no la duplica.
import type { ColaSitio, TareaSitio } from '@novutienda/consola';

/** Lo que usa el conector de una cola de firebase-admin (lo cumple `getFunctions().taskQueue(...)` y un doble de pruebas). */
export interface ColaDeTareas {
  enqueue(datos: Record<string, unknown>, opciones: { id: string; scheduleTime: Date; dispatchDeadlineSeconds: number }): Promise<void>;
}

const RE_NOMBRE = /^[A-Za-z0-9_-]{1,500}$/;
/** Tiempo máximo de la tarea para que el manejador responda (lanzar el build es una llamada corta). */
const PLAZO_TAREA_SEG = 60;

const yaExiste = (error: unknown): boolean => {
  const codigo = (error as { code?: unknown } | null)?.code;
  return typeof codigo === 'string' && codigo.endsWith('task-already-exists');
};

/** `cola`: la cola de la función que atiende las tareas (`locations/us-east1/functions/<nombre>`). */
export function crearColaSitio(cola: ColaDeTareas, ahora: () => number = Date.now): ColaSitio {
  return {
    async encolar(tarea: TareaSitio): Promise<void> {
      if (!RE_NOMBRE.test(tarea.nombre)) throw new Error('nombre de tarea inválido');
      try {
        // Una hora ya pasada se despacha de inmediato; Cloud Tasks la acepta igual.
        await cola.enqueue({ tenantId: tarea.tenantId, para: tarea.para }, {
          id: tarea.nombre, scheduleTime: new Date(Math.max(tarea.para, ahora())), dispatchDeadlineSeconds: PLAZO_TAREA_SEG,
        });
      } catch (error) {
        if (!yaExiste(error)) throw error;
      }
    },
  };
}
