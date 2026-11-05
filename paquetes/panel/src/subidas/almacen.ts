/** Puerto de subida reanudable a la ruta privada que devolvió `reservarSubida`. */
export interface AlmacenSubidas {
  subir(ruta: string, archivo: Blob, alProgresar: (porcentaje: number) => void): Promise<void>;
}

/** Doble: avanza el progreso en pasos y termina. */
export class AlmacenSubidasDoble implements AlmacenSubidas {
  subidos: { ruta: string; bytes: number }[] = [];
  constructor(private readonly pasos = 4) {}
  async subir(ruta: string, archivo: Blob, alProgresar: (p: number) => void): Promise<void> {
    for (let i = 1; i <= this.pasos; i++) {
      await new Promise((r) => setTimeout(r, 0));
      alProgresar(Math.round((i / this.pasos) * 100));
    }
    this.subidos.push({ ruta, bytes: archivo.size });
  }
}
