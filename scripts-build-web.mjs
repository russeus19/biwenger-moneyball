import { mkdirSync, copyFileSync, readdirSync, existsSync } from 'node:fs';

/**
 * Prepara lo que Vercel va a publicar: la página y los JSON de cada manager.
 * Al vivir en el mismo dominio, la app los lee sin CORS y sin mezclar http con
 * https, que era lo que nos bloqueaba leer desde el móvil.
 */
mkdirSync('public', { recursive: true });
copyFileSync('web/index.html', 'public/index.html');

let copiados = 0;
if (existsSync('data')) {
  for (const f of readdirSync('data')) {
    // market-sample.json es la demo: no tiene que llegar a producción.
    if (f.startsWith('market-') && f.endsWith('.json') && f !== 'market-sample.json') {
      copyFileSync(`data/${f}`, `public/${f}`);
      copiados++;
    }
  }
}
console.log(`web lista: index.html + ${copiados} fichero(s) de datos`);
if (copiados === 0) {
  console.log('Aviso: no hay data/market-*.json todavía. La app arrancará con los datos de demostración.');
}
