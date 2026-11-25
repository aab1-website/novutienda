// Lectura previa del cambio de redondeo que corre el operador (scripts/fijar-redondeo.mjs): configuración comercial del tenant,
// reglas vigentes y uid de auditoría. Lógica sin red: el Firestore llega por inyección (solo `doc(ruta).get()`).
import { comercialDe, esTenantIdValido, redondeoPorMoneda, validarTenant, type ConfiguracionComercial, type RedondeoPorMoneda } from '@novutienda/nucleo';

export interface LectorDocumentoOperador {
  doc(ruta: string): { get(): Promise<{ readonly exists: boolean; data(): Readonly<Record<string, unknown>> | undefined }> };
}

/** Configuración comercial de `tenants/{t}`; falla con un mensaje sin identificadores si no existe o es inválida. */
export async function leerComercial(firestore: LectorDocumentoOperador, tenantId: string): Promise<ConfiguracionComercial> {
  if (!esTenantIdValido(tenantId)) throw new Error('el tenant no es un identificador válido');
  const snap = await firestore.doc(`tenants/${tenantId}`).get();
  if (!snap.exists) throw new Error('el tenant no existe');
  const v = validarTenant(snap.data());
  if (!v.ok) throw new Error('el documento del tenant es inválido');
  const c = comercialDe(v.valor);
  if (!c.ok) throw new Error('la configuración comercial del tenant es inválida');
  return c.valor;
}

export interface ReglasVigentes {
  readonly reglas: RedondeoPorMoneda;
  /** `true` si `config/redondeo` no se pudo interpretar: se muestran las reglas de la configuración y la escritura no espera nada. */
  readonly invalido: boolean;
}

/** Lo que el script toma del servidor (`interpretarRedondeoDe` y `RedondeoInvalido`); se inyecta porque este proyecto TypeScript no incluye las Functions. */
export interface InterpreteRedondeo {
  interpretarRedondeoDe(datos: Readonly<Record<string, unknown>> | undefined, comercial: ConfiguracionComercial): RedondeoPorMoneda;
  esRedondeoInvalido(e: unknown): boolean;
}

/** Reglas vigentes del tenant; un `config/redondeo` inválido no falla: se informa para poder repararlo. */
export async function leerReglasVigentes(
  firestore: LectorDocumentoOperador,
  tenantId: string,
  comercial: ConfiguracionComercial,
  interprete: InterpreteRedondeo,
): Promise<ReglasVigentes> {
  const datos = (await firestore.doc(`tenants/${tenantId}/config/redondeo`).get()).data();
  try {
    return { reglas: interprete.interpretarRedondeoDe(datos, comercial), invalido: false };
  } catch (e) {
    if (!interprete.esRedondeoInvalido(e)) throw e;
    return { reglas: redondeoPorMoneda(comercial), invalido: true };
  }
}

const CUENTA_VALIDA = /^[a-z0-9._@+-]{1,100}$/;
/** uid de auditoría `script:<cuenta>` desde la cuenta real que corre el script; sin cuenta válida lanza (no hay valor por defecto). */
export function uidDeScript(cuenta: string | undefined): string {
  const c = (cuenta ?? '').trim().toLowerCase();
  if (!CUENTA_VALIDA.test(c)) throw new Error('no se pudo determinar la cuenta que corre el script (credencial de aplicación o gcloud)');
  return `script:${c}`;
}
