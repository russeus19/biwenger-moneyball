import type { LeagueState, Position } from '../domain/types.js';
import { POSITIONS } from '../domain/types.js';
import type { PlayerProjection } from './projection.js';

/**
 * Nivel de reemplazo: lo que te aporta el jugador que puedes conseguir gratis o
 * casi gratis en tu liga, por posición.
 *
 * Esta es la pieza que convierte "puntos" en valor real. Un defensa de 4 puntos
 * no vale nada si hay quince libres haciendo 3,8. El mismo defensa vale mucho si
 * el reemplazo en defensa está en 2,1. Y cambia solo a lo largo de la temporada.
 */

/** Tamaño de pool por debajo del cual el percentil alto es ruido, no señal. */
const MIN_POOL = 8;
/** Percentil del pool libre que se considera reemplazo realista. */
const DEFAULT_PERCENTILE = 0.75;

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)));
  return sorted[idx]!;
}

export function replacementLevel(
  state: LeagueState,
  projections: Map<number, PlayerProjection>,
  percentile = DEFAULT_PERCENTILE,
): Record<Position, number> {
  const owned = new Set<number>();
  for (const m of state.managers) for (const p of m.squad) owned.add(p.playerId);
  for (const p of state.me.squad) owned.add(p.playerId);

  // En Biwenger no puedes fichar a cualquier agente libre: solo a los que el
  // mercado muestra hoy. El reemplazo realista es ese subconjunto, no el pool
  // teórico de todos los no fichados.
  const availableToday = new Set(
    state.market.filter((m) => m.origin === 'free').map((m) => m.playerId),
  );

  /** Pool primario: libres que están hoy en el mercado. */
  const marketByPosition: Record<string, number[]> = { GK: [], DF: [], MF: [], FW: [] };
  /** Respaldo 1: cualquier libre, esté o no en el mercado hoy. */
  const freeByPosition: Record<string, number[]> = { GK: [], DF: [], MF: [], FW: [] };
  /** Respaldo 2: todos los que juegan, libres o no. */
  const allByPosition: Record<string, number[]> = { GK: [], DF: [], MF: [], FW: [] };

  for (const player of state.players) {
    const proj = projections.get(player.id);
    if (!proj) continue;
    // Ignoramos a quien no va a jugar: no es un reemplazo realista.
    if (proj.startProbability < 0.25) continue;

    allByPosition[player.position]!.push(proj.projectedPoints);
    if (!owned.has(player.id)) {
      freeByPosition[player.position]!.push(proj.projectedPoints);
      if (availableToday.has(player.id)) {
        marketByPosition[player.position]!.push(proj.projectedPoints);
      }
    }
  }

  const out = {} as Record<Position, number>;

  for (const pos of POSITIONS) {
    const inMarket = marketByPosition[pos]!.sort((a, b) => a - b);
    const free = freeByPosition[pos]!.sort((a, b) => a - b);
    const all = allByPosition[pos]!.sort((a, b) => a - b);

    // Pool preferente: lo que puedes fichar hoy. Si el mercado no trae nadie de
    // esa posición, caemos al pool libre general y luego al nivel de la liga.
    const pool = inMarket.length > 0 ? inMarket : free.length > 0 ? free : all;

    if (pool === all) {
      // Sin nadie disponible, el reemplazo no es cero: es el nivel del peor
      // titular de la liga. Devolver cero inflaba hasta el infinito el valor
      // de cualquier jugador de esa posición.
      out[pos] = quantile(all, 0.1);
      continue;
    }

    const level = quantile(pool, percentile);

    if (pool.length >= MIN_POOL) {
      out[pos] = level;
      continue;
    }

    // Pool pequeño: el percentil alto es un outlier, no el nivel al que puedes
    // reponer de forma fiable. Lo mezclamos con la mediana, dando más peso a la
    // mediana cuanta menos gente hay.
    const w = pool.length / MIN_POOL;
    out[pos] = w * level + (1 - w) * quantile(pool, 0.5);
  }

  return out;
}
