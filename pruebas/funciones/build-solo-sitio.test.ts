// scripts/build.mjs --solo sitio --sitio <id>: validación de argumentos (falla antes de compilar nada) y la composición real
// del dist/firebase.json con componer-hosting --solo-sitio --sitio, sin pnpm build.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SITIO = 'sitio-aaaa';
let tmp = '';

const build = (...args: string[]) => {
  const r = spawnSync(process.execPath, ['scripts/build.mjs', ...args], { encoding: 'utf8', cwd: process.cwd(), env: { PATH: process.env['PATH'] ?? '' }, timeout: 20_000 });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
};
const componer = (...args: string[]) => spawnSync(process.execPath, ['plataforma/funciones/scripts/componer-hosting.mjs', ...args], { encoding: 'utf8', cwd: process.cwd() });

beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'build-solo-sitio-')); });
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('build.mjs: argumentos de --solo sitio', () => {
  it('--solo sitio sin --sitio falla', () => {
    const r = build('--mode', 'staging', '--solo', 'sitio');
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('--solo sitio exige --sitio');
  });
  it('--solo sin valor, o seguido de otra bandera, falla', () => {
    expect(build('--mode', 'staging', '--solo').codigo).toBe(1);
    expect(build('--mode', 'staging', '--solo', '--sitio', 'sitio-aaaa').codigo).toBe(1);
  });
  it('--sitio con id inválido o vacío falla sin eco del valor', () => {
    for (const malo of ['corto', 'MAYUS-privado', 'con espacio privado', 'a'.repeat(31), '']) {
      const r = build('--mode', 'staging', '--solo', 'sitio', '--sitio', malo);
      expect(r.codigo).toBe(1);
      expect(r.salida).toContain('--solo sitio exige --sitio');
      expect(r.salida).not.toContain('privado');
    }
    expect(build('--mode=staging', '--solo=sitio', '--sitio=MAL').codigo).toBe(1);
  });
  it('--sitio sin --solo sitio falla', () => {
    const r = build('--mode', 'staging', '--sitio', SITIO);
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('--sitio solo se admite con --solo sitio');
  });
  it('--solo con otro valor falla, y un modo desconocido también', () => {
    expect(build('--mode', 'staging', '--solo', 'panel', '--sitio', SITIO).salida).toContain('--solo solo admite');
    expect(build('--mode', 'dev', '--solo', 'sitio', '--sitio', SITIO).salida).toContain('no válido');
  });
});

describe('componer-hosting --solo-sitio --sitio (lo que build deja en dist/firebase.json)', () => {
  it('escribe una sola entrada con site, sin target ni otras claves', () => {
    const rutaCab = join(tmp, 'cab.json');
    const salida = join(tmp, 'firebase.json');
    writeFileSync(rutaCab, JSON.stringify([{ source: '**', headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'" }] }]));
    const r = componer('--solo-sitio', '--sitio', SITIO, '--firebase', 'firebase.json', '--cabeceras', rutaCab, '--salida', salida);
    expect(r.status).toBe(0);
    const f = JSON.parse(readFileSync(salida, 'utf8')) as { hosting: { site?: string; target?: string; public: string }[] };
    expect(Object.keys(f)).toEqual(['hosting']);
    expect(f.hosting).toHaveLength(1);
    expect(f.hosting[0]?.site).toBe(SITIO);
    expect(f.hosting[0]).not.toHaveProperty('target');
  });
  it('sin --sitio o con id inválido sale con código 1 y no escribe', () => {
    const rutaCab = join(tmp, 'cab2.json');
    const salida = join(tmp, 'no.json');
    writeFileSync(rutaCab, JSON.stringify([{ source: '**', headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'" }] }]));
    for (const extra of [[], ['--sitio', 'MAL']]) {
      const r = componer('--solo-sitio', ...extra, '--firebase', 'firebase.json', '--cabeceras', rutaCab, '--salida', salida);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('id de sitio inválido');
    }
    expect(() => readFileSync(salida)).toThrow();
  });
});
