import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { leerDuracionVideo } from "@novutienda/panel/consola";
import { describe, expect, it } from "vitest";

const hayFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe("leerDuracionVideo contra clips reales", () => {
  it.skipIf(!hayFfmpeg)("coincide con ffmpeg en mp4, mov y webm", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dur-"));
    let probados = 0;
    try {
      for (const [ext, codec] of [
        ["mp4", "mpeg4"],
        ["mov", "mpeg4"],
        ["webm", "libvpx"],
      ] as const) {
        const ruta = join(dir, `c.${ext}`);
        const r = spawnSync("ffmpeg", [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "testsrc=duration=2.5:size=64x64:rate=10",
          "-c:v",
          codec,
          ruta,
        ]);
        if (r.status !== 0) continue; // sin ese codificador en esta máquina
        const d = await leerDuracionVideo(
          new Blob([new Uint8Array(readFileSync(ruta))]),
        );
        expect(d, ext).toBeGreaterThan(2.3);
        expect(d, ext).toBeLessThan(2.8);
        probados += 1;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(probados).toBeGreaterThan(0);
  });
});
