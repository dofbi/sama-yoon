// POST   /.netlify/functions/alerts-subscribe  { subscription, zones[], triggers[] }
// DELETE /.netlify/functions/alerts-subscribe  { endpoint }
// Stores Web Push subscriptions (anonymous) with the zones they follow, and
// sends a confirmation notification on first activation.
import { parseSubscription } from '../lib/alerts.mjs';
import { assertConfigured, db, siteJson, sendPush, json } from '../lib/push-backend.mjs';
import { fr } from '../../src/i18n/fr.js';

const MAX_BODY = 4096;

export default async (req) => {
  const origin = new URL(req.url).origin;
  const cors = { 'access-control-allow-origin': origin, vary: 'origin' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'access-control-allow-methods': 'POST, DELETE', 'access-control-allow-headers': 'content-type' } });
  const reqOrigin = req.headers.get('origin');
  if (reqOrigin && reqOrigin !== origin) return json({ error: 'forbidden_origin' }, 403);
  try {
    assertConfigured();
  } catch (e) {
    return json({ error: 'not_configured', detail: e.message }, 503, cors);
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: 'too_large' }, 413, cors);
  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return json({ error: 'bad_json' }, 400, cors);
  }

  if (req.method === 'DELETE') {
    const endpoint = String(body.endpoint || '');
    if (!endpoint.startsWith('https://')) return json({ error: 'invalid_endpoint' }, 400, cors);
    await db(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE' });
    return json({ ok: true }, 200, cors);
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);

  const zones = (await siteJson('alert_zones.json', origin)).items.map((z) => z.id);
  const sub = parseSubscription(body, zones);
  if (sub.error) return json({ error: sub.error }, 400, cors);

  const existing = await db(`push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}&select=id`);
  await db('push_subscriptions?on_conflict=endpoint', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { ...sub, last_seen_at: new Date().toISOString(), fail_count: 0 },
  });
  // First activation: confirm with a real notification (end-to-end check).
  if (!existing?.length) {
    await sendPush(sub, { title: fr.push.testTitle, body: fr.push.testBody, url: '/', tag: 'sy-welcome' });
  }
  return json({ ok: true, created: !existing?.length, zones: sub.zones, triggers: sub.triggers }, 200, cors);
};
