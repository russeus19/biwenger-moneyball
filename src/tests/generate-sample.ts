import { mkdirSync, writeFileSync } from 'node:fs';
import type { LeagueState, Player } from '../domain/types.js';
import { REALES, comoPlayers, precioDe } from './real-data.js';
import { projectAll } from '../engine/projection.js';
import { evaluate } from '../engine/decisions.js';
import { buildPayload } from '../export.js';
import { bestXI, toCandidates } from '../engine/lambda.js';

/**
 * Datos de demostración para el front, con JUGADORES REALES de LaLiga 2026/27:
 * nombres, equipos, posiciones y puntos jornada a jornada del sistema
 * AS+Sofascore. Los precios son los de Biwenger donde los tengo contrastados y
 * estimados en el resto (van marcados como tales).
 *
 * Lo único inventado es la liga: quién tiene a quién, tu saldo y qué hay hoy en
 * el mercado. Eso es personal y no existe hasta que conectas tu cuenta.
 *
 * Uso: npm run sample
 */

let semilla = 20260919;
const rnd = () => {
  semilla = (semilla * 1664525 + 1013904223) % 4294967296;
  return semilla / 4294967296;
};

const JORNADAS = 7;
const jugadores: Player[] = comoPlayers(REALES, JORNADAS);

const CUPO = { GK: 2, DF: 5, MF: 5, FW: 4 } as const;
const MANAGERS = 4;

const porPosicion: Record<string, Player[]> = { GK: [], DF: [], MF: [], FW: [] };
for (const p of [...jugadores].sort(() => rnd() - 0.5)) porPosicion[p.position]!.push(p);
// Los rivales reparten primero: yo soy de media tabla, que es el caso
// interesante. Con un once ya óptimo no habría fichaje que lo mejorase.
for (const pos of Object.keys(porPosicion)) {
  porPosicion[pos]!.sort((a, b) => a.points - b.points);
}

const managers: Array<{ userId: number; name: string; squad: Array<{ playerId: number; ownerUserId: number }> }> = [];
// Cupo real: no se puede repartir más de los que hay en el conjunto de datos.
// Si se reparte a ciegas, al último manager (yo) le quedan plantillas
// imposibles, como un solo centrocampista, y eso no representa nada real.
const CUPO_REAL = { ...CUPO } as Record<string, number>;
for (const pos of ['GK', 'DF', 'MF', 'FW'] as const) {
  CUPO_REAL[pos] = Math.min(CUPO[pos], Math.floor(porPosicion[pos]!.length / MANAGERS));
}

for (let m = MANAGERS - 1; m >= 0; m--) {
  const squad: Array<{ playerId: number; ownerUserId: number }> = [];
  for (const pos of ['GK', 'DF', 'MF', 'FW'] as const) {
    for (let i = 0; i < CUPO_REAL[pos]!; i++) {
      const p = porPosicion[pos]!.pop(); // pop = los de más puntos
      if (p) squad.push({ playerId: p.id, ownerUserId: m + 1 });
    }
  }
  managers.unshift({ userId: m + 1, name: `Manager ${m + 1}`, squad });
}
const yo = managers[0]!;

const fichados = new Set(managers.flatMap((m) => m.squad.map((s) => s.playerId)));
const libres = jugadores.filter((p) => !fichados.has(p.id));

type Entrada = { playerId: number; askingPrice: number; origin: 'free' | 'manager'; sellerUserId?: number };

const market: Entrada[] = [
  ...libres.map((p): Entrada => ({ playerId: p.id, askingPrice: p.price, origin: 'free' })),
];
for (const m of managers.slice(1)) {
  const suyos = m.squad
    .map((s) => jugadores.find((x) => x.id === s.playerId)!)
    .filter(Boolean)
    .sort((a, b) => b.points - a.points);
  if (rnd() < 0.7 && suyos.length) {
    const p = suyos[Math.floor(rnd() * 3)]!;
    market.push({
      playerId: p.id,
      askingPrice: Math.round(p.price * (1.05 + rnd() * 0.2)),
      origin: 'manager',
      sellerUserId: m.userId,
    });
  }
}

const state: LeagueState = {
  date: new Date().toISOString().slice(0, 10),
  currentRound: JORNADAS + 1,
  players: jugadores,
  market,
  managers,
  me: { userId: 1, balance: 12_500_000, squad: yo.squad },
};

const opciones = { horizonRounds: 6, shrinkageK: 4, formHalflife: 8, minutesHalflife: 6 };

// Alineación puesta: el once óptimo con dos suplentes metidos, para que haya
// cambios reales que sugerir.
{
  // Se parte del mejor once LEGAL y se empeora metiendo dos suplentes de la
  // MISMA posición. Cogiendo "los once mejores" a secas salía una alineación
  // ilegal que puntuaba más que cualquier formación válida, y entonces los
  // cambios sugeridos aparecían como pérdida de puntos.
  const proy0 = projectAll({ players: state.players, ...opciones });
  const mios = state.me.squad
    .map((s) => jugadores.find((p) => p.id === s.playerId)!)
    .filter(Boolean);
  const cands = toCandidates(mios, proy0);
  const xi = bestXI(cands);
  const once = xi.lineup.map((c) => c.playerId);

  const suplentes = cands
    .filter((c) => !once.includes(c.playerId))
    .sort((a, b) => b.projectedPoints - a.projectedPoints);

  for (const sup of suplentes.slice(0, 2)) {
    const titularesMismaPos = xi.lineup.filter((c) => c.position === sup.position);
    if (!titularesMismaPos.length) continue;
    const peor = titularesMismaPos.reduce((a, b) => (a.projectedPoints < b.projectedPoints ? a : b));
    const i = once.indexOf(peor.playerId);
    if (i !== -1) once[i] = sup.playerId;
  }
  state.me.currentLineup = once;
}

const projections = projectAll({ players: state.players, ...opciones });
const result = evaluate(state, projections, { horizonRounds: 6, modoPuja: 'saldo25' });

const payload: any = { ...buildPayload(state, projections, result), simulated: true };

// Los ids de la demo son inventados, así que las URLs de imagen apuntarían a
// ficheros que no existen: 30 peticiones fallidas para nada. Se dejan vacías y
// la app enseña las iniciales, que es su comportamiento de respaldo normal.
for (const lista of [payload.market, payload.squad]) {
  for (const p of lista) { p.foto = null; p.escudo = null; }
}

// Marcar qué precios son reales y cuáles estimados, para no dar gato por liebre.
const realPorNombre = new Map(REALES.map((d) => [d.nombre, precioDe(d).real]));
for (const lista of [payload.market, payload.squad]) {
  for (const p of lista) p.precioReal = realPorNombre.get(p.name) ?? false;
}

mkdirSync('./data', { recursive: true });
writeFileSync('./data/market-sample.json', JSON.stringify(payload, null, 2));

const eur = (n: number) => (n / 1e6).toFixed(1) + 'M';
console.log(`lambda = ${payload.lambda} pts/M | limite ${eur(payload.economia.limitePuja)}`);
console.log(`mercado ${payload.market.length} | fichar ${payload.market.filter((m: any) => m.action === 'buy').length} | vender ${payload.squad.filter((s: any) => s.action === 'sell').length}`);
console.log('\nTop del mercado:');
for (const m of payload.market.slice(0, 10)) {
  console.log(
    `  ${String(m.score).padStart(4)}  ${m.name.padEnd(20)} ${m.position}  ` +
      `pide ${eur(m.askingPrice).padStart(6)}  techo ${eur(m.maxBid).padStart(6)}  ` +
      `${m.precioReal ? 'real' : 'estimado'}`,
  );
}
