// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { abrirCapa, cuentaDeCapas, devolverFoco, enfocables, indiceDeFoco } from './capas.js';
import { contadorAnunciable, enfocarPrimerError, textoContador } from './formulario.js';

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.className = '';
});

describe('indiceDeFoco', () => {
  it('es cíclico hacia adelante y hacia atrás', () => {
    expect(indiceDeFoco(3, 2, false)).toBe(0);
    expect(indiceDeFoco(3, 0, true)).toBe(2);
    expect(indiceDeFoco(3, 1, false)).toBe(2);
    expect(indiceDeFoco(3, 1, true)).toBe(0);
  });
  it('sin enfocables devuelve -1 y con el foco fuera de la lista entra por un extremo', () => {
    expect(indiceDeFoco(0, 0, false)).toBe(-1);
    expect(indiceDeFoco(3, -1, false)).toBe(0);
    expect(indiceDeFoco(3, -1, true)).toBe(2);
  });
});

describe('abrirCapa', () => {
  function pagina(): { fondo: HTMLElement; capa: HTMLElement; viva: HTMLElement; hermana: HTMLElement } {
    document.body.innerHTML =
      '<div id="raiz"><header>Fondo</header><main><section id="hermana">S</section><div id="capa"><button>x</button></div></main><div data-capa-viva>Aviso</div></div>';
    return {
      fondo: document.querySelector('header') as HTMLElement,
      capa: document.getElementById('capa') as HTMLElement,
      viva: document.querySelector('[data-capa-viva]') as HTMLElement,
      hermana: document.getElementById('hermana') as HTMLElement,
    };
  }

  it('deja inertes los hermanos de la capa y de sus ancestros, menos las regiones vivas, y lo restaura', () => {
    const { fondo, capa, viva, hermana } = pagina();
    const soltar = abrirCapa(capa);
    expect(fondo.hasAttribute('inert')).toBe(true);
    expect(hermana.hasAttribute('inert')).toBe(true);
    expect(viva.hasAttribute('inert')).toBe(false);
    expect(capa.hasAttribute('inert')).toBe(false);
    expect(document.documentElement.classList.contains('sin-desplazar')).toBe(true);
    soltar();
    expect(fondo.hasAttribute('inert')).toBe(false);
    expect(hermana.hasAttribute('inert')).toBe(false);
    expect(document.documentElement.classList.contains('sin-desplazar')).toBe(false);
  });

  it('con capas anidadas, la clase se quita solo al cerrar la última y soltar dos veces no resta de más', () => {
    const { capa, hermana } = pagina();
    const a = abrirCapa(capa);
    const b = abrirCapa(hermana);
    expect(cuentaDeCapas()).toBe(2);
    a();
    a();
    expect(cuentaDeCapas()).toBe(1);
    expect(document.documentElement.classList.contains('sin-desplazar')).toBe(true);
    b();
    expect(cuentaDeCapas()).toBe(0);
    expect(document.documentElement.classList.contains('sin-desplazar')).toBe(false);
  });

  it('solo restaura lo que marcó: lo que ya era inerte sigue inerte', () => {
    const { capa, fondo } = pagina();
    fondo.setAttribute('inert', '');
    const soltar = abrirCapa(capa);
    soltar();
    expect(fondo.hasAttribute('inert')).toBe(true);
  });
});

describe('enfocables y devolverFoco', () => {
  it('descarta ocultos y los que están bajo un ancestro inerte', () => {
    document.body.innerHTML = '<div id="r"><button id="a">a</button><button id="b" hidden>b</button><div inert><button id="c">c</button></div></div>';
    expect(enfocables(document.getElementById('r') as HTMLElement).map((e) => e.id)).toEqual(['a']);
  });

  it('enfoca el título si ni el origen ni el respaldo existen', async () => {
    document.body.innerHTML = '<h1>Título</h1>';
    devolverFoco(null);
    await Promise.resolve();
    expect(document.activeElement).toBe(document.querySelector('h1'));
  });
});

describe('formulario', () => {
  it('enfocarPrimerError enfoca el primer campo inválido y avisa si no hay', () => {
    document.body.innerHTML = '<form><input id="a"><input id="b" aria-invalid="true"><input id="c" aria-invalid="true"></form>';
    const form = document.querySelector('form') as HTMLElement;
    expect(enfocarPrimerError(form)).toBe(true);
    expect(document.activeElement?.id).toBe('b');
    document.body.innerHTML = '<form><input></form>';
    expect(enfocarPrimerError(document.body)).toBe(false);
  });

  it('el contador se anuncia desde el 90 %', () => {
    expect(textoContador(32, 70)).toBe('32 de 70');
    expect(contadorAnunciable(62, 70)).toBe(false);
    expect(contadorAnunciable(63, 70)).toBe(true);
    expect(contadorAnunciable(0, 0)).toBe(false);
  });
});
