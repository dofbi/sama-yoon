// One dispatch run: compute due alerts, claim each one in alert_log (unique
// key = lock against overlapping runs), send to matching subscriptions.
import { dueOfficialAlerts, citizenAlerts, weatherAlerts } from './alerts.mjs';
import { openMeteoUrl, normalise } from './weather.mjs';
import { ACTIVE_EVENT } from '../../src/config/event.js';
import { db, siteJson, sendPush, mapLimit } from './push-backend.mjs';

export async function computeDue(now, origin) {
  const [events, zones] = await Promise.all([siteJson('events_schedule.json', origin), siteJson('alert_zones.json', origin)]);
  const since = new Date(now.getTime() - 26 * 3600e3).toISOString();
  const sent = await db(`alert_log?select=key&sent_at=gte.${since}`);
  const sentKeys = new Set(sent.map((r) => r.key));
  const reports = await db(
    `user_reports?select=id,created_at,latitude,longitude,report_type,upvotes,expires_at&created_at=gte.${new Date(now.getTime() - 3600e3).toISOString()}`,
  );
  const [forecast, notices, rain] = await Promise.all([
    loadForecast().catch(() => []),
    db(`weather_notices?select=id,level,title,summary,areas,source_name,valid_until&valid_until=gt.${now.toISOString()}`).catch(() => []),
    siteJson('rain_notices.json', origin).catch(() => ({ items: [] })),
  ]);
  return [
    ...dueOfficialAlerts(events.items, zones.items, now, sentKeys),
    ...citizenAlerts(reports, zones.items, now, sentKeys),
    ...weatherAlerts(forecast, notices, zones.items, now, sentKeys, rain.items),
  ];
}

async function loadForecast() {
  const points = ACTIVE_EVENT.zones.map((z) => ({ id: z.name.toLowerCase(), name: z.name, lat: z.center[0], lng: z.center[1] }));
  const res = await fetch(openMeteoUrl(points));
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  return normalise(points, await res.json());
}

export async function dispatch(now, { origin, dryRun = false } = {}) {
  const due = await computeDue(now, origin);
  if (dryRun || !due.length) return { now: now.toISOString(), due, sent: [] };

  const subs = await db('push_subscriptions?select=id,endpoint,p256dh,auth,zones,triggers,fail_count&limit=10000');
  const results = [];
  for (const a of due) {
    try {
      await db('alert_log', { method: 'POST', prefer: 'return=minimal', body: { key: a.key, zone_id: a.zone_id, kind: a.kind, title: a.title, body: a.body } });
    } catch (e) {
      if (e.status === 409) continue; // already claimed by another run
      throw e;
    }
    const targets = subs.filter((s) => s.zones.includes(a.zone_id) && s.triggers.includes(a.trigger));
    const payload = { title: a.title, body: a.body, url: a.url, tag: `sy-${a.zone_id}` };
    const outcome = await mapLimit(targets, 20, (s) => sendPush(s, payload));
    const gone = targets.filter((_, i) => outcome[i] === 'gone').map((s) => s.id);
    const failed = targets.filter((_, i) => outcome[i] === 'failed');
    if (gone.length) await db(`push_subscriptions?id=in.(${gone.join(',')})`, { method: 'DELETE' });
    for (const s of failed) {
      if (s.fail_count + 1 >= 3) await db(`push_subscriptions?id=eq.${s.id}`, { method: 'DELETE' });
      else await db(`push_subscriptions?id=eq.${s.id}`, { method: 'PATCH', body: { fail_count: s.fail_count + 1 } });
    }
    const ok = outcome.filter((o) => o === 'ok').length;
    await db(`alert_log?key=eq.${encodeURIComponent(a.key)}`, { method: 'PATCH', body: { recipients: ok } });
    results.push({ key: a.key, recipients: ok, removed: gone.length, failed: failed.length });
  }
  return { now: now.toISOString(), due, sent: results };
}
