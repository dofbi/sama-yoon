import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { trafficNoticeAlerts } from '../netlify/lib/alerts.mjs';

const load = async (f) => JSON.parse(await readFile(new URL(`../public/data/events/jojdakar2026/${f}`, import.meta.url)));
const notices = (await load('traffic_notices.json')).items;
const zones = (await load('alert_zones.json')).items;
const at = (iso, sent) => trafficNoticeAlerts(notices, zones, new Date(iso), sent);

test('opening ceremony decree: eve alert on 30 Oct for each affected zone', () => {
  const out = at('2026-10-30T20:00:00Z');
  assert.deepEqual(out.map((a) => a.zone_id).sort(), ['aibd', 'diamniadio', 'rufisque']);
  assert.ok(out.every((a) => a.kind === 'notice_eve' && a.trigger === 'official'));
});

test('eve alert is not sent twice', () => {
  const sent = new Set(at('2026-10-30T20:00:00Z').map((a) => a.key));
  assert.equal(at('2026-10-30T20:10:00Z', sent).length, 0);
});

test('"soon" alert one hour before the 07:00 restrictions', () => {
  const out = at('2026-10-31T06:05:00Z');
  assert.ok(out.length >= 3);
  assert.ok(out.every((a) => a.kind === 'notice_soon' && a.key.includes(':07:00:')));
});

test('"soon" alert before the 15:00 RN1 heavy-vehicle ban', () => {
  const out = at('2026-10-31T14:10:00Z');
  assert.deepEqual(out.map((a) => a.zone_id).sort(), ['diamniadio', 'rufisque']);
});

test('no decree alert during quiet hours or on other days', () => {
  assert.equal(at('2026-10-31T23:30:00Z').length, 0);
  assert.equal(at('2026-11-02T06:05:00Z').length, 0);
});

test('decree segments have resolved geometry', () => {
  const segs = notices.flatMap((n) => n.segments || []);
  assert.ok(segs.length >= 7);
  for (const s of segs) assert.ok(s.point || s.path?.length > 1, s.id);
});
