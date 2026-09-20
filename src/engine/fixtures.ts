import type { Player } from '../domain/types.js';

/**
 * Contexto de partido: dónde se juega, contra quién, y cómo de bueno es cada
 * equipo. Lo que convierte "este jugador rinde X" en "este jugador rinde X en
 * su próximo partido concreto".
 */

/**
 * Ventaja de jugar en casa, MEDIDA en los datos de la propia competición en
 * vez de asumida. Devuelve el factor por el que hay que multiplicar el
 * rendimiento en casa respecto a la media.
 *
 * Importa incluso sin calendario: si un jugador ha tenido cuatro de seis
 * partidos en casa, su media está inflada, y sin corregirlo el modelo le
 * atribuye a él un mérito que era del calendario.
 */
export function homeAdvantage(players: Player[]): { home: number; away: number } {
  let ptsHome = 0, minHome = 0, ptsAway = 0, minAway = 0;

  for (const p of players) {
    for (const r of p.reports) {
      if (r.minutes <= 0 || r.home === undefined) continue;
      if (r.home) { ptsHome += r.points; minHome += r.minutes; }
      else { ptsAway += r.points; minAway += r.minutes; }
    }
  }

  if (minHome < 900 || minAway < 900) return { home: 1, away: 1 };

  const rateHome = (ptsHome / minHome) * 90;
  const rateAway = (ptsAway / minAway) * 90;
  const media = (rateHome * minHome + rateAway * minAway) / (minHome + minAway);
  if (media <= 0) return { home: 1, away: 1 };

  // Acotado: una diferencia enorme casi siempre es ruido de muestra pequeña.
  const clamp = (x: number) => Math.max(0.85, Math.min(1.15, x));
  return { home: clamp(rateHome / media), away: clamp(rateAway / media) };
}

/**
 * Fuerza de cada equipo, deducida del rendimiento acumulado de sus jugadores.
 * No hace falta la clasificación: si los jugadores de un equipo puntúan mucho,
 * es que el equipo gana partidos, marca y encaja poco, que es justo lo que
 * premia el sistema de puntos.
 *
 * Devuelve valores centrados en 1: por encima, equipo fuerte.
 */
export function teamStrength(players: Player[]): Record<number, number> {
  const acc: Record<number, { pts: number; min: number }> = {};

  for (const p of players) {
    for (const r of p.reports) {
      if (r.minutes <= 0) continue;
      const a = (acc[p.teamId] ??= { pts: 0, min: 0 });
      a.pts += r.points;
      a.min += r.minutes;
    }
  }

  const rates: Array<[number, number]> = Object.entries(acc)
    .filter(([, a]) => a.min >= 900)
    .map(([id, a]) => [Number(id), (a.pts / a.min) * 90]);

  if (rates.length < 4) return {};

  const media = rates.reduce((s, [, r]) => s + r, 0) / rates.length;
  if (media <= 0) return {};

  const out: Record<number, number> = {};
  for (const [id, rate] of rates) {
    out[id] = Math.max(0.8, Math.min(1.2, rate / media));
  }
  return out;
}

/**
 * Forma reciente de cada equipo: lo mismo que teamStrength pero ponderando las
 * jornadas recientes. Un equipo que empezó fuerte y lleva cinco jornadas
 * hundido no es el equipo que dice su media de temporada.
 */
export function teamForm(players: Player[], halflifeRounds = 3): Record<number, number> {
  const maxRound = Math.max(
    0,
    ...players.flatMap((p) => p.reports.filter((r) => r.minutes > 0).map((r) => r.round)),
  );
  if (maxRound === 0) return {};
  const lambda = Math.log(2) / Math.max(halflifeRounds, 1);

  const acc: Record<number, { pts: number; min: number }> = {};
  for (const p of players) {
    for (const r of p.reports) {
      if (r.minutes <= 0) continue;
      const w = Math.exp(-lambda * (maxRound - r.round));
      const a = (acc[p.teamId] ??= { pts: 0, min: 0 });
      a.pts += w * r.points;
      a.min += w * r.minutes;
    }
  }

  const rates: Array<[number, number]> = Object.entries(acc)
    .filter(([, a]) => a.min >= 450)
    .map(([id, a]) => [Number(id), (a.pts / a.min) * 90]);
  if (rates.length < 4) return {};

  const media = rates.reduce((s, [, r]) => s + r, 0) / rates.length;
  if (media <= 0) return {};

  const out: Record<number, number> = {};
  for (const [id, rate] of rates) out[id] = Math.max(0.75, Math.min(1.25, rate / media));
  return out;
}

/** Fila de la clasificación real, si la API la expone. */
export interface Standing {
  teamId: number;
  position: number;
  points?: number;
  played?: number;
}

/**
 * Calidad de cada equipo, mezclando lo que sabemos de él.
 *
 * Las tres fuentes miden en gran parte LO MISMO: la posición en la tabla es un
 * resumen de los resultados, y los puntos Biwenger de sus jugadores también.
 * Por eso no entran como factores independientes que se multiplican, sino como
 * una media ponderada de una sola estimación. Si se trataran por separado, un
 * rival fuerte penalizaría el triple de lo que debe.
 *
 * Reparto: la temporada manda porque es estable, la forma corrige a corto
 * plazo, y la clasificación sirve de ancla objetiva cuando la tenemos.
 */
export function teamQuality(
  players: Player[],
  standings?: Standing[],
): Record<number, number> {
  const temporada = teamStrength(players);
  const forma = teamForm(players);

  // La clasificación se convierte a la misma escala centrada en 1.
  const tabla: Record<number, number> = {};
  if (standings && standings.length >= 4) {
    const n = standings.length;
    for (const s of standings) {
      // 1º -> ~1.2, último -> ~0.8, lineal entre medias.
      const pct = (s.position - 1) / (n - 1);
      tabla[s.teamId] = 1.2 - 0.4 * pct;
    }
  }

  const ids = new Set([
    ...Object.keys(temporada).map(Number),
    ...Object.keys(forma).map(Number),
    ...Object.keys(tabla).map(Number),
  ]);

  const out: Record<number, number> = {};
  for (const id of ids) {
    const partes: Array<[number, number]> = [];
    if (temporada[id] !== undefined) partes.push([temporada[id]!, 0.45]);
    if (forma[id] !== undefined) partes.push([forma[id]!, 0.35]);
    if (tabla[id] !== undefined) partes.push([tabla[id]!, 0.20]);
    if (partes.length === 0) continue;

    const pesoTotal = partes.reduce((s, [, w]) => s + w, 0);
    out[id] = partes.reduce((s, [v, w]) => s + v * w, 0) / pesoTotal;
  }
  return out;
}

/** Un partido futuro de un equipo. */
export interface Fixture {
  teamId: number;
  opponentId: number;
  home: boolean;
}

/**
 * Ajuste para las próximas jornadas de un equipo: combina dónde juega con lo
 * fuerte que es el rival. Enfrentarse al mejor equipo fuera es lo más duro;
 * recibir al peor, lo más fácil.
 *
 * Sin calendario devuelve 1 y el modelo se comporta como hasta ahora. En
 * cuanto la fase 0 nos diga la forma de la llamada de jornadas, esto se
 * alimenta y ya está.
 */
export function fixtureFactor(
  teamId: number,
  fixtures: Fixture[],
  strength: Record<number, number>,
  venue: { home: number; away: number },
  horizon: number,
): number {
  const propios = fixtures.filter((f) => f.teamId === teamId).slice(0, horizon);
  if (propios.length === 0) return 1;

  const propio = strength[teamId] ?? 1;

  let total = 0;
  for (const f of propios) {
    const rival = strength[f.opponentId] ?? 1;
    // Rival fuerte penaliza, proporcional a su calidad.
    const dificultad = 2 - rival;
    // Y pesa cómo de bueno es tu propio equipo respecto al rival: un grande
    // visitando a un colista saca más que un colista recibiendo a otro colista.
    const desnivel = 1 + (propio - rival) * 0.25;
    total += dificultad * desnivel * (f.home ? venue.home : venue.away);
  }
  return Math.max(0.75, Math.min(1.3, total / propios.length));
}
