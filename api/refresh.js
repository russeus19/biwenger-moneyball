/**
 * Botón de actualizar.
 *
 * La web es estática y no puede ejecutar nada, así que este intermediario
 * recibe la petición del botón y le dice a GitHub que lance el workflow.
 *
 * Existe por una razón concreta: la llave de GitHub NO puede ir en la página.
 * Sería pública y cualquiera podría usarla. Aquí vive como variable de entorno
 * de Vercel, que solo ve el servidor.
 *
 * Variables necesarias (Vercel → Settings → Environment Variables):
 *   GITHUB_TOKEN   la llave de acceso personal, con permiso de Actions
 *   GITHUB_REPO    opcional, "usuario/repositorio". Si no está, se deduce.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Solo POST' });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    res.status(500).json({
      error: 'Falta GITHUB_TOKEN',
      ayuda: 'Añádelo en Vercel → Settings → Environment Variables y vuelve a desplegar.',
    });
    return;
  }

  // Vercel rellena estas dos solo cuando el proyecto viene de un repositorio.
  const repo =
    process.env.GITHUB_REPO ||
    (process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
      ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`
      : null);

  if (!repo) {
    res.status(500).json({
      error: 'No sé a qué repositorio llamar',
      ayuda: 'Añade GITHUB_REPO con el formato usuario/repositorio.',
    });
    return;
  }

  const url = `https://api.github.com/repos/${repo}/actions/workflows/snapshot.yml/dispatches`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'biwenger-moneyball',
      },
      body: JSON.stringify({ ref: 'main' }),
    });

    // GitHub responde 204 sin cuerpo cuando lo acepta.
    if (r.status === 204) {
      res.status(200).json({
        ok: true,
        mensaje: 'Análisis lanzado. Tarda unos tres minutos.',
      });
      return;
    }

    const detalle = await r.text();
    const ayuda =
      r.status === 401 ? 'La llave no es válida o ha caducado.' :
      r.status === 404 ? 'No encuentra el repositorio o el workflow. Revisa GITHUB_REPO y que la llave tenga acceso.' :
      r.status === 403 ? 'La llave no tiene permiso de Actions (hace falta Read and write).' :
      'Respuesta inesperada de GitHub.';

    res.status(502).json({ error: `GitHub devolvió ${r.status}`, ayuda, detalle: detalle.slice(0, 300) });
  } catch (err) {
    res.status(502).json({ error: 'No pude hablar con GitHub', detalle: String(err).slice(0, 200) });
  }
}
