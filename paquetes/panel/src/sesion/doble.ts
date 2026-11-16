import type { Rol } from '@novutienda/nucleo';
import type { ResultadoInicio, Sesion, UsuarioSesion } from './sesion.js';

export interface CuentaDoble {
  readonly correo: string;
  readonly contrasena: string;
  readonly uid: string;
  readonly tenantId: string;
  readonly rol: Rol;
  readonly verificado: boolean;
  /**
   * Cuenta que entra sin rol y con una invitación pendiente: al iniciar sesión se llama a la activación UNA vez.
   * `pendiente` la activa (la cuenta recibe `tenantId` y `rol`); `servidor-no-verificado` simula que el servidor responde
   * `correo-no-verificado` aunque el cliente crea lo contrario.
   */
  readonly activacion?: 'pendiente' | 'servidor-no-verificado';
}

/** Cuentas de desarrollo y pruebas. NO son credenciales reales. */
export const CUENTAS_DOBLE: readonly CuentaDoble[] = [
  { correo: 'adm@ejemplo.test', contrasena: 'clave-adm-1', uid: 'u-adm', tenantId: 'demo', rol: 'adm', verificado: true },
  { correo: 'sup@ejemplo.test', contrasena: 'clave-sup-1', uid: 'u-sup', tenantId: 'demo', rol: 'sup', verificado: true },
  { correo: 'caj@ejemplo.test', contrasena: 'clave-caj-1', uid: 'u-caj', tenantId: 'demo', rol: 'caj', verificado: true },
  { correo: 'nuevo@ejemplo.test', contrasena: 'clave-nuevo-1', uid: 'u-nuevo', tenantId: 'demo', rol: 'caj', verificado: false },
];

export class SesionDoble implements Sesion {
  private usuario: UsuarioSesion | null = null;
  private readonly oyentes = new Set<(u: UsuarioSesion | null) => void>();
  verificacionesReenviadas = 0;
  /** Para pruebas: correos a los que se envió un restablecimiento (solo cuentas que existen, como en el servicio real). */
  restablecimientos: string[] = [];
  /** Para pruebas: cuántas renovaciones se pidieron y si el servidor las acepta. */
  renovaciones = 0;
  renovable = true;
  /** Para pruebas: cuántas veces se llamó a la activación de invitaciones. */
  activaciones = 0;
  private readonly activadas = new Set<string>();

  constructor(private readonly cuentas: readonly CuentaDoble[] = CUENTAS_DOBLE) {}

  iniciar(correo: string, contrasena: string): Promise<ResultadoInicio> {
    const c = this.cuentas.find((x) => x.correo === correo.trim().toLowerCase());
    if (c === undefined || c.contrasena !== contrasena) return Promise.resolve({ tipo: 'credenciales-invalidas' });
    if (!c.verificado) return Promise.resolve({ tipo: 'correo-no-verificado' });
    if (c.activacion !== undefined && !this.activadas.has(c.uid)) {
      this.activaciones += 1;
      if (c.activacion === 'servidor-no-verificado') {
        this.verificacionesReenviadas += 1; // envía el correo de verificación
        return Promise.resolve({ tipo: 'correo-no-verificado' });
      }
      this.activadas.add(c.uid);
      this.renovaciones += 1; // el token se refresca para que aparezca el rol
    }
    this.usuario = { uid: c.uid, correo: c.correo, tenantId: c.tenantId, rol: c.rol };
    this.avisar();
    return Promise.resolve({ tipo: 'ok', usuario: this.usuario });
  }

  cerrar(): Promise<void> {
    this.usuario = null;
    this.avisar();
    return Promise.resolve();
  }

  actual(): UsuarioSesion | null {
    return this.usuario;
  }

  alCambiar(oyente: (u: UsuarioSesion | null) => void): () => void {
    this.oyentes.add(oyente);
    return () => void this.oyentes.delete(oyente);
  }

  renovar(): Promise<boolean> {
    this.renovaciones += 1;
    return Promise.resolve(this.usuario !== null && this.renovable);
  }

  reenviarVerificacion(): Promise<void> {
    this.verificacionesReenviadas += 1;
    return Promise.resolve();
  }

  recuperarContrasena(correo: string): Promise<void> {
    const c = this.cuentas.find((x) => x.correo === correo.trim().toLowerCase());
    if (c !== undefined) this.restablecimientos.push(c.correo);
    return Promise.resolve();
  }

  /** Para pruebas: si es `true`, el envío del enlace de acceso falla. */
  fallaElEnlace = false;
  enlacesDeAcceso: string[] = [];

  enviarEnlaceDeAcceso(correo: string): Promise<boolean> {
    if (this.fallaElEnlace) return Promise.resolve(false);
    this.enlacesDeAcceso.push(correo.trim().toLowerCase());
    return Promise.resolve(true);
  }

  private avisar(): void {
    for (const o of this.oyentes) o(this.usuario);
  }
}
