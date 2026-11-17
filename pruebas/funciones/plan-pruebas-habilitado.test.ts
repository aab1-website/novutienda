// Plan `pruebas` (solo staging): sin `PLAN_PRUEBAS_HABILITADO=si` un tenant con ese plan se trata como inválido (falla
// cerrado, igual que el ciclo de vida). Sin emulador: Firestore mínimo en memoria.
import { describe, expect, it } from 'vitest';
import { PARAMETROS } from '../../plataforma/funciones/servidor/config.js';
import { crearEntorno } from '../../plataforma/funciones/servidor/entorno.js';

const T = 'tienda-uno';
const tenant = (plan: string) => ({
  estado: 'activo',
  plan,
  modulos: { inventarios: { version: '0.1.0', submodulos: [] } },
  zonaHoraria: 'America/La_Paz',
  monedas: ['BOB', 'USD', 'ARS'],
});

function entornoCon(plan: string, habilitado?: boolean) {
  const docs: Record<string, unknown> = { [`tenants/${T}`]: tenant(plan) };
  const f = { doc: (ruta: string) => ({ get: async () => ({ exists: Object.hasOwn(docs, ruta), data: () => docs[ruta] }) }), collection: () => ({ listDocuments: async () => [] }) };
  return crearEntorno({
    firestore: f as never, auth: {} as never, bucket: {} as never, ahora: () => 1_000, env: {},
    ...(habilitado === undefined ? {} : { planPruebasHabilitado: habilitado }),
  });
}

describe('PLAN_PRUEBAS_HABILITADO', () => {
  it('el parámetro existe y su valor por defecto es vacío', () => {
    expect(PARAMETROS.planPruebasHabilitado.name).toBe('PLAN_PRUEBAS_HABILITADO');
    expect((PARAMETROS.planPruebasHabilitado as unknown as { defaultValue?: unknown }).defaultValue ?? '').toBe('');
  });

  it('plan pruebas sin habilitar (por defecto o false): inválido, sin módulos', async () => {
    for (const h of [undefined, false]) {
      const e = entornoCon('pruebas', h);
      expect(await e.modulosDelTenant(T)).toBeUndefined();
      expect(await e.estadoModulosDelTenant(T)).toEqual({ motivo: 'invalido' });
    }
  });

  it('plan pruebas habilitado: opera con sus módulos', async () => {
    const e = entornoCon('pruebas', true);
    expect(await e.modulosDelTenant(T)).toContain('inventarios');
  });

  it('los demás planes no dependen del parámetro', async () => {
    for (const plan of ['base']) {
      expect(await entornoCon(plan).modulosDelTenant(T)).toContain('inventarios');
    }
  });
});
