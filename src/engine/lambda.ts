import type { Player, Position } from '../domain/types.js';
import type { PlayerProjection } from './projection.js';

export interface Formation {
  GK: number;
  DF: number;
  MF: number;
  FW: number;
}

/** Formaciones legales habituales en Biwenger. */
export const FORMATIONS: Formation[] = [
  { GK: 1, DF: 5, MF: 4, FW: 1 },
  { GK: 1, DF: 5, MF: 3, FW: 2 },
  { GK: 1, DF: 4, MF: 4, FW: 2 },
  { GK: 1, DF: 4, MF: 3, FW: 3 },
  { GK: 1, DF: 3, MF: 4, FW: 3 },
  { GK: 1, DF: 3, MF: 5, FW: 2 },
];

export interface Candidate {
  playerId: number;
  position: Position;
  price: number;
  projectedPoints: number;
}

export function toCandidates(
  players: Player[],
  projections: Map<number, PlayerProjection>,
): Candidate[] {
  const out: Candidate[] = [];
  for (const p of players) {
    const proj = projections.get(p.id);
    if (!proj) continue;
    out.push({
      playerId: p.id,
      position: p.position,
      price: p.price,
      projectedPoints: proj.projectedPoints,
    });
  }
  return out;
}

/** Mejor once de una plantilla ya fijada, sin gastar dinero. */
export function bestXI(
  squad: Candidate[],
): { points: number; lineup: Candidate[]; formation: Formation } {
  let best = { points: -1, lineup: [] as Candidate[], formation: FORMATIONS[0]! };

  const byPos: Record<Position, Candidate[]> = { GK: [], DF: [], MF: [], FW: [] };
  for (const c of squad) byPos[c.position].push(c);
  for (const pos of Object.keys(byPos) as Position[]) {
    byPos[pos].sort((a, b) => b.projectedPoints - a.projectedPoints);
  }

  for (const f of FORMATIONS) {
    const lineup: Candidate[] = [];
    let ok = true;
    for (const pos of Object.keys(f) as Position[]) {
      const picked = byPos[pos].slice(0, f[pos]);
      if (picked.length < f[pos]) {
        ok = false;
        break;
      }
      lineup.push(...picked);
    }
    if (!ok) continue;
    const points = lineup.reduce((s, c) => s + c.projectedPoints, 0);
    if (points > best.points) best = { points, lineup, formation: f };
  }

  // Plantilla incompleta: ninguna formación legal encaja (por ejemplo, menos de
  // tres medios). Hay que devolver algo, pero RESPETANDO los topes por
  // posición.
  //
  // El respaldo anterior cogía los once mejores sin mirar posición, y eso
  // alineaba dos y hasta tres porteros a la vez, además de mentir sobre la
  // formación. Ahora se rellena cada formación hasta donde alcance la
  // plantilla, dejando huecos vacíos en vez de inventarse titulares.
  if (best.points < 0) {
    for (const f of FORMATIONS) {
      const lineup: Candidate[] = [];
      for (const pos of Object.keys(f) as Position[]) {
        lineup.push(...byPos[pos].slice(0, f[pos])); // nunca más de los que pide
      }
      const points = lineup.reduce((s, c) => s + c.projectedPoints, 0);
      if (points > best.points) best = { points, lineup, formation: f };
    }
  }

  return best;
}

/**
 * Sobreprecio esperado al ganar una subasta a ciegas. Pujar el precio de salida
 * casi nunca gana, así que calcular lambda con el precio de salida sobreestima
 * lo que tu dinero puede comprar de verdad.
 * TODO: sustituir por la curva real de cierres de tu liga cuando haya histórico.
 */
const AUCTION_PREMIUM = 1.15;

/** Comprar a uno y vender a otro sale gratis o te deja dinero. */
export interface MejoraGratis {
  inId: number;
  outId: number;
  gain: number;
  /** Lo que INGRESAS al hacerla, en euros. */
  ingreso: number;
}

/**
 * Precio sombra del presupuesto: tu tipo de cambio real entre euros y puntos.
 *
 * Mide lo mismo que la valoración de cada fichaje, y eso importa: si el
 * numerador y el denominador no usan la misma definición de "mejora", los
 * techos salen inflados o hundidos sin que se note.
 *
 * La definición es **añadir**, no intercambiar: en Biwenger la plantilla tiene
 * hueco, así que fichar cuesta el precio entero y la ganancia es lo que sube tu
 * mejor once al meterlo. La versión anterior asumía que vendías a alguien de su
 * misma posición para pagarlo, lo cual restaba un dinero que no tienes por qué
 * ingresar y forzaba la comparación dentro de la posición.
 *
 * Lambda es la tasa media a la que tu presupuesto se convierte en puntos
 * gastándolo lo mejor posible, no la eficiencia de la operación marginal: en un
 * mercado pequeño, una ganga suelta de un millón no puede fijar la vara con la
 * que se juzga un fichaje de veinticinco.
 */
export function shadowPrice(
  squad: Candidate[],
  marketPool: Candidate[],
  budget: number,
): { lambda: number; gratis: MejoraGratis[] } {
  const base = bestXI(squad);
  const realistic = marketPool.map((c) => ({ ...c, price: c.price * AUCTION_PREMIUM }));

  const opciones: Array<{ coste: number; gain: number; efficiency: number }> = [];
  for (const buy of realistic) {
    const gain = bestXI(squad.concat(buy)).points - base.points;
    if (gain <= 0 || buy.price <= 0) continue;
    opciones.push({ coste: buy.price, gain, efficiency: gain / (buy.price / 1_000_000) });
  }

  // Pares comprar+vender que salen gratis o dejan dinero. No fijan lambda
  // (no consumen presupuesto) pero son la mejor recomendación posible.
  const gratis: MejoraGratis[] = [];
  for (const buy of realistic) {
    for (const out of squad) {
      if (buy.price > out.price) continue;
      const nuevo = squad.filter((c) => c.playerId !== out.playerId).concat(buy);
      const gain = bestXI(nuevo).points - base.points;
      if (gain <= 0) continue;
      gratis.push({ inId: buy.playerId, outId: out.playerId, gain, ingreso: out.price - buy.price });
    }
  }
  // Una entrada por fichaje: la venta que más puntos gana.
  const mejorPorFichaje = new Map<number, MejoraGratis>();
  for (const g of gratis) {
    const prev = mejorPorFichaje.get(g.inId);
    if (!prev || g.gain > prev.gain) mejorPorFichaje.set(g.inId, g);
  }
  const gratisUnicas = [...mejorPorFichaje.values()].sort((a, b) => b.gain - a.gain);

  if (opciones.length > 0) {
    opciones.sort((a, b) => b.efficiency - a.efficiency);
    let gastado = 0;
    let ganado = 0;
    for (const o of opciones) {
      // continue, NO break: que una operación cara no quepa no significa que
      // las siguientes, más baratas, tampoco.
      if (gastado + o.coste > budget) continue;
      gastado += o.coste;
      ganado += o.gain;
    }
    if (gastado > 0) return { lambda: ganado / (gastado / 1_000_000), gratis: gratisUnicas };
    return { lambda: opciones[0]!.efficiency, gratis: gratisUnicas };
  }

  const efficiencies = marketPool
    .filter((c) => c.price > 0 && c.projectedPoints > 0)
    .map((c) => c.projectedPoints / (c.price / 1_000_000))
    .sort((a, b) => a - b);
  if (efficiencies.length === 0) return { lambda: 1, gratis: gratisUnicas };
  return { lambda: efficiencies[Math.floor(efficiencies.length / 2)]!, gratis: gratisUnicas };
}
