import { describe, expect, it } from "vitest";
import { LIMITES_PANEL } from "../../api/tipos.js";
import { leerDuracionVideo, validarArchivo } from "./validar-archivo.js";

const archivo = (name: string, type: string, size = 1000): File => {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};
const dura = (s: number | undefined) => (): Promise<number | undefined> =>
  Promise.resolve(s);

describe("validarArchivo", () => {
  it("acepta una foto y un video válidos", async () => {
    expect(
      await validarArchivo(archivo("a.jpg", "image/jpeg"), "foto"),
    ).toBeUndefined();
    expect(
      await validarArchivo(archivo("v.mp4", "video/mp4"), "video", dura(30)),
    ).toBeUndefined();
  });
  it("acepta por extensión cuando el navegador no informa el tipo", async () => {
    expect(
      await validarArchivo(archivo("v.mov", ""), "video", dura(10)),
    ).toBeUndefined();
  });
  it("acepta HEIC, M4V y un MIME genérico por su extensión; rechaza AVIF", async () => {
    expect(
      await validarArchivo(archivo("f.heic", "image/heic"), "foto"),
    ).toBeUndefined();
    expect(await validarArchivo(archivo("f.HEIC", ""), "foto")).toBeUndefined();
    expect(
      await validarArchivo(archivo("v.m4v", "video/x-m4v"), "video", dura(5)),
    ).toBeUndefined();
    expect(
      await validarArchivo(
        archivo("v.m4v", "application/octet-stream"),
        "video",
        dura(5),
      ),
    ).toBeUndefined();
    expect(
      await validarArchivo(archivo("f.avif", "image/avif"), "foto"),
    ).toMatch(/JPG, PNG, WebP o HEIC/);
    expect(
      await validarArchivo(
        archivo("f.avif", "application/octet-stream"),
        "foto",
      ),
    ).toMatch(/JPG, PNG/);
  });
  it("el mensaje de duración redondea hacia arriba", async () => {
    expect(
      await validarArchivo(archivo("v.mp4", "video/mp4"), "video", dura(60.4)),
    ).toMatch(/dura 61 segundos/);
  });
  it("rechaza un tipo no permitido y dice los formatos", async () => {
    expect(await validarArchivo(archivo("a.gif", "image/gif"), "foto")).toMatch(
      /JPG, PNG, WebP o HEIC/,
    );
    expect(
      await validarArchivo(
        archivo("v.avi", "video/x-msvideo"),
        "video",
        dura(1),
      ),
    ).toMatch(/MP4, MOV o WebM/);
  });
  it("rechaza por tamaño con el límite", async () => {
    expect(
      await validarArchivo(
        archivo("a.jpg", "image/jpeg", LIMITES_PANEL.bytesFoto + 1),
        "foto",
      ),
    ).toMatch(/máximo es 15/);
    expect(
      await validarArchivo(
        archivo("v.mp4", "video/mp4", LIMITES_PANEL.bytesVideo + 1),
        "video",
        dura(1),
      ),
    ).toMatch(/máximo es 200/);
  });
  it("rechaza un video de más de 60 s sin subir, y deja decidir al servidor si no se puede leer la duración", async () => {
    expect(
      await validarArchivo(archivo("v.mp4", "video/mp4"), "video", dura(61)),
    ).toMatch(/dura 61 segundos.*60 segundos/);
    expect(
      await validarArchivo(
        archivo("v.mp4", "video/mp4"),
        "video",
        dura(undefined),
      ),
    ).toBeUndefined();
  });
});

describe("leerDuracionVideo (sin DOM, por trozos del archivo)", () => {
  const u32 = (n: number): Uint8Array =>
    new Uint8Array([
      (n >>> 24) & 255,
      (n >>> 16) & 255,
      (n >>> 8) & 255,
      n & 255,
    ]);
  const u64 = (n: number): Uint8Array =>
    new Uint8Array([...u32(Math.floor(n / 2 ** 32)), ...u32(n >>> 0)]);
  const cat = (...p: Uint8Array[]): Uint8Array =>
    Uint8Array.from(p.flatMap((x) => [...x]));
  const txt = (s: string): Uint8Array =>
    new Uint8Array([...s].map((c) => c.charCodeAt(0)));
  const caja = (tipo: string, ...cuerpo: Uint8Array[]): Uint8Array => {
    const c = cat(...cuerpo);
    return cat(u32(8 + c.length), txt(tipo), c);
  };
  const ftyp = (): Uint8Array => caja("ftyp", txt("isom"), u32(0));
  const mvhd0 = (escala: number, dur: number): Uint8Array =>
    caja(
      "mvhd",
      cat(u32(0), u32(0), u32(0), u32(escala), u32(dur), new Uint8Array(80)),
    );
  const mvhd1 = (escala: number, dur: number): Uint8Array =>
    caja(
      "mvhd",
      cat(
        u32(1 << 24),
        u64(0),
        u64(0),
        u32(escala),
        u64(dur),
        new Uint8Array(70),
      ),
    );
  const blob = (...p: BlobPart[]): Blob => new Blob(p);
  const bp = (u: Uint8Array): BlobPart => u as unknown as BlobPart;

  it("MP4 con mvhd v0 y v1", async () => {
    expect(
      await leerDuracionVideo(
        blob(bp(ftyp()), bp(caja("moov", mvhd0(1000, 12500)))),
      ),
    ).toBeCloseTo(12.5);
    expect(
      await leerDuracionVideo(
        blob(bp(ftyp()), bp(caja("moov", mvhd1(600, 6000 * 3)))),
      ),
    ).toBeCloseTo(30);
  });
  it("moov al final tras un mdat grande, y mdat con tamaño extendido o 0", async () => {
    const relleno = new Uint8Array(3 * 1024 * 1024);
    const mdat = cat(u32(8 + relleno.length), txt("mdat"));
    expect(
      await leerDuracionVideo(
        blob(
          bp(ftyp()),
          bp(mdat),
          relleno,
          bp(caja("moov", mvhd0(1000, 61000))),
        ),
      ),
    ).toBeCloseTo(61);
    const ext = cat(u32(1), txt("mdat"), u64(16 + relleno.length));
    expect(
      await leerDuracionVideo(
        blob(bp(ftyp()), bp(ext), relleno, bp(caja("moov", mvhd0(1000, 5000)))),
      ),
    ).toBeCloseTo(5);
    // tamaño 0 = hasta el final: moov no se encuentra y no se cuelga
    expect(
      await leerDuracionVideo(
        blob(bp(ftyp()), bp(cat(u32(0), txt("mdat"))), relleno),
      ),
    ).toBeUndefined();
  });
  it("estructuras corruptas dan undefined sin colgarse", async () => {
    expect(
      await leerDuracionVideo(blob(bp(ftyp()), bp(cat(u32(4), txt("free"))))),
    ).toBeUndefined(); // menor que 8
    expect(
      await leerDuracionVideo(
        blob(bp(ftyp()), bp(cat(u32(9999), txt("moov")))),
      ),
    ).toBeUndefined(); // pasa del final
    expect(
      await leerDuracionVideo(
        blob(bp(ftyp()), bp(caja("moov", mvhd0(0, 100)))),
      ),
    ).toBeUndefined(); // escala 0
    expect(
      await leerDuracionVideo(
        blob(bp(ftyp()), bp(caja("moov", mvhd0(1000, 0)))),
      ),
    ).toBeUndefined();
    const muchas = cat(
      ...Array.from({ length: 200 }, () => caja("free", new Uint8Array(1))),
    );
    expect(
      await leerDuracionVideo(blob(bp(ftyp()), bp(muchas))),
    ).toBeUndefined(); // más saltos que el máximo
    expect(await leerDuracionVideo(blob())).toBeUndefined();
    expect(await leerDuracionVideo(blob("no es un video"))).toBeUndefined();
  });

  // EBML
  const id = (n: number): Uint8Array =>
    n <= 0xff
      ? new Uint8Array([n])
      : n > 0xffffff
        ? cat(u32(n))
        : n > 0xffff
          ? new Uint8Array([n >> 16, (n >> 8) & 255, n & 255])
          : new Uint8Array([n >> 8, n & 255]);
  const tam = (n: number): Uint8Array =>
    new Uint8Array([0x40 | (n >> 8), n & 255]); // vint de 2 bytes
  const el = (i: number, ...c: Uint8Array[]): Uint8Array => {
    const b = cat(...c);
    return cat(id(i), tam(b.length), b);
  };
  const f32 = (x: number): Uint8Array =>
    new Uint8Array(new Float32Array([x]).buffer).reverse();
  const f64 = (x: number): Uint8Array =>
    new Uint8Array(new Float64Array([x]).buffer).reverse();
  const cabEbml = (): Uint8Array => el(0x1a45dfa3, el(0x4282, txt("webm")));
  const webm = (info: Uint8Array, desconocido = false): Uint8Array => {
    const hijos = cat(el(0xec, new Uint8Array(30)), info);
    const seg = desconocido
      ? cat(
          id(0x18538067),
          new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
        )
      : cat(id(0x18538067), tam(hijos.length));
    return cat(cabEbml(), seg, hijos);
  };
  it("WebM con Duration float32 y float64, escala por omisión y distinta", async () => {
    expect(
      await leerDuracionVideo(
        blob(bp(webm(el(0x1549a966, el(0x4489, f32(12500)))))),
      ),
    ).toBeCloseTo(12.5);
    expect(
      await leerDuracionVideo(
        blob(bp(webm(el(0x1549a966, el(0x4489, f64(45000.5)))))),
      ),
    ).toBeCloseTo(45.0005);
    expect(
      await leerDuracionVideo(
        blob(
          bp(
            webm(
              el(0x1549a966, el(0x2ad7b1, u32(1000)), el(0x4489, f64(30000))),
            ),
          ),
        ),
      ),
    ).toBeCloseTo(0.03);
    expect(
      await leerDuracionVideo(
        blob(
          bp(
            webm(
              el(
                0x1549a966,
                el(0x4489, f64(7000)),
                el(0x2ad7b1, u32(1_000_000)),
              ),
              true,
            ),
          ),
        ),
      ),
    ).toBeCloseTo(7);
  });
  it("WebM corrupto o truncado da undefined", async () => {
    const bueno = webm(el(0x1549a966, el(0x4489, f64(9000))));
    expect(
      await leerDuracionVideo(blob(bp(bueno.slice(0, bueno.length - 5)))),
    ).toBeUndefined();
    expect(
      await leerDuracionVideo(blob(bp(bueno.slice(0, 6)))),
    ).toBeUndefined();
    expect(
      await leerDuracionVideo(
        blob(bp(webm(el(0x1549a966, el(0x4489, f64(Number.NaN)))))),
      ),
    ).toBeUndefined();
    expect(
      await leerDuracionVideo(
        blob(bp(webm(el(0x1549a966, el(0x4489, new Uint8Array(3)))))),
      ),
    ).toBeUndefined();
    expect(
      await leerDuracionVideo(
        blob(bp(cat(u32(0x1a45dfa3), new Uint8Array(10)))),
      ),
    ).toBeUndefined();
    expect(
      await leerDuracionVideo(
        blob(
          bp(
            cat(
              u32(0x1a45dfa3),
              new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            ),
          ),
        ),
      ),
    ).toBeUndefined();
  });
});
