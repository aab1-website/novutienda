// Quita lo que Astro deja en el paquete tras compilar y que no debe versionarse ni analizarse.
import { rmSync } from 'node:fs';

rmSync(new URL('../.astro', import.meta.url), { recursive: true, force: true });
