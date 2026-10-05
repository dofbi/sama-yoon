// GET /.netlify/functions/alerts-admin?now=2026-11-07T19:05  (Authorization: Bearer <ALERTS_ADMIN_TOKEN>)
// Dry run: lists the alerts that would be sent at that moment, plus the number
// of subscriptions per zone. Never sends anything.
import { dispatch } from '../lib/dispatch.mjs';
import { assertConfigured, db, json } from '../lib/push-backend.mjs';

export default async (req) => {
  const token = process.env.ALERTS_ADMIN_TOKEN;
  if (!token || req.headers.get('authorization') !== `Bearer ${token}`) return json({ error: 'unauthorized' }, 401);
  try {
    assertConfigured();
  } catch (e) {
    return json({ error: 'not_configured', detail: e.message }, 503);
  }
  const url = new URL(req.url);
  const at = url.searchParams.get('now');
  const now = at ? new Date(`${at.replace(/Z$/, '')}Z`) : new Date();
  if (Number.isNaN(now.getTime())) return json({ error: 'bad_now' }, 400);
  const result = await dispatch(now, { origin: url.origin, dryRun: true });
  const subs = await db('push_subscriptions?select=zones');
  const perZone = {};
  for (const s of subs) for (const z of s.zones) perZone[z] = (perZone[z] || 0) + 1;
  return json({ ...result, subscriptions: subs.length, per_zone: perZone });
};
