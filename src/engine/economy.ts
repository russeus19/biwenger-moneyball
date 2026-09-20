import type { LeagueState, Player, Recommendation } from '../domain/types.js';

/**
 * Economía del manager. Hasta ahora el motor calculaba un techo de VALOR (lo
 * que un jugador merece la pena) pero nunca comprobaba si el dinero llegaba.
 * Son dos límites distintos y manda el más bajo.
 */

/**
 * Modos de puja máxima que ofrece Biwenger en los ajustes de liga.
 * El recomendado por la propia guía de Biwenger es `saldo25`, precisamente
 * para poder endeudarse y cubrirlo después vendiendo.
 */
export type ModoPuja = 'saldo' | 'saldo25' | 'saldo50' | 'ilimitada';

const PORCENTAJE: Record<ModoPuja, number> = {
  saldo: 0,
  saldo25: 0.25,
  saldo50: 0.50,
  ilimitada: Infinity,
};

export interface Economia {
  saldo: number;
  valorPlantilla: number;
  modo: ModoPuja;
  /** Lo máximo que Biwenger te deja ofrecer por UN jugador. */
  limitePuja: number;
  /** Cuánto puedes endeudarte por encima del saldo. */
  margenDeuda: number;
}

export function calcularEconomia(
  state: LeagueState,
  modo: ModoPuja = 'saldo25',
): Economia {
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const valorPlantilla = state.me.squad.reduce(
    (s, x) => s + (byId.get(x.playerId)?.price ?? 0),
    0,
  );

  const margenDeuda = modo === 'ilimitada' ? Infinity : valorPlantilla * PORCENTAJE[modo];
  const limitePuja = state.me.balance + margenDeuda;

  return { saldo: state.me.balance, valorPlantilla, modo, limitePuja, margenDeuda };
}

export interface PlanLiquidez {
  /** Pujas recomendadas, en orden de prioridad. */
  prioridad: Array<{ playerId: number; puja: number; acumulado: number; cubierto: boolean }>;
  /** Suma de todas las pujas recomendadas. */
  exposicionTotal: number;
  /** Cuánto falta si ganases TODAS las pujas. */
  descubierto: number;
  /** Ventas que cubrirían ese descubierto. */
  ventasNecesarias: Array<{ playerId: number; ingreso: number }>;
  /** Avisos para el manager. */
  avisos: string[];
}

/**
 * El riesgo que nadie calcula: pujar por varios jugadores a la vez.
 *
 * Cada puja por separado puede caber en tu límite, pero si ganas todas, la
 * suma no. Biwenger te deja quedarte en negativo, pero tienes que cerrar en
 * positivo antes de la jornada o tu equipo no puntúa. Así que aquí se ordenan
 * las pujas por prioridad y se marca a partir de cuál dejas de estar cubierto.
 */
export function planificarLiquidez(
  compras: Recommendation[],
  ventas: Recommendation[],
  economia: Economia,
  byId: Map<number, Player>,
): PlanLiquidez {
  const recomendadas = compras
    .filter((r) => r.action === 'buy' && r.suggestedBid)
    .sort((a, b) => b.score - a.score);

  const prioridad: PlanLiquidez['prioridad'] = [];
  let acumulado = 0;
  for (const r of recomendadas) {
    acumulado += r.suggestedBid!;
    prioridad.push({
      playerId: r.playerId,
      puja: r.suggestedBid!,
      acumulado,
      cubierto: acumulado <= economia.limitePuja,
    });
  }

  const exposicionTotal = acumulado;
  const descubierto = Math.max(0, exposicionTotal - economia.limitePuja);

  // Ventas que taparían el agujero, de la que más aporta hacia abajo.
  const ventasNecesarias: PlanLiquidez['ventasNecesarias'] = [];
  if (descubierto > 0) {
    let falta = descubierto;
    const candidatas = ventas
      .filter((r) => r.action === 'sell')
      .map((r) => ({ playerId: r.playerId, ingreso: byId.get(r.playerId)?.price ?? 0 }))
      .sort((a, b) => b.ingreso - a.ingreso);
    for (const v of candidatas) {
      if (falta <= 0) break;
      ventasNecesarias.push(v);
      falta -= v.ingreso;
    }
  }

  const avisos: string[] = [];
  const eur = (n: number) => `${(n / 1e6).toFixed(1)}M€`;

  if (exposicionTotal > 0 && exposicionTotal > economia.saldo && exposicionTotal <= economia.limitePuja) {
    avisos.push(
      `Si ganas todas las pujas te quedas en negativo (${eur(exposicionTotal - economia.saldo)}). ` +
        `Entra dentro del límite, pero tienes que cerrar en positivo antes de la jornada o tu equipo no puntúa.`,
    );
  }
  if (descubierto > 0) {
    const cubiertas = prioridad.filter((p) => p.cubierto).length;
    const cuantas =
      cubiertas === 0 ? 'Ninguna cabe' :
      cubiertas === 1 ? 'Solo cabe la primera' :
      `Solo caben las ${cubiertas} primeras`;
    avisos.push(
      `Las ${recomendadas.length} pujas suman ${eur(exposicionTotal)} y tu límite es ` +
        `${eur(economia.limitePuja)}. ${cuantas}: para el resto hay que vender antes.`,
    );
  }
  if (economia.saldo < 0) {
    avisos.push(`Estás en negativo (${eur(economia.saldo)}). Vende antes de la jornada.`);
  }

  return { prioridad, exposicionTotal, descubierto, ventasNecesarias, avisos };
}
