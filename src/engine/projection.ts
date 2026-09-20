import type { Availability, Player, Position } from '../domain/types.js';
import { positionPriors, shrink, weightedPer90 } from './regression.js';
import {
  fixtureFactor, homeAdvantage, teamQuality,
  type Fixture, type Standing,
} from './fixtures.js';

const AVAILABILITY_FACTOR: Record<Availability, number> = {
  ok: 1,
  doubt: 0.55,
  injured: 0.05,
  suspended: 0,
  out: 0,
};

export interface ProjectionInput {
  players: Player[];
  horizonRounds: number;
  shrinkageK: number;
  formHalflife: number;
  /** Vida media para estimar titularidad. Por defecto, el doble que la forma. */
  minutesHalflife?: number;
  /** Próximos partidos por equipo. Sin esto el ajuste de calendario es neutro. */
  fixtures?: Fixture[];
  /** Clasificación real, si la API la expone. Opcional. */
  standings?: Standing[];
}

export interface PlayerProjection {
  playerId: number;
  position: Position;
  startProbability: number;
  expectedMinutes: number;
  shrunkPer90: number;
  volatility: number;
  projectedPoints: number;
}

/**
 * Probabilidad de ser alineado: cuota de minutos disponibles, ponderada por
 * recencia en vez de recortada a una ventana fija.
 *
 * La ventana dura de seis jornadas era demasiado ruidosa: a un titular
 * indiscutible con dos descansos dentro de la ventana le salía un 0,63 cuando
 * la realidad era 0,92, y eso hundía su proyección casi a la mitad. Con
 * ponderación exponencial todo el historial aporta, pero lo reciente manda.
 */
function startProbability(p: Player, halflifeRounds: number): number {
  if (p.reports.length === 0) return 0.3;
  const maxRound = Math.max(...p.reports.map((r) => r.round));
  const lambda = Math.log(2) / Math.max(halflifeRounds, 1);

  let num = 0, den = 0;
  for (const r of p.reports) {
    const w = Math.exp(-lambda * (maxRound - r.round));
    num += w * Math.min(r.minutes, 90);
    den += w * 90;
  }
  if (den === 0) return 0.2;
  return Math.max(0, Math.min(1, num / den));
}

/** Minutos esperados por partido, condicionados a estar en el once. */
function expectedMinutes(p: Player, halflifeRounds: number): number {
  const played = p.reports.filter((r) => r.minutes > 0);
  if (played.length === 0) return 45;
  const maxRound = Math.max(...played.map((r) => r.round));
  const lambda = Math.log(2) / Math.max(halflifeRounds, 1);
  let num = 0, den = 0;
  for (const r of played) {
    const w = Math.exp(-lambda * (maxRound - r.round));
    num += w * r.minutes;
    den += w;
  }
  return den > 0 ? num / den : 45;
}

export function projectAll(input: ProjectionInput): Map<number, PlayerProjection> {
  // Medidos sobre los datos de la propia competición, no supuestos.
  const venue = homeAdvantage(input.players);
  // Una sola estimación de calidad: temporada, forma reciente y clasificación
  // mezcladas, no multiplicadas, porque las tres miden casi lo mismo.
  const quality = teamQuality(input.players, input.standings);
  const fixtures = input.fixtures ?? [];

  const priors = positionPriors(input.players, input.formHalflife, venue);
  const out = new Map<number, PlayerProjection>();

  for (const p of input.players) {
    const { perAppearance, minutes, volatility } = weightedPer90(
      p.reports, input.formHalflife, venue,
    );
    const prior = priors[p.position] ?? 0;
    // Regresamos el ritmo POR PARTIDO, no por 90 minutos: en Biwenger las
    // picas se dan por actuación, no por minuto. Un titular que juega 65
    // minutos recibe la misma valoración del cronista que uno que juega 90.
    const shrunk = shrink(perAppearance, minutes, prior, input.shrinkageK);

    const hlMin = input.minutesHalflife ?? input.formHalflife * 2;
    const pStart = startProbability(p, hlMin) * AVAILABILITY_FACTOR[p.availability];
    const mins = expectedMinutes(p, hlMin);

    // Dónde juega y contra quién, en las próximas jornadas. Neutro (1) mientras
    // no tengamos el calendario.
    const fixture = fixtureFactor(p.teamId, fixtures, quality, venue, input.horizonRounds);

    // Solo los extras por gol escalan con los minutos, y son una fracción del
    // total, así que el ajuste por minutos es suave en vez de proporcional.
    const ajusteMinutos = 0.75 + 0.25 * Math.min(1, mins / 90);
    const perMatch = shrunk * ajusteMinutos * pStart * fixture;

    out.set(p.id, {
      playerId: p.id,
      position: p.position,
      startProbability: pStart,
      expectedMinutes: mins,
      shrunkPer90: shrunk,
      volatility,
      projectedPoints: perMatch * input.horizonRounds,
    });
  }

  return out;
}
