import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { makeClient } from '../biwenger/client.js';
import { endpoints, fijarScore } from '../biwenger/endpoints.js';

/**
 * FASE 0. Baja los endpoints y los vuelca tal cual, y después comprueba que
 * todo lo que el motor necesita está donde el adaptador cree que está.
 *
 * Actualizado tras sondear la API real: la llamada de calendario devuelve 403
 * y no hace falta, porque las jornadas están en `season.rounds` del dataset de
 * competición y los próximos partidos en `nextGames` de cada equipo.
 */
async function main() {
  mkdirSync(config.rawDir, { recursive: true });
  const client = await makeClient();

  // La liga primero: dice el sistema de puntuación, que va en las demás URLs.
  let scoreId = 0;
  try {
    const liga: any = await client.get(endpoints.league());
    writeFileSync(join(config.rawDir, 'league.json'), JSON.stringify(liga, null, 2));
    scoreId = Number(liga?.scoreID) || 0;
    if (scoreId) fijarScore(scoreId);
    console.log(`✓ league (sistema de puntuación ${scoreId || '?'})`);
  } catch (err) {
    console.error(`✗ league: ${(err as Error).message}`);
  }

  const targets: Array<[string, string]> = [
    ['account', endpoints.account()],
    ['competition-data', endpoints.competitionData()],
    ['market', endpoints.market()],
    ['my-team', endpoints.myTeam()],
  ];

  for (const [name, url] of targets) {
    try {
      const data = await client.get(url);
      writeFileSync(join(config.rawDir, `${name}.json`), JSON.stringify(data, null, 2));
      console.log(`✓ ${name}`);
    } catch (err) {
      console.error(`✗ ${name}: ${(err as Error).message}`);
    }
  }

  // La plantilla de un rival, para confirmar que se pueden leer.
  try {
    const liga: any = JSON.parse(readFileSync(join(config.rawDir, 'league.json'), 'utf8'));
    const rival = (liga?.standings ?? [])[0];
    if (rival?.id) {
      const data = await client.get(endpoints.userSquad(rival.id));
      writeFileSync(join(config.rawDir, 'rival-squad.json'), JSON.stringify(data, null, 2));
      console.log(`✓ plantilla de ${rival.name}`);
    }
  } catch (err) {
    console.error(`✗ plantilla de rival: ${(err as Error).message}`);
  }

  // La ficha de un jugador: aquí están los minutos y el histórico de precios.
  try {
    const comp: any = JSON.parse(readFileSync(join(config.rawDir, 'competition-data.json'), 'utf8'));
    const jugadores = Array.isArray(comp?.players) ? comp.players : Object.values(comp?.players ?? {});
    const muestra: any = (jugadores as any[]).find((p) => (p?.points ?? 0) > 0) ?? jugadores[0];
    if (muestra?.id) {
      const data = await client.get(endpoints.player(muestra.id));
      writeFileSync(join(config.rawDir, 'player-sample.json'), JSON.stringify(data, null, 2));
      console.log(`✓ ficha de ${muestra.name}`);
    }
  } catch (err) {
    console.error(`✗ ficha de jugador: ${(err as Error).message}`);
  }

  comprobaciones();
}

/** Verifica que cada dato que el motor necesita está donde se espera. */
function comprobaciones(): void {
  const leer = (n: string) => {
    try { return JSON.parse(readFileSync(join(config.rawDir, `${n}.json`), 'utf8')); }
    catch { return null; }
  };

  const comp = leer('competition-data');
  const liga = leer('league');
  const mio = leer('my-team');
  const mercado = leer('market');
  const ficha = leer('player-sample');
  const rival = leer('rival-squad');

  console.log('\n' + '='.repeat(56));
  console.log('  ¿ESTÁ TODO LO QUE EL MOTOR NECESITA?');
  console.log('='.repeat(56));

  const fila = (etiqueta: string, ok: boolean, detalle = '') =>
    console.log(`  ${ok ? 'SÍ ' : 'NO '} ${etiqueta.padEnd(32)} ${detalle}`);

  const jugadores: any[] = comp
    ? (Array.isArray(comp.players) ? comp.players : Object.values(comp.players ?? {}))
    : [];
  fila('Jugadores', jugadores.length > 0, `${jugadores.length}`);

  const posiciones = [...new Set(jugadores.map((p) => Number(p?.position)))].sort();
  fila('Posiciones', posiciones.length > 0, posiciones.join(', ') + ' (la 5 son entrenadores)');

  const scoreId = Number(liga?.scoreID);
  const nombreSistema = (comp?.scores ?? []).find((s: any) => Number(s.id) === scoreId)?.name;
  fila('Sistema de puntuación', Number.isFinite(scoreId), `${scoreId} · ${nombreSistema ?? '?'}`);

  const rounds = comp?.season?.rounds ?? [];
  fila('Calendario (season.rounds)', rounds.length > 0, `${rounds.length} jornadas`);

  const equipos: any[] = Object.values(comp?.teams ?? {});
  const conProximos = equipos.filter((t: any) => (t?.nextGames ?? []).length).length;
  fila('Próximos partidos', conProximos > 0, `${conProximos}/${equipos.length} equipos`);

  const split = jugadores.filter((p) => p?.pointsHome !== undefined).length;
  fila('Desglose casa/fuera', split > 0, `${split} jugadores`);

  fila('Saldo', typeof mio?.balance === 'number', `${((mio?.balance ?? 0) / 1e6).toFixed(2)}M€`);
  fila('Mi plantilla', (mio?.players ?? []).length > 0, `${(mio?.players ?? []).length} jugadores`);

  const managers = liga?.standings ?? [];
  fila('Managers', managers.length > 0, `${managers.length}`);
  fila('Plantilla de rivales', (rival?.players ?? []).length > 0,
    `${(rival?.players ?? []).length} jugadores`);

  const ventas = mercado?.sales ?? [];
  const libres = ventas.filter((s: any) => !s?.user).length;
  fila('Mercado', ventas.length > 0, `${ventas.length} ventas · ${libres} libres`);

  const informes = ficha?.reports ?? [];
  const conMinutos = informes.filter((r: any) => r?.rawStats?.minutesPlayed !== undefined).length;
  fila('Minutos por jornada', conMinutos > 0, `${conMinutos}/${informes.length} informes`);
  fila('Histórico de precios', (ficha?.prices ?? []).length > 0, `${(ficha?.prices ?? []).length} días`);

  console.log('\nSi algo sale NO, pégalo en el chat. Si está todo en SÍ,');
  console.log('ejecuta: npm run snapshot');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
