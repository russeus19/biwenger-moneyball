import { config } from '../config.js';
import { makeClient } from '../biwenger/client.js';
import { endpoints, fijarScore } from '../biwenger/endpoints.js';
import {
  adaptLeagueState, adaptPriceHistory, adaptDetailedReports,
  adaptScoreId, adaptSquadIds, adaptFixtures, adaptManagers, mapaJornadas,
} from '../biwenger/adapter.js';
import { projectAll } from '../engine/projection.js';
import { evaluate } from '../engine/decisions.js';
import { alreadyAlerted, markAlerted, persistState, persistValuations } from '../storage/db.js';
import { formatAlert, formatSells, sendTelegram } from '../notify/telegram.js';
import { buildPayload } from '../export.js';
import { mkdirSync, writeFileSync } from 'node:fs';

/** Ejecútalo de madrugada: el mercado de Biwenger rota entonces. */
export async function runDaily(): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const client = await makeClient();

  // La liga va PRIMERO porque dice qué sistema de puntuación usa, y ese dato
  // hay que meterlo en las URLs siguientes: el parámetro `score` decide en qué
  // sistema vienen los puntos, el fitness y el desglose casa/fuera. Pedirlos
  // con el sistema equivocado devuelve números de otra liga sin que nada falle
  // a la vista, que es la peor clase de error.
  const league = await client.get(endpoints.league());
  const scoreId = adaptScoreId(league);
  fijarScore(scoreId);
  console.log(`[liga] sistema de puntuación ${scoreId}`);

  const [competitionData, market, myTeam] = await Promise.all([
    client.get(endpoints.competitionData()),
    client.get(endpoints.market()),
    client.get(endpoints.myTeam()),
  ]);
  const jornadas = mapaJornadas(competitionData);

  // Las plantillas no vienen en la liga: una llamada por manager.
  const squadsByUser = new Map<number, number[]>();
  for (const m of adaptManagers(league)) {
    try {
      const u = await client.get(endpoints.userSquad(m.userId));
      squadsByUser.set(m.userId, adaptSquadIds(u));
    } catch (err) {
      console.warn(`[liga] plantilla de ${m.name}: ${(err as Error).message}`);
    }
  }
  console.log(
    `[liga] ${squadsByUser.size} plantillas, ` +
      `${[...squadsByUser.values()].reduce((s, a) => s + a.length, 0)} jugadores fichados`,
  );

  const state = adaptLeagueState({
    competitionData, market, league, myTeam, squadsByUser, date, scoreId,
  });
  console.log(
    `[snapshot] ${state.players.length} jugadores, ${state.market.length} en mercado, ` +
      `saldo ${(state.me.balance / 1e6).toFixed(1)}M€`,
  );

  // Histórico de precios: solo de los jugadores que salen en la app (mercado y
  // tu plantilla). Bajar las 500 fichas costaría varios minutos de peticiones
  // para datos que nadie va a mirar.
  const interesan = new Set<number>([
    ...state.market.map((m) => m.playerId),
    ...state.me.squad.map((s) => s.playerId),
  ]);
  const byIdTodos = new Map(state.players.map((p) => [p.id, p]));
  let conHistorico = 0;
  for (const id of interesan) {
    const jugador = byIdTodos.get(id);
    if (!jugador) continue;
    try {
      const ficha = await client.get(endpoints.player(jugador.id));
      const historico = adaptPriceHistory(ficha);
      if (historico) { jugador.priceHistory = historico; conHistorico++; }

      // La ficha trae rival, casa/fuera, goles y asistencias; el dataset de
      // competición no. Si viene, sustituye a los informes básicos.
      // La ficha trae minutos REALES, rival y resultado. Sustituye siempre a
      // los informes del dataset, que solo son las últimas cinco puntuaciones
      // sin contexto.
      const detallados = adaptDetailedReports(ficha, scoreId, jornadas);
      if (detallados.length > 0) jugador.reports = detallados;
    } catch (err) {
      // Una ficha que falla no debe tumbar el snapshot entero.
      console.warn(`[precios] ${jugador.name}: ${(err as Error).message}`);
    }
  }
  console.log(`[precios] histórico de ${conHistorico}/${interesan.size} jugadores`);

  persistState(state);

  const projections = projectAll({
    fixtures: adaptFixtures(competitionData),
    players: state.players,
    horizonRounds: config.engine.horizonRounds,
    shrinkageK: config.engine.shrinkageK,
    formHalflife: config.engine.formHalflife,
    minutesHalflife: config.engine.minutesHalflife,
  });

  const result = evaluate(state, projections, { horizonRounds: config.engine.horizonRounds, modoPuja: config.engine.modoPuja as any });
  persistValuations(date, [...result.buys, ...result.sells]);

  console.log(`[engine] lambda = ${result.lambda.toFixed(2)} pts/M€`);
  console.log(
    `[engine] nivel de reemplazo: ` +
      Object.entries(result.replacement)
        .map(([k, v]) => `${k} ${v.toFixed(1)}`)
        .join(' · '),
  );

  // El JSON que consume el front. Es el mismo contrato que sirve /api/market.
  // Un fichero por manager: el techo de puja depende de TU plantilla y TU
  // saldo, así que el mismo mercado da recomendaciones distintas a cada una.
  const quien = process.env.MANAGER_SLUG || 'market';
  const destino = quien === 'market' ? './data/market.json' : `./data/market-${quien}.json`;
  mkdirSync('./data', { recursive: true });
  writeFileSync(destino, JSON.stringify(buildPayload(state, projections, result)));
  console.log(`[export] ${destino}`);

  const byId = new Map(state.players.map((p) => [p.id, p]));

  const alerts = result.buys.filter(
    (r) =>
      r.action === 'buy' &&
      r.score >= config.engine.alertThreshold &&
      !alreadyAlerted(date, r.playerId),
  );

  if (alerts.length > 0) {
    await sendTelegram(formatAlert(alerts, byId, result.lambda));
    for (const a of alerts) markAlerted(date, a.playerId);
  } else {
    console.log('[alerta] nada supera el umbral hoy');
  }

  const sells = result.sells.filter((r) => r.action === 'sell' && r.score >= 7);
  if (sells.length > 0) await sendTelegram(formatSells(sells, byId));
}

runDaily().catch((err) => {
  console.error(err);
  process.exit(1);
});
