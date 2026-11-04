import { cssPlantillas } from '../plantillas/css.js';

export function GET(): Response {
  return new Response(cssPlantillas(), { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
}
