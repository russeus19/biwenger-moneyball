import express from 'express';
import { readFileSync } from 'node:fs';
import { config } from '../config.js';
import { getDb } from '../storage/db.js';

/**
 * Sirve lo que ya calculó el job nocturno. No llama a Biwenger en caliente: el
 * front lee de la base, así que abrir la app diez veces no toca la API una sola.
 */
const app = express();

// Sin esto, el front publicado en otro dominio no puede leer de aquí.
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

/**
 * El contrato del front es EXACTAMENTE el JSON que escribe el job nocturno.
 * Antes este endpoint montaba una consulta a la base con otra forma distinta,
 * así que la app no podía leerlo: había dos contratos incompatibles llamándose
 * igual. Ahora sirve el fichero, que es la única fuente de verdad.
 */
app.get('/api/market', (_req, res) => {
  try {
    res.type('application/json').send(readFileSync('./data/market.json', 'utf8'));
  } catch {
    res.status(404).json({ error: 'Todavía no hay market.json. Ejecuta npm run snapshot.' });
  }
});

app.get('/api/player/:id', (req, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  if (!db) { res.status(503).json({ error: 'Sin almacenamiento' }); return; }
  const prices = db
    .prepare('SELECT date, price, price_delta FROM player_snapshot WHERE player_id = ? ORDER BY date')
    .all(id);
  const rounds = db
    .prepare('SELECT round, points, minutes FROM round_result WHERE player_id = ? ORDER BY round')
    .all(id);
  const valuations = db
    .prepare('SELECT * FROM valuation WHERE player_id = ? ORDER BY date DESC LIMIT 30')
    .all(id)
    .map((r: any) => ({ ...r, reasons: JSON.parse(r.reasons ?? '[]') }));
  res.json({ id, prices, rounds, valuations });
});

/**
 * Sirve también la web, para ver la app con tus datos reales sin desplegar
 * nada. Ejecuta antes `npm run build:web`, que copia el index y los
 * market-*.json a `public/`.
 */
app.use(express.static('public'));

/**
 * Arranca buscando puerto libre. Dejarse un servidor corriendo en otra terminal
 * es lo más fácil del mundo, y morir con EADDRINUSE obliga a ir a cazar el
 * proceso a mano. Prueba unos cuantos puertos y sigue.
 */
function arrancar(puerto: number, intentos = 10): void {
  const server = app.listen(puerto);

  server.on('listening', () => {
    console.log(`\n  App en  http://localhost:${puerto}/?u=dani`);
    console.log(`  API en  http://localhost:${puerto}/api/market`);
    if (puerto !== config.port) {
      console.log(`\n  (El ${config.port} estaba ocupado, probablemente por otro`);
      console.log(`   "npm run serve" que sigue abierto en otra terminal.)`);
    }
    console.log('');
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && intentos > 0) {
      arrancar(puerto + 1, intentos - 1);
      return;
    }
    console.error(`No pude arrancar: ${err.message}`);
    process.exit(1);
  });
}

arrancar(config.port);
