import type {
  Availability,
  LeagueState,
  Manager,
  MarketEntry,
  Player,
  Position,
  RoundReport,
} from '../domain/types.js';

/**
 * Traducción de la API real de Biwenger a nuestros tipos.
 *
 * Escrito contra la API de verdad (septiembre de 2026), no sobre supuestos.
 * Lo que costó averiguar y conviene no volver a tocar a ciegas:
 *
 *   - Hay CINCO posiciones, no cuatro: la 5 son los entrenadores.
 *   - Los puntos vienen por sistema de puntuación: `points` es un objeto y la
 *     clave es el `scoreID` de tu liga. La 5 es "Media AS y SofaScore".
 *   - Los minutos reales están en `rawStats.minutesPlayed` de la ficha del
 *     jugador, no en el dataset de competición.
 *   - Las fechas del histórico de precios son enteros AAMMDD, no timestamps.
 */

/** 1 portero · 2 defensa · 3 medio · 4 delantero · 5 ENTRENADOR. */
const POSITION_BY_CODE: Record<number, Position> = { 1: 'GK', 2: 'DF', 3: 'MF', 4: 'FW' };
const CODIGO_ENTRENADOR = 5;

/**
 * Estados reales que devuelve la API. `warned` es "apercibido de sanción":
 * juega con normalidad, así que no penaliza. `discarded` es descartado del
 * equipo, que sí es una baja efectiva.
 */
const AVAILABILITY_BY_STATUS: Record<string, Availability> = {
  ok: 'ok',
  warned: 'ok',
  doubt: 'doubt',
  unknown: 'doubt',
  injured: 'injured',
  sanctioned: 'suspended',
  discarded: 'out',
};

function toAvailability(raw: unknown): Availability {
  if (typeof raw !== 'string') return 'ok';
  return AVAILABILITY_BY_STATUS[raw.toLowerCase()] ?? 'ok';
}

/** Fechas del histórico de precios: enteros AAMMDD, como 260919. */
export function fechaBiwenger(n: number): number {
  const s = String(n).padStart(6, '0');
  const anio = 2000 + Number(s.slice(0, 2));
  const mes = Number(s.slice(2, 4)) - 1;
  const dia = Number(s.slice(4, 6));
  return Date.UTC(anio, mes, dia);
}

/** Los puntos del sistema de TU liga, no de otro. */
function puntosDelSistema(points: unknown, scoreId: number): number {
  if (typeof points === 'number') return points;
  if (points && typeof points === 'object') {
    const v = (points as Record<string, unknown>)[String(scoreId)];
    if (typeof v === 'number') return v;
  }
  return 0;
}

// ---------------------------------------------------------------- JUGADORES

export function adaptPlayers(competitionData: any, scoreId: number): Player[] {
  const rawPlayers: any[] = Array.isArray(competitionData?.players)
    ? competitionData.players
    : Object.values(competitionData?.players ?? {});
  const teams: Record<string, any> = competitionData?.teams ?? {};

  return rawPlayers
    .filter((p) => p && p.id != null && Number(p.position) !== CODIGO_ENTRENADOR)
    .map((p): Player => {
      const teamId = Number(p.teamID ?? p.teamId ?? 0);
      const jugados = Number(p.playedHome ?? 0) + Number(p.playedAway ?? 0);

      // El dataset no trae informes por jornada, solo `fitness`: las últimas
      // cinco puntuaciones, ya en el sistema de la liga. Sirve de apaño hasta
      // que se baja la ficha, que sí trae minutos y rival.
      const fitness: any[] = Array.isArray(p.fitness) ? p.fitness : [];
      const reports: RoundReport[] = fitness
        .map((v, i): RoundReport | null => {
          if (v === null || v === undefined) return null;
          const pts = Number(v);
          if (!Number.isFinite(pts)) return null;
          // `fitness` va de más antigua a más reciente y no dice la jornada.
          return { round: i + 1, points: pts, minutes: 90 };
        })
        .filter((x): x is RoundReport => x !== null);

      return {
        id: Number(p.id),
        name: String(p.name ?? p.slug ?? `#${p.id}`),
        slug: String(p.slug ?? p.id),
        position: POSITION_BY_CODE[Number(p.position)] ?? 'MF',
        teamId,
        teamName: String(teams[String(teamId)]?.name ?? '—'),
        price: Number(p.price ?? 0),
        priceDelta: Number(p.priceIncrement ?? 0),
        availability: toAvailability(p.status),
        points: Number(p.points ?? 0),
        matchesPlayed: jugados,
        reports,
        // El desglose casa/fuera viene ya calculado: no hay que deducirlo.
        homeSplit: {
          pointsHome: Number(p.pointsHome ?? 0),
          playedHome: Number(p.playedHome ?? 0),
          pointsAway: Number(p.pointsAway ?? 0),
          playedAway: Number(p.playedAway ?? 0),
        },
      };
    });
}

/**
 * Traduce los id internos de jornada a números correlativos (1, 2, 3…).
 *
 * Biwenger identifica las jornadas con enteros como 4899 o 4937, y `rounds` NO
 * viene ordenado: la "Jornada 1 (aplazada)" tiene el id 4937 y aparece entre la
 * 2 y la 3. Usar esos id en bruto arruinaría la ponderación por recencia,
 * porque el modelo interpretaría que entre la 4904 y la 4937 han pasado
 * treinta y tres jornadas.
 *
 * Se ordena por el número de `short` ("J3" → 3), con `part` como desempate para
 * los partidos aplazados.
 */
export function mapaJornadas(competitionData: any): Map<number, number> {
  const rounds: any[] = competitionData?.season?.rounds ?? [];
  const conOrden = rounds
    .map((r: any) => ({
      id: Number(r?.id),
      num: Number(String(r?.short ?? '').replace(/\D/g, '')) || 0,
      part: Number(r?.part ?? 1),
    }))
    .filter((r) => Number.isFinite(r.id) && r.num > 0)
    .sort((a, b) => a.num - b.num || a.part - b.part);

  const mapa = new Map<number, number>();
  conOrden.forEach((r, i) => mapa.set(r.id, i + 1));
  return mapa;
}

// ------------------------------------------------------- FICHA DE JUGADOR

/**
 * Códigos de evento de Biwenger, deducidos cruzándolos con `rawStats`:
 *
 *    1 gol · 2 gol de penalti · 3 asistencia · 4 sustituido ·
 *    5 entra al campo · 6 tarjeta amarilla · 11 penalti fallado
 *
 * Los códigos 10, 13 y 16 aparecen pero no corresponden a nada de `rawStats`,
 * así que se ignoran.
 *
 * En la práctica no hacen falta: `rawStats` trae los mismos datos con nombre
 * propio y sin ambigüedad, que es de donde se leen.
 */
export const EVENTOS = {
  GOL: 1, GOL_PENALTI: 2, ASISTENCIA: 3, SALE: 4, ENTRA: 5,
  AMARILLA: 6, PENALTI_FALLADO: 11,
} as const;

/**
 * Informes jornada a jornada desde la ficha. Esto es lo que de verdad alimenta
 * al modelo: minutos reales, rival, dónde se jugó y el resultado.
 */
export function adaptDetailedReports(
  playerData: any,
  scoreId: number,
  jornadas?: Map<number, number>,
): RoundReport[] {
  const raw = playerData?.reports;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((r: any): RoundReport | null => {
      const idJornada = Number(r?.match?.round?.id ?? r?.round?.id ?? 0);
      if (!idJornada) return null;
      // Número correlativo, no el id interno.
      const round = jornadas?.get(idJornada)
        ?? Number(String(r?.match?.round?.short ?? '').replace(/\D/g, ''))
        ?? idJornada;
      if (!round) return null;

      const rs = r?.rawStats ?? {};
      const partido = r?.match ?? {};
      // `rawStats.away` es más fiable que el `home` de primer nivel.
      const home = typeof rs.away === 'boolean' ? !rs.away
                 : typeof r?.home === 'boolean' ? r.home : undefined;

      const idLocal = Number(partido?.home?.id);
      const idVisitante = Number(partido?.away?.id);
      const opponentTeamId = home === true ? idVisitante : home === false ? idLocal : undefined;

      return {
        round,
        roundName: String(partido?.round?.short ?? partido?.round?.name ?? ''),
        points: puntosDelSistema(r?.points, scoreId),
        minutes: Number(rs.minutesPlayed ?? 0),
        home,
        opponentTeamId: Number.isFinite(opponentTeamId!) ? opponentTeamId : undefined,
        opponentName: home === true ? partido?.away?.name : home === false ? partido?.home?.name : undefined,
        homeTeamId: Number.isFinite(idLocal) ? idLocal : undefined,
        awayTeamId: Number.isFinite(idVisitante) ? idVisitante : undefined,
        homeGoals: Number.isFinite(Number(partido?.home?.score)) ? Number(partido.home.score) : undefined,
        awayGoals: Number.isFinite(Number(partido?.away?.score)) ? Number(partido.away.score) : undefined,
        cleanSheet: rs.cleanSheet === true,
        // `goals` y `goalsPenalty` son campos SEPARADOS, no uno dentro del
        // otro: Raphinha en la J6 tiene goals=1 y goalsPenalty=2, y marcó tres.
        goals: (Number(rs.goals ?? 0) || 0) + (Number(rs.goalsPenalty ?? 0) || 0) || undefined,
        goalsPenalty: Number(rs.goalsPenalty ?? 0) || undefined,
        assists: Number(rs.assists ?? 0) || undefined,
        yellow: Number(rs.yellowCard ?? 0) || undefined,
        red: rs.redCard === true || Number(rs.redCard ?? 0) > 0 || undefined,
        penaltyMissed: Number(rs.penaltyMissed ?? 0) || undefined,
        ownGoals: Number(rs.ownGoal ?? rs.ownGoals ?? 0) || undefined,
        mvp: rs.mvp === true,
        resultado: rs.win ? 'win' : rs.lost ? 'lost' : rs.tie ? 'tie' : undefined,
        // Los eventos se guardan en crudo por si hiciera falta el minuto exacto.
        rawEvents: Array.isArray(r?.events) && r.events.length ? r.events : undefined,
      };
    })
    .filter((x): x is RoundReport => x !== null)
    .sort((a, b) => a.round - b.round);
}

/** Histórico de precios: pares [AAMMDD, euros]. */
export function adaptPriceHistory(playerData: any): Array<[number, number]> | undefined {
  const raw = playerData?.prices;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  const puntos: Array<[number, number]> = [];
  for (const x of raw) {
    if (!Array.isArray(x) || x.length < 2) continue;
    const fecha = Number(x[0]);
    const precio = Number(x[1]);
    if (!Number.isFinite(fecha) || !Number.isFinite(precio)) continue;
    puntos.push([fechaBiwenger(fecha), precio]);
  }
  if (puntos.length === 0) return undefined;
  puntos.sort((a, b) => a[0] - b[0]);

  // Adelgazamos a ~120 puntos: más no se distingue en un móvil.
  if (puntos.length <= 120) return puntos;
  const paso = Math.ceil(puntos.length / 120);
  return puntos.filter((_, i) => i % paso === 0 || i === puntos.length - 1);
}

// ------------------------------------------------------------------ MERCADO

export function adaptMarket(marketData: any): MarketEntry[] {
  const sales: any[] = marketData?.sales ?? [];
  if (!Array.isArray(sales)) return [];

  return sales
    .map((s: any): MarketEntry | null => {
      const playerId = Number(s?.player?.id ?? s?.player);
      if (!Number.isFinite(playerId)) return null;
      // `user: null` es agente libre; con usuario, lo vende un manager.
      const sellerUserId = s?.user?.id != null ? Number(s.user.id) : undefined;
      return {
        playerId,
        askingPrice: Number(s?.price ?? 0),
        origin: sellerUserId ? 'manager' : 'free',
        sellerUserId,
        expiresAt: s?.until != null ? Number(s.until) * 1000 : undefined,
      };
    })
    .filter((x): x is MarketEntry => x !== null);
}

// --------------------------------------------------------------- CALENDARIO

export interface PartidoFuturo {
  teamId: number;
  opponentId: number;
  home: boolean;
  round: number;
}

/**
 * Próximos partidos, sacados de `nextGames` de cada equipo del dataset.
 * La llamada de calendario devuelve 403, pero el dato estaba aquí al lado.
 */
export function adaptFixtures(competitionData: any): PartidoFuturo[] {
  const teams: Record<string, any> = competitionData?.teams ?? {};
  const out: PartidoFuturo[] = [];

  for (const t of Object.values(teams)) {
    const equipo: any = t;
    const id = Number(equipo?.id);
    if (!Number.isFinite(id)) continue;
    for (const g of equipo?.nextGames ?? []) {
      const local = Number(g?.home?.id);
      const visitante = Number(g?.away?.id);
      if (!Number.isFinite(local) || !Number.isFinite(visitante)) continue;
      out.push({
        teamId: id,
        opponentId: local === id ? visitante : local,
        home: local === id,
        round: Number(g?.round?.id ?? 0),
      });
    }
  }
  return out.sort((a, b) => a.round - b.round);
}

// -------------------------------------------------------------- MANAGERS

/** Los managers, sin plantilla: esa hay que pedirla uno a uno. */
export function adaptManagers(leagueData: any): Manager[] {
  const users: any[] = leagueData?.standings ?? [];
  if (!Array.isArray(users)) return [];

  return users.map(
    (u: any): Manager => ({
      userId: Number(u?.id ?? 0),
      name: String(u?.name ?? '—'),
      squad: [],
      teamValue: Number(u?.teamValue ?? 0),
      teamSize: Number(u?.teamSize ?? 0),
      leaguePoints: Number(u?.points ?? 0),
      leaguePosition: Number(u?.position ?? 0),
    }),
  );
}

/** Ids de la plantilla de un manager, de la respuesta de /user/{id}. */
export function adaptSquadIds(userData: any): number[] {
  const players = userData?.players;
  if (!Array.isArray(players)) return [];
  return players.map((p: any) => Number(p?.id)).filter((n: number) => Number.isFinite(n));
}

/** El scoreID decide QUÉ puntuación se lee. Equivocarlo falsea todo el modelo. */
export function adaptScoreId(leagueData: any, porDefecto = 5): number {
  const n = Number(leagueData?.scoreID);
  return Number.isFinite(n) && n > 0 ? n : porDefecto;
}

export function adaptLeagueState(raw: {
  competitionData: any;
  market: any;
  league: any;
  myTeam: any;
  squadsByUser: Map<number, number[]>;
  date: string;
  scoreId: number;
}): LeagueState {
  const players = adaptPlayers(raw.competitionData, raw.scoreId);
  const managers = adaptManagers(raw.league);
  const myUserId = Number(raw.myTeam?.id ?? 0);

  for (const m of managers) {
    const ids = raw.squadsByUser.get(m.userId) ?? [];
    m.squad = ids.map((playerId) => ({ playerId, ownerUserId: m.userId }));
  }

  const misJugadores: any[] = Array.isArray(raw.myTeam?.players) ? raw.myTeam.players : [];

  return {
    date: raw.date,
    currentRound: rondaActual(raw.competitionData),
    players,
    market: adaptMarket(raw.market),
    managers,
    me: {
      userId: myUserId,
      balance: Number(raw.myTeam?.balance ?? 0),
      squad: misJugadores.map((p: any) => ({
        playerId: Number(p?.id ?? 0),
        ownerUserId: myUserId,
        // `owner.price` es lo que pagaste por él.
        boughtFor: typeof p?.owner?.price === 'number' ? p.owner.price : undefined,
      })),
    },
  };
}

/** La primera jornada sin terminar, como número correlativo. */
function rondaActual(competitionData: any): number {
  const rounds: any[] = competitionData?.season?.rounds ?? [];
  if (!Array.isArray(rounds) || rounds.length === 0) return 0;
  const mapa = mapaJornadas(competitionData);
  const pendientes = rounds
    .filter((r: any) => r?.status && r.status !== 'finished')
    .map((r: any) => mapa.get(Number(r.id)) ?? 0)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  if (pendientes.length) return pendientes[0]!;
  return Math.max(0, ...[...mapa.values()]);
}
