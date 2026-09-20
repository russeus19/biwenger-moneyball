import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';
import type { LeagueState, Recommendation } from '../domain/types.js';

/**
 * El histórico es tuyo, no de Biwenger: la API no da datos retroactivos de
 * ofertas. Cada día que no guardas es una foto que pierdes para siempre, y sin
 * histórico no hay backtest.
 *
 * Usa el SQLite que viene DENTRO de Node (`node:sqlite`), no una librería
 * externa. La versión anterior dependía de `better-sqlite3`, que es código
 * nativo: en Windows con Node reciente no hay binario precompilado, así que
 * intentaba compilarlo y exigía instalar Python y las herramientas de
 * Visual Studio. Un requisito absurdo para guardar cuatro tablas.
 *
 * Si la versión de Node no lo trae, el resto del sistema sigue funcionando sin
 * guardar histórico: las recomendaciones del día no dependen de él.
 */

type Stmt = { run: (...a: unknown[]) => unknown; get: (...a: unknown[]) => unknown; all: (...a: unknown[]) => unknown[] };
type Db = { exec: (sql: string) => void; prepare: (sql: string) => Stmt };

let db: Db | null = null;
export let almacenamientoActivo = false;

try {
  // Import dinámico: en Node 20 este módulo no existe y no debe romper nada.
  const { DatabaseSync } = (await import('node:sqlite')) as any;
  mkdirSync(dirname(config.dbPath), { recursive: true });
  db = new DatabaseSync(config.dbPath) as Db;
  db.exec('PRAGMA journal_mode = WAL;');
  almacenamientoActivo = true;
} catch (err) {
  console.warn(
    `[almacenamiento] sin histórico: ${(err as Error).message}\n` +
      `  Necesitas Node 22.5 o superior. Las recomendaciones de hoy funcionan igual;\n` +
      `  lo que se pierde es el histórico y, con él, poder ejecutar el backtest.`,
  );
}

if (db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS player_snapshot (
  date        TEXT NOT NULL,
  player_id   INTEGER NOT NULL,
  name        TEXT,
  position    TEXT,
  team_id     INTEGER,
  price       INTEGER,
  price_delta INTEGER,
  points      INTEGER,
  matches     INTEGER,
  status      TEXT,
  PRIMARY KEY (date, player_id)
);

CREATE TABLE IF NOT EXISTS market_snapshot (
  date         TEXT NOT NULL,
  player_id    INTEGER NOT NULL,
  asking_price INTEGER,
  origin       TEXT,
  seller_id    INTEGER,
  expires_at   INTEGER,
  PRIMARY KEY (date, player_id)
);

CREATE TABLE IF NOT EXISTS valuation (
  date              TEXT NOT NULL,
  player_id         INTEGER NOT NULL,
  action            TEXT,
  score             REAL,
  projected_points  REAL,
  max_bid           INTEGER,
  suggested_bid     INTEGER,
  asking_price      INTEGER,
  start_probability REAL,
  reasons           TEXT,
  PRIMARY KEY (date, player_id, action)
);

CREATE TABLE IF NOT EXISTS round_result (
  round     INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  points    INTEGER,
  minutes   INTEGER,
  PRIMARY KEY (round, player_id)
);

CREATE TABLE IF NOT EXISTS alert_sent (
  date      TEXT NOT NULL,
  player_id INTEGER NOT NULL,
  PRIMARY KEY (date, player_id)
);

CREATE INDEX IF NOT EXISTS idx_player_snapshot_player ON player_snapshot(player_id);
CREATE INDEX IF NOT EXISTS idx_valuation_date ON valuation(date);
`);
}

/** Acceso para los scripts que consultan directamente (backtest). */
export function getDb(): Db | null {
  return db;
}

/** node:sqlite no tiene envoltorio de transacciones: se hace a mano. */
function enTransaccion(fn: () => void): void {
  if (!db) return;
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function persistState(state: LeagueState): void {
  if (!db) return;

  const insPlayer = db.prepare(`
    INSERT OR REPLACE INTO player_snapshot
      (date, player_id, name, position, team_id, price, price_delta, points, matches, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insMarket = db.prepare(`
    INSERT OR REPLACE INTO market_snapshot
      (date, player_id, asking_price, origin, seller_id, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insRound = db.prepare(`
    INSERT OR REPLACE INTO round_result (round, player_id, points, minutes) VALUES (?, ?, ?, ?)
  `);

  enTransaccion(() => {
    for (const p of state.players) {
      insPlayer.run(
        state.date, p.id, p.name, p.position, p.teamId,
        Math.round(p.price), Math.round(p.priceDelta), Math.round(p.points), p.matchesPlayed,
        p.availability,
      );
      for (const r of p.reports) {
        if (r.round > 0) insRound.run(r.round, p.id, Math.round(r.points), Math.round(r.minutes));
      }
    }
    for (const m of state.market) {
      insMarket.run(
        state.date, m.playerId, Math.round(m.askingPrice), m.origin,
        m.sellerUserId ?? null, m.expiresAt ?? null,
      );
    }
  });
}

export function persistValuations(date: string, recs: Recommendation[]): void {
  if (!db) return;
  const ins = db.prepare(`
    INSERT OR REPLACE INTO valuation
      (date, player_id, action, score, projected_points, max_bid,
       suggested_bid, asking_price, start_probability, reasons)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  enTransaccion(() => {
    for (const r of recs) {
      ins.run(
        date, r.playerId, r.action, r.score, r.projectedPoints,
        Math.round(r.maxBid),
        r.suggestedBid != null ? Math.round(r.suggestedBid) : null,
        r.askingPrice != null ? Math.round(r.askingPrice) : null,
        r.startProbability, JSON.stringify(r.reasons),
      );
    }
  });
}

/** Evita repetir la misma alerta si el jugador sigue en el mercado varios días. */
export function alreadyAlerted(date: string, playerId: number): boolean {
  if (!db) return false;
  return !!db.prepare('SELECT 1 FROM alert_sent WHERE date = ? AND player_id = ?').get(date, playerId);
}

export function markAlerted(date: string, playerId: number): void {
  if (!db) return;
  db.prepare('INSERT OR REPLACE INTO alert_sent (date, player_id) VALUES (?, ?)').run(date, playerId);
}
