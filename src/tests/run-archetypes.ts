import { evaluarArquetipos, spearman } from './archetypes.js';
import { config } from '../config.js';

/**
 * Banco de pruebas del modelo contra una verdad conocida. Genera jugadores con
 * las reglas reales de puntuación de Biwenger, cada uno con una calidad
 * latente que el modelo no ve, y comprueba si el modelo la recupera.
 *
 * Los dos últimos arquetipos son trampas: el bueno en mala racha (que el
 * mercado ha devaluado y hay que comprar) y el mediocre en buena racha (que el
 * mercado ha inflado y hay que evitar).
 */
const JORNADAS = Number(process.argv[2] ?? 12);
const SEMILLAS = [4242, 1111, 909090, 31337, 55555];

console.log(`Modelo: k=${config.engine.shrinkageK} · forma=${config.engine.formHalflife} · minutos=${config.engine.minutesHalflife}`);
console.log(`Simulando ${JORNADAS} jornadas con las reglas reales de Biwenger\n`);

const rhos: number[] = [];
const maes: number[] = [];

for (const semilla of SEMILLAS) {
  const { filas } = evaluarArquetipos(JORNADAS, 6, semilla);
  rhos.push(spearman(filas.map((f) => f.verdadHorizonte), filas.map((f) => f.modeloHorizonte)));
  maes.push(filas.reduce((s, f) => s + Math.abs(f.error), 0) / filas.length);

  if (semilla === SEMILLAS[0]) {
    console.log('arquetipo                        pos   verdad 6j  modelo 6j   error');
    console.log('-------------------------------- ---   ---------  ---------  ------');
    for (const f of filas) {
      console.log(
        f.nombre.padEnd(32), f.position.padEnd(3),
        String(f.verdadHorizonte).padStart(10),
        String(f.modeloHorizonte).padStart(10),
        String(f.error).padStart(7),
      );
    }
    console.log();
  }
}

const media = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
console.log(`Sobre ${SEMILLAS.length} semillas:`);
console.log(`  Spearman (¿ordena bien?): ${media(rhos).toFixed(3)}`);
console.log(`  Error medio absoluto:     ${media(maes).toFixed(2)} pts en 6 jornadas`);
console.log('\nUn Spearman por debajo de 0,85 indica que algo se ha roto.');
