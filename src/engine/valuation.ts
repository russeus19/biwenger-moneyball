import type { Player, Position } from '../domain/types.js';
import type { PlayerProjection } from './projection.js';

/**
 * Revalorización esperada.
 *
 * El motor solo miraba puntos, y eso deja fuera media ecuación: en Biwenger un
 * jugador barato que juega y puntúa SUBE de precio, y esa plusvalía es dinero
 * tan real como los puntos. Un titular de 500.000 € que rinda puede doblar su
 * valor en un mes, y en porcentaje eso es muchísimo más de lo que sube un
 * jugador de 25 millones.
 *
 * La mecánica que explotamos es la misma ineficiencia de siempre: el precio de
 * Biwenger reacciona a los puntos YA marcados, así que va por detrás. Quien
 * rinde por encima de lo que su precio implica, sube. Quien rinde por debajo,
 * baja.
 */

/** Recta precio ≈ a + b · puntos por partido, ajustada por posición. */
export interface RectaPrecio {
  a: number;
  b: number;
  n: number;
}

/**
 * Ajusta la relación entre rendimiento y precio en la liga, por posición.
 * Recorta el 10% de cada extremo antes de ajustar, porque un par de estrellas
 * con sobreprecio de fama torcerían la recta entera.
 */
export function ajustarPrecios(
  players: Player[],
  projections: Map<number, PlayerProjection>,
): Record<Position, RectaPrecio> {
  const porPos: Record<string, Array<[number, number]>> = { GK: [], DF: [], MF: [], FW: [] };

  for (const p of players) {
    const pr = projections.get(p.id);
    if (!pr || p.price <= 0) continue;
    if (pr.startProbability < 0.3) continue; // los que no juegan no fijan precio
    porPos[p.position]!.push([pr.projectedPoints, p.price]);
  }

  const out = {} as Record<Position, RectaPrecio>;
  for (const pos of ['GK', 'DF', 'MF', 'FW'] as Position[]) {
    const datos = porPos[pos]!;
    if (datos.length < 6) { out[pos] = { a: 0, b: 0, n: datos.length }; continue; }

    // Recorte por precio para quitar los extremos de fama.
    const ordenados = [...datos].sort((x, y) => x[1] - y[1]);
    const corte = Math.floor(ordenados.length * 0.10);
    const usar = ordenados.slice(corte, ordenados.length - corte);

    const n = usar.length;
    const mx = usar.reduce((s, d) => s + d[0], 0) / n;
    const my = usar.reduce((s, d) => s + d[1], 0) / n;
    let num = 0, den = 0;
    for (const [x, y] of usar) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
    const b = den > 0 ? num / den : 0;
    out[pos] = { a: my - b * mx, b, n };
  }
  return out;
}

export interface Revalorizacion {
  /** Lo que su rendimiento dice que debería costar. */
  precioJusto: number;
  /** Euros que se espera que suba (o baje) en el horizonte. */
  esperada: number;
  /** Como fracción de su precio actual. Es lo que importa en los baratos. */
  porcentaje: number;
}

/**
 * Cuánto se espera que se mueva su precio.
 *
 * La convergencia se calcula en escala logarítmica, no en euros. Biwenger mueve
 * los precios en PORCENTAJE del valor actual, así que un jugador de 500.000 €
 * puede doblar en unas semanas mientras uno de 25 millones se mueve un 5%. Con
 * una aproximación lineal en euros, el tope aplastaba todos los baratos al
 * mismo número y daba igual que proyectase 18 puntos o 30.
 *
 * Referencias reales de un solo día: Johnny +19,3% sobre 1,05M, Fer Niño +5,2%,
 * Raphinha +1,0% sobre 20,9M. El porcentaje cae con el precio.
 */
export function revalorizacion(
  player: Player,
  proj: PlayerProjection,
  recta: RectaPrecio,
  /**
   * Fracción del desfase logarítmico que se corrige en el horizonte.
   *
   * Es el parámetro más flojo del módulo: no tengo con qué calibrarlo todavía.
   * En cuanto el snapshot acumule histórico de precios se puede medir de
   * verdad, comparando el desfase de cada jornada con lo que el precio se movió
   * después. Mientras tanto va deliberadamente conservador.
   * TODO: calibrar contra `priceHistory` cuando haya unas semanas de datos.
   */
  velocidad = 0.45,
): Revalorizacion {
  if (recta.n < 6 || recta.b <= 0 || player.price <= 0) {
    return { precioJusto: player.price, esperada: 0, porcentaje: 0 };
  }

  const justo = Math.max(300_000, recta.a + recta.b * proj.projectedPoints);

  // Desfase en logaritmos, con saturación SUAVE. Un corte seco dejaba a dos
  // jugadores de 500.000 € con la misma subida proyectasen 18 puntos o 30,
  // porque ambos quedaban por encima del tope. La tangente hiperbólica comprime
  // los extremos pero los sigue distinguiendo.
  const TOPE = Math.log(4);
  const bruto = Math.log(justo / player.price);
  const desfase = Math.tanh(bruto / TOPE) * TOPE;

  // Quien no juega no revaloriza, por barato que esté. Se aplica ANTES de
  // convertir a euros: aplicarlo después dejaba a un suplente con la misma
  // subida que a un titular, porque el tope ya había igualado a los dos.
  const factorMinutos = Math.min(1, Math.max(0, proj.startProbability) / 0.6);

  const ratio = Math.exp(desfase * velocidad * factorMinutos);
  let esperada = player.price * (ratio - 1);

  // El impulso reciente confirma o desmiente la dirección.
  esperada += player.priceDelta * 3;

  return {
    precioJusto: Math.round(justo),
    esperada: Math.round(esperada),
    porcentaje: Math.round((esperada / player.price) * 1000) / 10,
  };
}
