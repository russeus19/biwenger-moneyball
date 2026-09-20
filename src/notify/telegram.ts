import { config } from '../config.js';
import type { Player, Recommendation } from '../domain/types.js';

const euros = (n: number) => `${(n / 1_000_000).toFixed(1)}M€`;

export async function sendTelegram(text: string): Promise<void> {
  const { botToken, chatId } = config.telegram;
  if (!botToken || !chatId) {
    console.log('[telegram] sin configurar, imprimo por consola:\n' + text);
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) console.error(`[telegram] error ${res.status}: ${await res.text()}`);
}

export function formatAlert(
  recs: Recommendation[],
  byId: Map<number, Player>,
  lambda: number,
): string {
  const lines: string[] = [];
  lines.push(`<b>Mercado de hoy</b> · ${recs.length} oportunidad(es)`);
  lines.push(`<i>Tipo de cambio: ${lambda.toFixed(2)} pts por millón</i>`);
  lines.push('');

  for (const r of recs) {
    const p = byId.get(r.playerId);
    lines.push(`<b>${p?.name ?? r.playerId}</b> (${p?.position}, ${p?.teamName}) — <b>${r.score.toFixed(1)}</b>`);
    lines.push(`Pide ${euros(r.askingPrice ?? 0)} · techo ${euros(r.maxBid)} · pujar ${euros(r.suggestedBid ?? 0)}`);
    for (const reason of r.reasons.slice(0, 3)) lines.push(`· ${reason}`);
    lines.push('');
  }

  lines.push('<i>Recomendación, no ejecución. Las pujas las haces tú.</i>');
  return lines.join('\n');
}

export function formatSells(recs: Recommendation[], byId: Map<number, Player>): string {
  if (recs.length === 0) return '';
  const lines = ['<b>Candidatos a venta</b>', ''];
  for (const r of recs) {
    const p = byId.get(r.playerId);
    lines.push(`<b>${p?.name ?? r.playerId}</b> — vale ${euros(r.maxBid)} para ti, el mercado lo tasa en ${euros(p?.price ?? 0)}`);
    for (const reason of r.reasons.slice(0, 2)) lines.push(`· ${reason}`);
    lines.push('');
  }
  return lines.join('\n');
}
