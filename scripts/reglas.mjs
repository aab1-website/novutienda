// reglas:generar y reglas:verificar. No-op documentado hasta la ola 1b, cuando
// el generador producirá firestore.rules desde el registro de módulos.
// Mientras tanto firestore.rules niega todo y se edita solo con revisión.
const accion = process.argv[2];
if (accion !== 'generar' && accion !== 'verificar') {
  console.error('Uso: node scripts/reglas.mjs <generar|verificar>');
  process.exit(2);
}
console.log(`reglas:${accion}: sin generador todavía (ola 1b); firestore.rules niega todo.`);
