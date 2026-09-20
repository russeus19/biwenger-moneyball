import type { LeagueState, Player, Recommendation } from './domain/types.js';
import type { PlayerProjection } from './engine/projection.js';
import { bestXI, toCandidates } from './engine/lambda.js';
import type { EngineOutput } from './engine/decisions.js';
import { planificarLiquidez } from './engine/economy.js';
import { endpoints } from './biwenger/endpoints.js';

/**
 * Construye el JSON que consume el front. Este es el contrato: lo sirve
 * /api/market y lo escribe el job diario en data/market.json. Cambiarlo
 * significa cambiar el front, así que conviene tocarlo poco.
 */
/** Media de puntos por partido jugado en casa y fuera. */
function mediasCasaFuera(reports: Array<{ points: number; minutes: number; home?: boolean }>) {
  let ptsCasa = 0, nCasa = 0, ptsFuera = 0, nFuera = 0;
  for (const r of reports) {
    if (r.minutes <= 0 || r.home === undefined) continue;
    if (r.home) { ptsCasa += r.points; nCasa++; } else { ptsFuera += r.points; nFuera++; }
  }
  return {
    casa: nCasa ? Math.round((ptsCasa / nCasa) * 10) / 10 : null,
    casaPJ: nCasa,
    fuera: nFuera ? Math.round((ptsFuera / nFuera) * 10) / 10 : null,
    fueraPJ: nFuera,
  };
}

export function buildPayload(
  state: LeagueState,
  projections: Map<number, PlayerProjection>,
  result: EngineOutput,
) {
  const byId = new Map(state.players.map((p) => [p.id, p]));
  // Un equipo por id, para poder poner el nombre del rival en el histórico.
  const equipos = new Map<number, string>();
  for (const p of state.players) if (!equipos.has(p.teamId)) equipos.set(p.teamId, p.teamName);
  const nombreEquipo = (id: number) => equipos.get(id) ?? null;

  const squadCandidates = toCandidates(
    state.me.squad.map((s) => byId.get(s.playerId)).filter((p): p is Player => !!p),
    projections,
  );
  const xi = bestXI(squadCandidates);
  const xiIds = new Set(xi.lineup.map((c) => c.playerId));

  // Cambios respecto a lo que tienes puesto ahora. Emparejamos por posición:
  // quien sale y quien entra en su lugar, con los puntos que ganas.
  const current = state.me.currentLineup;
  const changes: Array<{
    outId: number; outName: string;
    inId: number; inName: string;
    position: string; gain: number;
  }> = [];

  // Si la alineación puesta puntúa MÁS que el mejor once legal, es que no la
  // hemos leído bien (o no era legal). Mejor no sugerir nada que sugerir un
  // cambio que resta.
  const puntosActual = current
    ? squadCandidates.filter((c) => current.includes(c.playerId))
        .reduce((s, c) => s + c.projectedPoints, 0)
    : 0;
  const alineacionFiable = !current || puntosActual <= xi.points + 0.01;

  if (current && current.length > 0 && alineacionFiable) {
    const currentSet = new Set(current);
    const entran = xi.lineup.filter((c) => !currentSet.has(c.playerId));
    const salen = squadCandidates.filter(
      (c) => currentSet.has(c.playerId) && !xiIds.has(c.playerId),
    );

    const pendientes = [...salen];
    for (const dentro of entran.sort((a, b) => b.projectedPoints - a.projectedPoints)) {
      // Preferimos sustituir a alguien de su misma posición; si no hay, al peor.
      let idx = pendientes.findIndex((c) => c.position === dentro.position);
      if (idx === -1) {
        if (pendientes.length === 0) break;
        idx = pendientes.reduce(
          (peor, c, i, arr) => (c.projectedPoints < arr[peor]!.projectedPoints ? i : peor),
          0,
        );
      }
      const fuera = pendientes.splice(idx, 1)[0]!;
      changes.push({
        outId: fuera.playerId,
        outName: byId.get(fuera.playerId)?.name ?? String(fuera.playerId),
        inId: dentro.playerId,
        inName: byId.get(dentro.playerId)?.name ?? String(dentro.playerId),
        position: dentro.position,
        gain: Math.round((dentro.projectedPoints - fuera.projectedPoints) * 10) / 10,
      });
    }
  }

  const meta = (id: number) => {
    const p = byId.get(id)!;
    const pr = projections.get(id)!;
    return {
      id: p.id,
      name: p.name,
      position: p.position,
      team: p.teamName,
      teamId: p.teamId,
      price: p.price,
      priceDelta: p.priceDelta,
      status: p.availability,
      seasonPoints: p.points,
      matches: p.matchesPlayed,
      projectedPoints: Math.round(pr.projectedPoints * 10) / 10,
      startProbability: Math.round(pr.startProbability * 100) / 100,
      per90: Math.round(pr.shrunkPer90 * 100) / 100,
      volatility: Math.round(pr.volatility * 10) / 10,
      rounds: p.reports.map((r) => ({
        r: r.round,
        p: r.points,
        m: r.minutes,
        h: r.home ?? null,
        o: r.opponentTeamId != null ? nombreEquipo(r.opponentTeamId) : null,
        g: r.goals ?? 0,
        a: r.assists ?? 0,
        // Resultado del partido y escudos, para pintar la fila como Biwenger.
        hl: r.homeTeamId != null ? endpoints.teamImage(r.homeTeamId) : null,
        vl: r.awayTeamId != null ? endpoints.teamImage(r.awayTeamId) : null,
        // Los ids van también: así el front puede rehacer la URL si el JSON
        // viene de un snapshot antiguo con el patrón equivocado.
        hid: r.homeTeamId ?? null,
        vid: r.awayTeamId ?? null,
        hg: r.homeGoals ?? null,
        vg: r.awayGoals ?? null,
        // Eventos, para los iconos de la derecha.
        y: r.yellow ?? 0,
        rd: r.red ?? false,
        og: r.ownGoals ?? 0,
        ps: r.penaltySaved ?? 0,
        pm: r.penaltyMissed ?? 0,
      })),
      splitLocal: mediasCasaFuera(p.reports),
      foto: endpoints.playerImage(p.id),
      escudo: endpoints.teamImage(p.teamId),
      priceHistory: p.priceHistory ?? null,
    };
  };

  const askByPlayer = new Map(state.market.map((m) => [m.playerId, m.askingPrice]));
  // Lo que pagó su dueño. En tu plantilla viene de `owner.price` de la API.
  const pagadoPor = new Map(
    state.me.squad.filter((s) => s.boughtFor != null).map((s) => [s.playerId, s.boughtFor!]),
  );
  // Quién lo vende y cuándo cierra la subasta. Saber que lo pone un rival
  // concreto cambia la lectura: no es lo mismo una ganga del mercado libre que
  // alguien deshaciéndose de un jugador.
  const entradaPorJugador = new Map(state.market.map((m) => [m.playerId, m]));
  const nombreManager = new Map(state.managers.map((m) => [m.userId, m.name]));

  const plan = planificarLiquidez(result.buys, result.sells, result.economia, byId);

  return {
    generatedAt: new Date().toISOString(),
    date: state.date,
    round: state.currentRound,
    simulated: false,
    lambda: Math.round(result.lambda * 1000) / 1000,
    // Cuánto dinero cabe colocar hoy. Manda sobre el valor de cualquier venta.
    capacidadMercado: result.capacidadMercado,
    capacidadLibre: result.capacidadLibre,
    // Fichajes que mejoran tu once y encima te dejan dinero. Prioridad máxima.
    freeUpgrades: (result.freeUpgrades ?? []).map((g) => ({
      entra: byId.get(g.inId)?.name ?? String(g.inId),
      sale: byId.get(g.outId)?.name ?? String(g.outId),
      gain: Math.round(g.gain * 10) / 10,
      ingreso: Math.round(g.ingreso),
    })),
    replacement: Object.fromEntries(
      Object.entries(result.replacement).map(([k, v]) => [k, Math.round(v * 10) / 10]),
    ),
    economia: {
      saldo: result.economia.saldo,
      valorPlantilla: result.economia.valorPlantilla,
      modo: result.economia.modo,
      limitePuja: Math.round(result.economia.limitePuja),
      margenDeuda: Math.round(result.economia.margenDeuda),
      exposicionTotal: plan.exposicionTotal,
      descubierto: plan.descubierto,
      avisos: plan.avisos,
      ventasNecesarias: plan.ventasNecesarias.map((v) => ({
        nombre: byId.get(v.playerId)?.name ?? String(v.playerId),
        ingreso: v.ingreso,
      })),
    },
    me: {
      balance: state.me.balance,
      formation: xi.formation,
      xiPoints: Math.round(xi.points * 10) / 10,
      currentLineup: current ?? null,
      currentPoints: current
        ? Math.round(
            squadCandidates
              .filter((c) => current.includes(c.playerId))
              .reduce((s, c) => s + c.projectedPoints, 0) * 10,
          ) / 10
        : null,
      changes,
    },
    market: result.buys.map((r: Recommendation) => ({
      ...meta(r.playerId),
      score: r.score,
      quality: r.quality ?? null,
      reval: r.appreciation ?? null,
      valorPuntos: r.valueFromPoints ?? null,
      pagado: pagadoPor.get(r.playerId) ?? null,
      plusvalia: pagadoPor.has(r.playerId)
        ? (byId.get(r.playerId)?.price ?? 0) - pagadoPor.get(r.playerId)!
        : null,
      action: r.action,
      askingPrice: r.askingPrice ?? askByPlayer.get(r.playerId) ?? 0,
      maxBid: Math.round(r.maxBid),
      suggestedBid: r.suggestedBid ?? null,
      displaces: r.displacesPlayerId ? byId.get(r.displacesPlayerId)?.name ?? null : null,
      vendedor: (() => {
        const e = entradaPorJugador.get(r.playerId);
        if (!e || e.origin !== 'manager' || !e.sellerUserId) return null;
        return nombreManager.get(e.sellerUserId) ?? `Manager ${e.sellerUserId}`;
      })(),
      cierraEn: entradaPorJugador.get(r.playerId)?.expiresAt ?? null,
      reasons: r.reasons,
    })),
    squad: result.sells.map((r: Recommendation) => ({
      ...meta(r.playerId),
      score: r.score,
      quality: r.quality ?? null,
      reval: r.appreciation ?? null,
      // Cuánto pagaste por él y cuánto llevas ganado o perdido.
      pagado: pagadoPor.get(r.playerId) ?? null,
      plusvalia: pagadoPor.has(r.playerId)
        ? (byId.get(r.playerId)?.price ?? 0) - pagadoPor.get(r.playerId)!
        : null,
      action: r.action,
      valueToMe: Math.round(r.maxBid),
      inXI: xiIds.has(r.playerId),
      reasons: r.reasons,
    })),
  };
}
