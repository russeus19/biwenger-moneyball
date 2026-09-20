import { getDb } from '../storage/db.js';

/**
 * El listón no es cero: es la heurística tonta de ordenar por media de puntos.
 * Si el modelo no le gana de forma consistente, no aporta nada y mejor saberlo
 * pronto. Necesita varias jornadas de histórico acumulado para decir algo.
 */

interface Row {
  player_id: number;
  projected: number;
  naive: number;
  actual: number;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return num / Math.sqrt(dx * dy);
}

function mae(xs: number[], ys: number[]): number {
  return xs.reduce((s, x, i) => s + Math.abs(x - ys[i]!), 0) / xs.length;
}

function main() {
  const db = getDb();
  if (!db) {
    console.log('Sin almacenamiento: el backtest necesita Node 22.5 o superior.');
    return;
  }
  const rounds = db
    .prepare('SELECT DISTINCT round FROM round_result ORDER BY round')
    .all() as Array<{ round: number }>;

  if (rounds.length < 3) {
    console.log(
      `Solo hay ${rounds.length} jornada(s) de histórico. ` +
        `Deja correr el snapshot diario unas semanas antes de sacar conclusiones.`,
    );
    return;
  }

  console.log('jornada | n | r(modelo) | r(ingenuo) | MAE modelo');
  console.log('--------|---|-----------|------------|-----------');

  for (const { round } of rounds) {
    // Valoraciones emitidas ANTES de esa jornada, contra lo que realmente pasó.
    const rows = db
      .prepare(
        `SELECT v.player_id,
                v.projected_points AS projected,
                (SELECT AVG(points) FROM round_result r2
                  WHERE r2.player_id = v.player_id AND r2.round < ?) AS naive,
                rr.points AS actual
           FROM valuation v
           JOIN round_result rr ON rr.player_id = v.player_id AND rr.round = ?
          WHERE v.date < date('now')
          GROUP BY v.player_id`,
      )
      .all(round, round) as Row[];

    const clean = rows.filter(
      (r) => Number.isFinite(r.projected) && Number.isFinite(r.actual) && r.naive != null,
    );
    if (clean.length < 10) continue;

    const projected = clean.map((r) => r.projected);
    const naive = clean.map((r) => r.naive);
    const actual = clean.map((r) => r.actual);

    console.log(
      `${String(round).padStart(7)} | ${String(clean.length).padStart(3)} | ` +
        `${pearson(projected, actual).toFixed(3).padStart(9)} | ` +
        `${pearson(naive, actual).toFixed(3).padStart(10)} | ` +
        `${mae(projected, actual).toFixed(2).padStart(10)}`,
    );
  }

  console.log(
    `\nSi la columna r(modelo) no supera a r(ingenuo) de forma consistente, ` +
      `el modelo todavía no aporta.`,
  );
}

main();
