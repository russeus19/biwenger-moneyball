import type { Player, Position, RoundReport } from '../domain/types.js';

/**
 * Generador de jornadas con las REGLAS REALES de Biwenger, para probar el
 * modelo contra una verdad conocida.
 *
 * Sistema MIXTO (media de Diario AS y SofaScore, redondeada), que es el que usa
 * nuestra liga. Importa: la media de dos sistemas es bastante menos volátil que
 * las picas solas y tiene granularidad mucho más fina. Calibrado contra la
 * distribución real medida en LaLiga 2026/27: negativos ~4%, mediana 4,
 * percentil 90 en 13, máximo observado 23, y desviación típica por jugador con
 * mediana 3,6.
 *
 * Reglas implementadas:
 *   Base AS por picas:  sin calificar 0 · 0 picas -2 · 1 pica 2 · 2 picas 6
 *                       3 picas 10 · 4 picas 14
 *   Base SofaScore:     nota 0-10 mapeada a -6..14 por tramos
 *   Base mixta:         (AS + SofaScore) / 2, redondeada
 *   Gol:             POR 6 · DEF 5 · MED 4 · DEL 3
 *   Gol de penalti:  3, sea cual sea la posición
 *   Portería a cero: POR 3 · DEF 3 · MED 1
 *   Goles encajados: POR -1 cada uno · DEF -0.3
 *   Roja directa:    -6      Doble amarilla: -3
 *   Menos de 10 minutos: sin calificar, 0 puntos
 *
 * Calibrado contra magnitudes reales: media de liga en torno a 3 puntos por
 * jugador y jornada, y los mejores de cada jornada entre 14 y 18.
 */

let seed = 987654321;
export function reseed(s: number): void { seed = s; }
function rnd(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
function gauss(mu: number, sd: number): number {
  const u = Math.max(rnd(), 1e-9);
  return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

const PICAS_A_PUNTOS = [-2, 2, 6, 10, 14];

/** Tramos de nota SofaScore a puntos Biwenger. Tabla oficial. */
const TRAMOS_SOFASCORE: Array<[number, number]> = [
  [9.5, 14], [9.0, 13], [8.6, 12], [8.2, 11], [8.0, 10], [7.8, 9], [7.6, 8],
  [7.4, 7], [7.2, 6], [7.0, 5], [6.8, 4], [6.6, 3], [6.4, 2], [6.2, 1],
  [6.0, 0], [5.8, -1], [5.6, -2], [5.4, -3], [5.2, -4], [5.0, -5],
];
function sofascoreAPuntos(nota: number): number {
  for (const [umbral, pts] of TRAMOS_SOFASCORE) if (nota >= umbral) return pts;
  return -6;
}

/**
 * Base del sistema mixto. Una única actuación latente alimenta los dos
 * sistemas, porque en la realidad ambos valoran el mismo partido: el cronista
 * y el algoritmo coinciden a grandes rasgos y discrepan en los matices.
 */
function baseMixta(calidad: number, ruidoCronista = 0.55): number {
  const actuacion = gauss(calidad, 1);
  // El cronista ve lo mismo pero con su propio criterio.
  const picas = picasDeActuacion(actuacion + gauss(0, ruidoCronista));
  const nota = CENTRO_NOTA + actuacion * 0.55 + gauss(0, 0.18);
  return Math.round((PICAS_A_PUNTOS[picas]! + sofascoreAPuntos(nota)) / 2);
}

/**
 * Centro de la escala, calibrado para reproducir la distribución real medida:
 * mediana 4, percentil 90 en 13, negativos por debajo del 5%.
 */
const CENTRO_NOTA = 6.75;
const UMBRALES_PICAS = [1.55, 0.75, -0.15, -2.5];

function picasDeActuacion(x: number): number {
  if (x > UMBRALES_PICAS[0]!) return 4;
  if (x > UMBRALES_PICAS[1]!) return 3;
  if (x > UMBRALES_PICAS[2]!) return 2;
  if (x > UMBRALES_PICAS[3]!) return 1;
  return 0;
}
const GOL_POR_POSICION: Record<Position, number> = { GK: 6, DF: 5, MF: 4, FW: 3 };
const PORTERIA_CERO: Record<Position, number> = { GK: 3, DF: 3, MF: 1, FW: 0 };

/** Lo que define a un jugador "de verdad". El modelo no lo ve: lo estima. */
export interface Perfil {
  nombre: string;
  position: Position;
  /** Calidad latente, en desviaciones respecto al jugador medio de la liga. */
  calidad: number;
  /** Probabilidad de ser titular cada jornada. */
  titularidad: number;
  /** Goles esperados por partido completo. */
  golesPorPartido: number;
  /** Lanza los penaltis de su equipo. */
  penaltis?: boolean;
  /** Calidad defensiva de su equipo: probabilidad de portería a cero. */
  probPorteriaCero: number;
  /** Goles que encaja su equipo de media. */
  golesEncajados: number;
  /** Propensión a tarjetas. */
  indisciplina?: number;
}

/**
 * Puntos esperados por partido JUGADO, calculados analíticamente desde el
 * perfil. Es la verdad contra la que se compara el modelo.
 */
export function puntosEsperadosPorPartido(p: Perfil): number {
  // La base mixta no tiene forma cerrada sencilla (dos mapeos por tramos sobre
  // la misma actuación), así que se estima por Monte Carlo con semilla fija.
  const guardado = seed;
  seed = 123456789;
  let base = 0;
  const N = 6000;
  for (let i = 0; i < N; i++) base += baseMixta(p.calidad);
  base /= N;
  seed = guardado;

  const goles = p.golesPorPartido * GOL_POR_POSICION[p.position];
  const penaltis = p.penaltis ? 0.12 * 3 : 0;
  const porteria = p.probPorteriaCero * PORTERIA_CERO[p.position];
  const encajados =
    p.position === 'GK' ? -p.golesEncajados : p.position === 'DF' ? -0.3 * p.golesEncajados : 0;
  const tarjetas = (p.indisciplina ?? 0.02) * -3.5;

  return base + goles + penaltis + porteria + encajados + tarjetas;
}

/** Genera el historial de un jugador durante `jornadas` jornadas. */
export function simularJugador(p: Perfil, jornadas: number, empiezaEnJornada = 1): RoundReport[] {
  const out: RoundReport[] = [];

  for (let r = empiezaEnJornada; r < empiezaEnJornada + jornadas; r++) {
    const juega = rnd() < p.titularidad;
    if (!juega) {
      // A veces entra desde el banquillo unos minutos.
      const entra = rnd() < 0.25;
      const min = entra ? Math.floor(3 + rnd() * 25) : 0;
      // Menos de 10 minutos: sin calificar, 0 puntos. Ojo: 0 puntos NO
      // significa que no haya jugado.
      const pts = min >= 10 ? baseMixta(p.calidad - 0.3) : 0;
      out.push({ round: r, points: min >= 10 ? pts : 0, minutes: min, home: r % 2 === 0 });
      continue;
    }

    const minutos = rnd() < 0.8 ? 90 : Math.floor(55 + rnd() * 35);
    const cuota = minutos / 90;
    const local = r % 2 === 0;

    let pts = baseMixta(p.calidad + (local ? 0.12 : -0.12));

    // Goles
    let goles = 0;
    const lambda = p.golesPorPartido * cuota;
    while (rnd() < lambda / (goles + 1) && goles < 3) goles++;
    pts += goles * GOL_POR_POSICION[p.position];

    if (p.penaltis && rnd() < 0.12) pts += 3;

    // Portería a cero: exige al menos 75 minutos
    if (minutos >= 75 && rnd() < p.probPorteriaCero) pts += PORTERIA_CERO[p.position];
    else if (p.position === 'GK') pts -= Math.round(gauss(p.golesEncajados, 0.8));
    else if (p.position === 'DF') pts -= Math.round(0.3 * gauss(p.golesEncajados, 0.8));

    // Tarjetas
    const ind = p.indisciplina ?? 0.02;
    if (rnd() < ind * 0.4) pts -= 6;
    else if (rnd() < ind) pts -= 3;

    out.push({ round: r, points: pts, minutes: minutos, home: local });
  }

  return out;
}

let idSiguiente = 5000;

export function crearJugador(
  p: Perfil,
  jornadas: number,
  opciones: { teamId?: number; price?: number; availability?: Player['availability'] } = {},
): Player {
  const reports = simularJugador(p, jornadas);
  return {
    id: idSiguiente++,
    name: p.nombre,
    slug: p.nombre.toLowerCase().replace(/\s+/g, '-'),
    position: p.position,
    teamId: opciones.teamId ?? 1,
    teamName: 'Equipo ' + (opciones.teamId ?? 1),
    price: opciones.price ?? 5_000_000,
    priceDelta: 0,
    availability: opciones.availability ?? 'ok',
    points: reports.reduce((s, r) => s + r.points, 0),
    matchesPlayed: reports.filter((r) => r.minutes > 0).length,
    reports,
  };
}
