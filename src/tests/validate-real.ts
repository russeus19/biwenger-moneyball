import { REALES, comoPlayers } from './real-data.js';
import { projectAll } from '../engine/projection.js';
import { config } from '../config.js';

/**
 * Validación FUERA DE MUESTRA con datos reales de LaLiga 2026/27, sistema
 * AS+Sofascore.
 *
 * Entrena con las primeras `corte` jornadas, proyecta, y compara contra lo que
 * esos mismos jugadores hicieron DESPUÉS. El modelo nunca ve las jornadas de
 * prueba. Es la única forma honesta de saber si predice o solo describe.
 *
 * El listón no es cero: es la heurística tonta de ordenar por media de puntos
 * hasta el corte. Si el modelo no le gana, no aporta nada.
 */

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx, b = ys[i]! - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : NaN;
}

function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]) => {
    const idx = xs.map((v, i) => [v, i] as [number, number]).sort((x, y) => x[0] - y[0]);
    const r = new Array(xs.length).fill(0);
    idx.forEach(([, i], pos) => { r[i] = pos + 1; });
    return r;
  };
  return pearson(rank(a), rank(b));
}

export function validar(
  corte: number,
  opciones?: { k?: number; forma?: number; minutos?: number; silencioso?: boolean },
) {
  const k = opciones?.k ?? config.engine.shrinkageK;
  const forma = opciones?.forma ?? config.engine.formHalflife;
  const minutos = opciones?.minutos ?? config.engine.minutesHalflife;

  // Solo jugadores con jornadas de prueba disponibles.
  const elegibles = REALES.filter((d) => d.puntos.length > corte);
  const entrenamiento = comoPlayers(elegibles, corte);

  const proy = projectAll({
    players: entrenamiento,
    horizonRounds: 1,
    shrinkageK: k,
    formHalflife: forma,
    minutesHalflife: minutos,
  });

  const modelo: number[] = [];
  const ingenuo: number[] = [];
  const real: number[] = [];
  const filas: Array<{ nombre: string; modelo: number; ingenuo: number; real: number }> = [];

  for (let i = 0; i < elegibles.length; i++) {
    const d = elegibles[i]!;
    const futuras = d.puntos.slice(corte).map((p) => p ?? 0);
    if (futuras.length === 0) continue;

    const realMedia = futuras.reduce((s, x) => s + x, 0) / futuras.length;
    const pr = proy.get(entrenamiento[i]!.id)!;

    // Heurística tonta: media de puntos por jornada disputada hasta el corte.
    const pasadas = d.puntos.slice(0, corte);
    const jugadas = pasadas.filter((p) => p !== null) as number[];
    const naive = jugadas.length ? jugadas.reduce((s, x) => s + x, 0) / jugadas.length : 0;

    modelo.push(pr.projectedPoints);
    ingenuo.push(naive);
    real.push(realMedia);
    filas.push({ nombre: d.nombre, modelo: pr.projectedPoints, ingenuo: naive, real: realMedia });
  }

  const mae = (a: number[]) => a.reduce((s, x, i) => s + Math.abs(x - real[i]!), 0) / a.length;

  return {
    n: real.length,
    rModelo: pearson(modelo, real),
    rIngenuo: pearson(ingenuo, real),
    rhoModelo: spearman(modelo, real),
    rhoIngenuo: spearman(ingenuo, real),
    maeModelo: mae(modelo),
    maeIngenuo: mae(ingenuo),
    filas,
  };
}

if (process.argv[1]?.includes('validate-real')) {
  console.log('VALIDACIÓN FUERA DE MUESTRA · datos reales LaLiga 2026/27 · sistema AS+Sofascore');
  console.log(`Modelo: k=${config.engine.shrinkageK} forma=${config.engine.formHalflife} minutos=${config.engine.minutesHalflife}\n`);
  console.log('corte    n   r modelo  r ingenuo   rho mod  rho ing   MAE mod  MAE ing');
  console.log('-----  ---  ---------  ---------  --------  -------  --------  -------');
  for (const corte of [3, 4, 5]) {
    const v = validar(corte);
    console.log(
      String(corte).padStart(5), String(v.n).padStart(4),
      v.rModelo.toFixed(3).padStart(10), v.rIngenuo.toFixed(3).padStart(11),
      v.rhoModelo.toFixed(3).padStart(9), v.rhoIngenuo.toFixed(3).padStart(8),
      v.maeModelo.toFixed(2).padStart(10), v.maeIngenuo.toFixed(2).padStart(8),
    );
  }
  console.log('\nr = correlación con lo que pasó DESPUÉS. El modelo debe ganarle al ingenuo.');
}
