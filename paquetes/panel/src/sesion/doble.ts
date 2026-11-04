import type { Rol } from '@novutienda/nucleo';
import type { ResultadoInicio, Sesion, UsuarioSesion } from './sesion.js';

export interface CuentaDoble {
  readonly correo: string;
  readonly contrasena: string;
  readonly uid: string;
  readonly tenantId: string;
  readonly rol: Rol;
  readonly verificado: boolean;
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

  constructor(private readonly cuentas: readonly CuentaDoble[] = CUENTAS_DOBLE) {}

  iniciar(correo: string, contrasena: string): Promise<ResultadoInicio> {
    const c = this.cuentas.find((x) => x.correo === correo.trim().toLowerCase());
    if (c === undefined || c.contrasena !== contrasena) return Promise.resolve({ tipo: 'credenciales-invalidas' });
    if (!c.verificado) return Promise.resolve({ tipo: 'correo-no-verificado' });
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

  reenviarVerificacion(): Promise<void> {
    this.verificacionesReenviadas += 1;
    return Promise.resolve();
  }

  private avisar(): void {
    for (const o of this.oyentes) o(this.usuario);
  }
}
