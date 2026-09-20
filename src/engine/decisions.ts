import type { LeagueState, Player, Position, Recommendation } from '../domain/types.js';
import type { PlayerProjection } from './projection.js';
import { bestXI, toCandidates, shadowPrice, type Candidate } from './lambda.js';
import { replacementLevel } from './replacement.js';
import { calcularEconomia, type Economia, type ModoPuja } from './economy.js';
import { ajustarPrecios, revalorizacion, type Revalorizacion } from './valuation.js';

export interface EngineOutput {
  lambda: number;
  /** Fichajes que mejoran tu once Y te dejan dinero: prioridad absoluta. */
  freeUpgrades: Array<{ inId: number; outId: number; gain: number; ingreso: number }>;
  replacement: Record<Position, number>;
  economia: Economia;
  buys: Recommendation[];
  sells: Recommendation[];
}

/**
 * Margen mínimo para recomendar una venta, como fracción del precio.
 * Sin este umbral, cualquier excedente positivo por pequeño que sea marcaba el
 * jugador como vendible y el sistema te decía que vendieras la plantilla entera,
 * que es un consejo inútil. Vender tiene fricción: hay que ganar la reinversión.
 */
const SELL_MARGIN = 0.2;

/** Percentil de un valor dentro de un array ya ordenado ascendente. */
function percentileOf(sorted: number[], value: number): number {
  if (sorted.length === 0) return 0.5;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}

export function evaluate(
  state: LeagueState,
  projections: Map<number, PlayerProjection>,
  opts: { horizonRounds: number; modoPuja?: ModoPuja },
): EngineOutput {
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const replacement = replacementLevel(state, projections);
  const economia = calcularEconomia(state, opts.modoPuja ?? 'saldo25');

  // Calidad del JUGADOR, separada de si la operación compensa. Son dos cosas
  // distintas y mezclarlas confunde: Yamal puede ser un 9,8 como futbolista y
  // un 4,9 como compra a 24 millones. Percentil dentro de su posición.
  const porPosicionProy = new Map<Position, number[]>();
  for (const p of state.players) {
    const pr = projections.get(p.id);
    if (!pr || pr.startProbability < 0.25) continue;
    if (!porPosicionProy.has(p.position)) porPosicionProy.set(p.position, []);
    porPosicionProy.get(p.position)!.push(pr.projectedPoints);
  }
  for (const arr of porPosicionProy.values()) arr.sort((a, b) => a - b);

  const calidadDe = (playerId: number): number => {
    const p = byId.get(playerId);
    const pr = projections.get(playerId);
    if (!p || !pr) return 5;
    const pool = porPosicionProy.get(p.position);
    if (!pool || pool.length < 4) return 5;
    return Math.round(percentileOf(pool, pr.projectedPoints) * 100) / 10;
  };

  // Umbral de irregularidad autocalibrado. Estaba fijado en 3, pero la
  // desviación típica mediana en Biwenger es ~4 (la escala de picas salta de
  // -2 a 2 a 6 a 10), así que ese umbral marcaba como irregular al 79% de la
  // liga y el aviso no distinguía nada. El percentil 75 sí señala a los raros.
  const volatilidades = [...projections.values()]
    .map((p) => p.volatility)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const umbralVolatilidad = volatilidades.length
    ? volatilidades[Math.floor(volatilidades.length * 0.75)]!
    : 4;

  const mySquad: Candidate[] = toCandidates(
    state.me.squad.map((s) => byId.get(s.playerId)).filter((p): p is Player => !!p),
    projections,
  );

  const marketPool: Candidate[] = state.market
    .map((m) => {
      const player = byId.get(m.playerId);
      const proj = projections.get(m.playerId);
      if (!player || !proj) return null;
      return {
        playerId: m.playerId,
        position: player.position,
        price: m.askingPrice,
        projectedPoints: proj.projectedPoints,
      } satisfies Candidate;
    })
    .filter((c): c is Candidate => c !== null);

  const { lambda, gratis } = shadowPrice(mySquad, marketPool, state.me.balance);
  const rectas = ajustarPrecios(state.players, projections);
  const baseXI = bestXI(mySquad);
  const inLineup = new Set(baseXI.lineup.map((c) => c.playerId));

  // ---- Compras -----------------------------------------------------------
  const buys: Recommendation[] = [];

  for (const entry of state.market) {
    const player = byId.get(entry.playerId);
    const proj = projections.get(entry.playerId);
    if (!player || !proj) continue;

    // Cuánto mejora tu ONCE, no a quién sustituye en su posición.
    //
    // Antes se buscaba al peor titular de su MISMA posición y se restaba. Eso
    // daba por hecho que un medio solo puede sustituir a un medio, cuando
    // `bestXI` prueba las seis formaciones: fichar un medio puede hacer que te
    // convenga pasar a 3-5-2 y el que sale es un defensa. Con la comparación
    // por posición eso era invisible.
    //
    // Recalcular el mejor once con él dentro resuelve de golpe los tres casos:
    // a quién desplaza de verdad, el cambio de esquema, y que no desplace a
    // nadie (entonces la mejora es cero y solo queda la plusvalía).
    const candidato: Candidate = {
      playerId: player.id,
      position: player.position,
      price: entry.askingPrice,
      projectedPoints: proj.projectedPoints,
    };
    const conEl = bestXI(mySquad.concat(candidato));
    const delta = conEl.points - baseXI.points;

    // Pueden salir VARIOS del once a la vez: entra un portero mejor y además
    // el esquema se reajusta. Con `find` se informaba solo del primero, que a
    // veces no era ni el relevante.
    const enNuevo = new Set(conEl.lineup.map((c) => c.playerId));
    const salen = baseXI.lineup.filter((c) => !enNuevo.has(c.playerId));
    // El "desplazado" principal es el de su misma posición si lo hay, y si no
    // el que menos aportaba.
    const displaced =
      salen.find((c) => c.position === player.position) ??
      (salen.length
        ? salen.reduce((a, b) => (a.projectedPoints < b.projectedPoints ? a : b))
        : null);
    const cambiaEsquema =
      conEl.formation.DF !== baseXI.formation.DF ||
      conEl.formation.MF !== baseXI.formation.MF ||
      conEl.formation.FW !== baseXI.formation.FW;

    // Techo: el precio al que esos puntos extra cuestan lo mismo que
    // conseguirlos gastando el dinero en cualquier otra cosa.
    //
    // Deliberadamente NO se suma el precio del desplazado. Hacerlo asumía que
    // lo vendes, y entonces un jugador sin minutos heredaba el valor del
    // titular al que sustituye: el sistema recomendaba porteros con proyección
    // cero y techo de 18M. Comprar y vender son dos decisiones separadas; la
    // venta la evalúa el bloque de abajo.
    const valorPuntos = Math.max(0, (delta / lambda) * 1_000_000);

    // La plusvalía es dinero tan real como los puntos: si compras a 500.000 y
    // en seis jornadas vale 1,5M, has ganado un millón. Por eso suma al techo.
    // Un titular barato puede no aportar apenas puntos y ser aun así una buena
    // operación por esto.
    const reval = revalorizacion(player, proj, rectas[player.position]);
    const maxBid = Math.max(0, valorPuntos + Math.max(0, reval.esperada));

    // Quien no va a jugar no es un fichaje, por barato que esté.
    const unplayable =
      proj.startProbability < 0.2 ||
      proj.projectedPoints <= 0 ||
      player.availability === 'suspended' ||
      player.availability === 'out';

    const reasons: string[] = [];
    if (unplayable) reasons.push('Sin minutos o no disponible: descartado');
    reasons.push(`Proyecta ${proj.projectedPoints.toFixed(1)} pts en ${opts.horizonRounds} jornadas`);
    reasons.push(`${(proj.startProbability * 100).toFixed(0)}% de probabilidad de ser titular`);
    reasons.push(`${proj.shrunkPer90.toFixed(2)} pts/90 tras regresión`);
    if (salen.length > 0) {
      const nombres = salen.map((c) => byId.get(c.playerId)?.name ?? String(c.playerId));
      reasons.push(
        `Sale del once ${nombres.join(' y ')} (+${delta.toFixed(1)} pts)` +
          (cambiaEsquema
            ? `, pasando de ${baseXI.formation.DF}-${baseXI.formation.MF}-${baseXI.formation.FW}` +
              ` a ${conEl.formation.DF}-${conEl.formation.MF}-${conEl.formation.FW}`
            : ''),
      );
    } else if (delta <= 0) {
      reasons.push('No entraría en tu once: su valor está solo en la revalorización');
    }
    if (reval.esperada >= player.price * 0.12) {
      reasons.push(
        `Revalorización esperada +${(reval.esperada / 1e6).toFixed(1)}M€ ` +
          `(${reval.porcentaje > 0 ? '+' : ''}${reval.porcentaje}%): el precio va por detrás de su rendimiento`,
      );
    } else if (reval.esperada <= -player.price * 0.12) {
      reasons.push(
        `Riesgo de bajada ${(reval.esperada / 1e6).toFixed(1)}M€ (${reval.porcentaje}%)`,
      );
    }
    if (proj.volatility > umbralVolatilidad) {
      reasons.push(`Más irregular que 3 de cada 4 (desviación ${proj.volatility.toFixed(1)})`);
    }
    if (player.availability !== 'ok') reasons.push(`Estado: ${player.availability}`);
    if (player.priceDelta < 0) reasons.push(`Precio a la baja (${(player.priceDelta / 1000).toFixed(0)}k)`);

    buys.push({
      playerId: player.id,
      projectedPoints: proj.projectedPoints,
      startProbability: proj.startProbability,
      expectedMinutes: proj.expectedMinutes,
      shrunkPer90: proj.shrunkPer90,
      volatility: proj.volatility,
      pointsOverReplacement: proj.projectedPoints - replacement[player.position],
      maxBid,
      score: 0, // se rellena abajo, por percentil
      quality: calidadDe(player.id),
      appreciation: reval,
      valueFromPoints: Math.round(valorPuntos),
      reasons,
      action: !unplayable && maxBid > entry.askingPrice ? 'buy' : 'avoid',
      askingPrice: entry.askingPrice,
      suggestedBid: undefined,
      displacesPlayerId: displaced?.playerId,
    });
  }

  assignScores(buys, byId);
  assignSuggestedBids(buys, economia);

  // Decirlo con palabras: un buen jugador caro no es un mal jugador.
  for (const r of buys) {
    if (r.action === 'avoid' && (r.quality ?? 0) >= 7 && r.askingPrice) {
      const exceso = r.askingPrice - r.maxBid;
      r.reasons.unshift(
        `Gran jugador (${r.quality!.toFixed(1)} de calidad), pero piden ` +
          `${(exceso / 1e6).toFixed(1)}M€ más de lo que te aporta a TI`,
      );
    }
  }

  // ---- Ventas ------------------------------------------------------------
  // Misma ecuación girada: vendes cuando el mercado te paga más de lo que el
  // jugador vale PARA TI, que es su diferencia con quien jugaría en su lugar.
  const sells: Recommendation[] = [];

  for (const owned of mySquad) {
    const player = byId.get(owned.playerId);
    const proj = projections.get(owned.playerId);
    if (!player || !proj) continue;

    // Lo que aporta de verdad: cuánto caería tu mejor once sin él. Mismo
    // criterio que en las compras, y por el mismo motivo: sin él el esquema
    // puede cambiar y taparse el hueco desde otra posición.
    const sinEl = bestXI(mySquad.filter((c) => c.playerId !== owned.playerId));
    const aporte = baseXI.points - sinEl.points;

    const revalVenta = revalorizacion(player, proj, rectas[player.position]);
    // Si va a subir, ese dinero futuro también es valor: no lo vendas justo antes.
    const valueToMe =
      (aporte / lambda) * 1_000_000 + Math.max(0, revalVenta.esperada);
    const surplus = player.price - valueToMe;

    const reasons: string[] = [];
    if (aporte <= 0.05) {
      reasons.push('Sin él tu mejor once no baja: no aporta nada al equipo que pones');
    } else if (!inLineup.has(owned.playerId)) {
      reasons.push(`Suplente, pero su salida costaría ${aporte.toFixed(1)} pts por el reajuste`);
    }
    if (surplus > 0) {
      reasons.push(`El mercado paga ${(surplus / 1e6).toFixed(1)}M€ por encima de su valor para ti`);
    }
    if (proj.startProbability < 0.5) {
      reasons.push(`Minutos a la baja (${(proj.startProbability * 100).toFixed(0)}%)`);
    }
    if (revalVenta.esperada >= player.price * 0.12) {
      reasons.push(
        `Se espera que suba ${(revalVenta.esperada / 1e6).toFixed(1)}M€: quizá conviene esperar`,
      );
    } else if (player.priceDelta > 0) {
      reasons.push(`Precio al alza (+${(player.priceDelta / 1000).toFixed(0)}k)`);
    }

    sells.push({
      playerId: player.id,
      projectedPoints: proj.projectedPoints,
      startProbability: proj.startProbability,
      expectedMinutes: proj.expectedMinutes,
      shrunkPer90: proj.shrunkPer90,
      volatility: proj.volatility,
      pointsOverReplacement: proj.projectedPoints - replacement[player.position],
      maxBid: valueToMe,
      score: 0,
      quality: calidadDe(player.id),
      appreciation: revalVenta,
      reasons,
      action: surplus > player.price * SELL_MARGIN ? 'sell' : 'hold',
    });
  }

  assignScores(sells, byId, /* invert */ true);

  // Vender exige tener con quién cubrir el hueco. Sin esta restricción el
  // sistema te decía que vendieras casi la plantilla entera, incluidos los
  // únicos jugadores de su posición, que es un consejo que no puedes seguir.
  const squadCountByPos: Record<string, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const c of mySquad) squadCountByPos[c.position]!++;

  const eligible = sells.filter((r) => {
    if (r.action !== 'sell') return false;
    const pos = byId.get(r.playerId)?.position;
    if (!pos) return false;
    // Tiene que quedar al menos un jugador de sobra en esa posición.
    return squadCountByPos[pos]! > baseXI.formation[pos];
  });

  // Y aunque varias cumplan, listar quince ventas no es accionable.
  const topSells = new Set(
    eligible
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((r) => r.playerId),
  );
  for (const r of sells) {
    if (r.action === 'sell' && !topSells.has(r.playerId)) r.action = 'hold';
  }

  buys.sort((a, b) => b.score - a.score);
  sells.sort((a, b) => b.score - a.score);

  return { lambda, replacement, economia, freeUpgrades: gratis, buys, sells };
}

/**
 * Nota 0-10 por percentil dentro de la posición. Así un 8 significa
 * literalmente "está en el top del pool", no un umbral inventado a mano.
 */
function assignScores(
  recs: Recommendation[],
  byId: Map<number, Player>,
  invert = false,
): void {
  const byPosition = new Map<Position, number[]>();

  const edgeOf = (r: Recommendation): number => {
    if (invert) {
      // Para ventas, la "nota" es lo apremiante que es vender.
      const player = byId.get(r.playerId);
      const price = player?.price ?? 0;
      return r.maxBid > 0 ? (price - r.maxBid) / Math.max(price, 1) : 1;
    }
    const ask = r.askingPrice ?? 0;
    return ask > 0 ? (r.maxBid - ask) / ask : 0;
  };

  for (const r of recs) {
    const pos = byId.get(r.playerId)?.position;
    if (!pos) continue;
    if (!byPosition.has(pos)) byPosition.set(pos, []);
    byPosition.get(pos)!.push(edgeOf(r));
  }
  for (const arr of byPosition.values()) arr.sort((a, b) => a - b);

  for (const r of recs) {
    const pos = byId.get(r.playerId)?.position;
    const pool = pos ? byPosition.get(pos) : undefined;
    const raw = pool ? percentileOf(pool, edgeOf(r)) * 10 : 5;

    // El percentil solo ordena. Sin anclaje, el mejor de un mercado pésimo
    // sacaba un 9 aunque su techo estuviese muy por debajo de lo que piden.
    // El 5 marca la frontera: por encima compensa, por debajo no.
    const worthIt = invert
      ? edgeOf(r) > 0
      : (r.askingPrice ?? 0) > 0 && r.maxBid > (r.askingPrice ?? 0);

    const anchored = worthIt ? Math.max(5, raw) : Math.min(4.9, raw);
    r.score = Math.round(anchored * 10) / 10;
  }
}

/**
 * Puja sugerida. Como la subasta es a ciegas, pujar el techo regala todo el
 * excedente. Repartimos: cuanto más alta la nota, más cerca del techo.
 *
 * TODO: sustituir este reparto fijo por la curva real de cierres de tu liga
 * en cuanto el histórico tenga suficientes ventas observadas.
 */
function assignSuggestedBids(recs: Recommendation[], economia: Economia): void {
  for (const r of recs) {
    if (r.action !== 'buy' || r.askingPrice == null) continue;
    const aggressiveness = 0.45 + 0.05 * r.score; // 0.45 a 0.95 del margen
    const bid = r.askingPrice + (r.maxBid - r.askingPrice) * aggressiveness;

    // Hay DOS techos y manda el más bajo: lo que el jugador vale (maxBid) y lo
    // que Biwenger te deja ofrecer (limitePuja). Antes solo se miraba el
    // primero y el sistema podía sugerir pujas que no podías pagar.
    const tope = Math.min(r.maxBid, economia.limitePuja);
    r.suggestedBid = Math.round(Math.min(bid, tope) / 1000) * 1000;

    if (r.maxBid > economia.limitePuja) {
      r.reasons.push(
        `Tu límite de puja (${(economia.limitePuja / 1e6).toFixed(1)}M€) queda por debajo de lo que vale`,
      );
    }
    if (r.askingPrice > economia.limitePuja) {
      r.action = 'avoid';
      r.reasons.unshift('No te alcanza: piden más de tu límite de puja');
    }
  }
}
