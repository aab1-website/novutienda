// Conector de GitHub (sirve a la consola, vía el coordinador): disparo de la reconstrucción del sitio.
export {
  CLAVE_COLA_PENDIENTES, ConfiguracionDisparoInvalida, RAMA_SITIO, VERSION_API_GITHUB, WORKFLOW_SITIO,
  crearDisparoGithub, repoValido, tokenValido,
  type DisparoGithub, type FetchDisparo, type OpcionesDisparo, type ResultadoDisparo,
} from './disparo.js';
