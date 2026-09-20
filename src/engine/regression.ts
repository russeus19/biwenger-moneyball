import type { Player, Position, RoundReport } from '../domain/types.js';

/**
 * Encoge lo observado hacia una media previa según el tamaño de muestra.
 * Con pocos partidos, el modelo casi no se cree lo que ve. Esto es lo que evita
 * que tres partidazos disparen la nota, que es justo el error que comete el
 * precio de Biwenger.
 */
export function shrink(
  observedPer90: number,
  minutesPlayed: number,
  priorPer90: number,
  k: number,
): number {
  const n = minutesPlayed / 90;
  const weight = n / (n + k);
  return weight * observedPer90 + (1 - weight) * priorPer90;
}

/**
 * Media ponderada exponencialmente: las jornadas recientes pesan más.
 *
 * Si se pasa `venue`, cada jornada se normaliza por dónde se jugó, de modo que
 * el resultado es el rendimiento "en campo neutral". Sin esto, un jugador que
 * ha tenido cuatro de seis partidos en casa sale sobrevalorado por mérito del
 * calendario, no suyo.
 */
export function weightedPer90(
  reports: RoundReport[],
  halflifeRounds: number,
  venue?: { home: number; away: number },
): {
  per90: number;
  /** Puntos por partido calificado. En Biwenger es la magnitud natural. */
  perAppearance: number;
  minutes: number;
  volatility: number;
} {
  // Biwenger no califica a quien juega menos de 10 minutos: se lleva 0 puntos
  // pase lo que pase. Meter esas apariciones en el cálculo del ritmo hunde la
  // media de cualquier suplente, porque suma minutos que era IMPOSIBLE
  // puntuar. Cuentan para la titularidad, no para el ritmo.
  const CALIFICABLE = 10;
  const played = reports.filter((r) => r.minutes >= CALIFICABLE);
  if (played.length === 0) return { per90: 0, perAppearance: 0, minutes: 0, volatility: 0 };

  const maxRound = Math.max(...played.map((r) => r.round));
  const lambda = Math.log(2) / Math.max(halflifeRounds, 1);

  let wPoints = 0;
  let wMinutes = 0;
  let wCount = 0;
  for (const r of played) {
    const age = maxRound - r.round;
    const w = Math.exp(-lambda * age);
    const ajuste = venue && r.home !== undefined ? (r.home ? venue.home : venue.away) : 1;
    wPoints += (w * r.points) / ajuste;
    wMinutes += w * r.minutes;
    wCount += w;
  }

  const per90 = wMinutes > 0 ? (wPoints / wMinutes) * 90 : 0;
  const perAppearance = wCount > 0 ? wPoints / wCount : 0;

  // Volatilidad sobre puntuaciones por partido, sin ponderar.
  const mean = played.reduce((s, r) => s + r.points, 0) / played.length;
  const variance =
    played.reduce((s, r) => s + (r.points - mean) ** 2, 0) / Math.max(played.length - 1, 1);

  return {
    per90,
    perAppearance,
    minutes: played.reduce((s, r) => s + r.minutes, 0),
    volatility: Math.sqrt(variance),
  };
}

/**
 * Prior por posición: el centro de la distribución de puntos por 90 de esa
 * posición. Es el "no sé nada de ti, asumo que eres del montón" contra el que
 * se regresa.
 *
 * Usa media recortada al 10% por cada extremo, no mediana. Las puntuaciones de
 * Biwenger están sesgadas a la derecha (la escala llega a 14 y el suelo
 * práctico es -2, más los extras por gol), así que la mediana queda por debajo
 * de la media y regresar hacia ella empujaba a TODA la liga hacia abajo. El
 * recorte conserva la robustez frente a valores extremos sin ese sesgo.
 */
export function positionPriors(
  players: Player[],
  halflife: number,
  venue?: { home: number; away: number },
): Record<Position, number> {
  const buckets: Record<string, number[]> = { GK: [], DF: [], MF: [], FW: [] };

  for (const p of players) {
    const { perAppearance, minutes } = weightedPer90(p.reports, halflife, venue);
    if (minutes >= 270) buckets[p.position]!.push(perAppearance);
  }

  const out = {} as Record<Position, number>;
  for (const [pos, values] of Object.entries(buckets)) {
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length === 0) { out[pos as Position] = 0; continue; }
    const recorte = Math.floor(sorted.length * 0.10);
    const centro = sorted.slice(recorte, sorted.length - recorte);
    const usar = centro.length > 0 ? centro : sorted;
    out[pos as Position] = usar.reduce((s, v) => s + v, 0) / usar.length;
  }
  return out;
}
