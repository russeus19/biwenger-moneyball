import type { Player } from '../domain/types.js';
import { crearJugador, puntosEsperadosPorPartido, reseed, type Perfil } from './biwenger-sim.js';
import { projectAll } from '../engine/projection.js';

/**
 * Arquetipos que existen de verdad en Biwenger. La prueba consiste en ver si
 * el modelo los ordena como deben ir, sabiendo nosotros la verdad de cada uno.
 *
 * Los tres últimos son trampas deliberadas: los casos donde un modelo ingenuo
 * se equivoca y pierde dinero.
 */
export const ARQUETIPOS: Perfil[] = [
  {
    nombre: 'Delantero estrella',
    position: 'FW', calidad: 1.3, titularidad: 0.95,
    golesPorPartido: 0.55, penaltis: true, probPorteriaCero: 0.35, golesEncajados: 1.0,
  },
  {
    nombre: 'Medio creador top',
    position: 'MF', calidad: 1.4, titularidad: 0.92,
    golesPorPartido: 0.28, penaltis: true, probPorteriaCero: 0.40, golesEncajados: 0.9,
  },
  {
    nombre: 'Central equipo fuerte',
    position: 'DF', calidad: 0.8, titularidad: 0.95,
    golesPorPartido: 0.07, probPorteriaCero: 0.45, golesEncajados: 0.8,
  },
  {
    nombre: 'Portero equipo fuerte',
    position: 'GK', calidad: 0.7, titularidad: 0.98,
    golesPorPartido: 0, probPorteriaCero: 0.45, golesEncajados: 0.8,
  },
  {
    nombre: 'Lateral ofensivo medio',
    position: 'DF', calidad: 0.4, titularidad: 0.85,
    golesPorPartido: 0.08, probPorteriaCero: 0.28, golesEncajados: 1.2,
  },
  {
    nombre: 'Titular fijo mediocre',
    position: 'MF', calidad: -0.3, titularidad: 0.95,
    golesPorPartido: 0.05, probPorteriaCero: 0.22, golesEncajados: 1.5,
  },
  {
    nombre: 'Central de colista',
    position: 'DF', calidad: -0.4, titularidad: 0.90,
    golesPorPartido: 0.04, probPorteriaCero: 0.12, golesEncajados: 2.0,
    indisciplina: 0.10,
  },
  {
    nombre: 'Rotacion equipo grande',
    position: 'MF', calidad: 0.9, titularidad: 0.45,
    golesPorPartido: 0.15, probPorteriaCero: 0.40, golesEncajados: 0.9,
  },
  {
    nombre: 'Suplente habitual',
    position: 'FW', calidad: 0.2, titularidad: 0.15,
    golesPorPartido: 0.10, probPorteriaCero: 0.25, golesEncajados: 1.4,
  },
  // --- Trampas ------------------------------------------------------------
  {
    // Bueno de verdad, pero viene de una mala racha. El mercado lo ha
    // devaluado. Comprarlo deberia ser buena idea.
    nombre: 'TRAMPA estrella en mala racha',
    position: 'FW', calidad: 1.2, titularidad: 0.93,
    golesPorPartido: 0.50, penaltis: true, probPorteriaCero: 0.35, golesEncajados: 1.0,
  },
  {
    // Mediocre que lleva tres partidazos seguidos. El mercado lo ha inflado.
    // El modelo NO deberia recomendarlo.
    nombre: 'TRAMPA revelacion pasajera',
    position: 'MF', calidad: -0.2, titularidad: 0.80,
    golesPorPartido: 0.06, probPorteriaCero: 0.25, golesEncajados: 1.3,
  },
];

export interface Fila {
  nombre: string;
  position: string;
  verdadPorPartido: number;
  verdadHorizonte: number;
  modeloHorizonte: number;
  titularidadReal: number;
  titularidadModelo: number;
  error: number;
}

/** Corre el modelo sobre una liga generada y compara con la verdad. */
export function evaluarArquetipos(
  jornadas: number,
  horizonte: number,
  semilla: number,
  relleno = 120,
): { filas: Fila[]; jugadores: Player[] } {
  reseed(semilla);

  const perfiles = [...ARQUETIPOS];
  const jugadores = perfiles.map((p, i) =>
    crearJugador(p, jornadas, { teamId: (i % 8) + 1, price: 5_000_000 }),
  );

  // Relleno: una liga de verdad para que los percentiles y las medianas por
  // posicion tengan con qué compararse.
  const posiciones = ['GK', 'DF', 'MF', 'FW'] as const;
  for (let i = 0; i < relleno; i++) {
    const pos = posiciones[i % 4]!;
    const perfil: Perfil = {
      nombre: `Relleno ${i}`,
      position: pos,
      calidad: (i % 7) / 3 - 1,
      titularidad: 0.25 + ((i * 37) % 70) / 100,
      golesPorPartido: pos === 'FW' ? 0.25 : pos === 'MF' ? 0.10 : 0.04,
      probPorteriaCero: 0.15 + ((i * 13) % 25) / 100,
      golesEncajados: 1.0 + ((i * 7) % 12) / 10,
    };
    jugadores.push(crearJugador(perfil, jornadas, { teamId: (i % 20) + 1 }));
  }

  const proy = projectAll({
    players: jugadores,
    horizonRounds: horizonte,
    shrinkageK: 7,
    formHalflife: 4,
  });

  const filas: Fila[] = perfiles.map((p, i) => {
    const jugador = jugadores[i]!;
    const pr = proy.get(jugador.id)!;
    const porPartido = puntosEsperadosPorPartido(p);
    const verdadHorizonte = porPartido * p.titularidad * horizonte;
    return {
      nombre: p.nombre,
      position: p.position,
      verdadPorPartido: Math.round(porPartido * 100) / 100,
      verdadHorizonte: Math.round(verdadHorizonte * 10) / 10,
      modeloHorizonte: Math.round(pr.projectedPoints * 10) / 10,
      titularidadReal: p.titularidad,
      titularidadModelo: Math.round(pr.startProbability * 100) / 100,
      error: Math.round((pr.projectedPoints - verdadHorizonte) * 10) / 10,
    };
  });

  return { filas, jugadores };
}

/** Correlación de Spearman: ¿ordena el modelo igual que la verdad? */
export function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]) => {
    const idx = xs.map((v, i) => [v, i] as [number, number]).sort((x, y) => x[0] - y[0]);
    const r = new Array(xs.length).fill(0);
    idx.forEach(([, i], pos) => { r[i] = pos + 1; });
    return r;
  };
  const ra = rank(a), rb = rank(b);
  const n = a.length;
  const d2 = ra.reduce((s, v, i) => s + (v - rb[i]!) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}
