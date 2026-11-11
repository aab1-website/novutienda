import { textoRobots } from '../lib/indexacion.js';

export function GET(): Response {
  return new Response(textoRobots(process.env['APP_ENV']), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
