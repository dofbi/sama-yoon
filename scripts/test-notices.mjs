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

test('decree 393: eve alert on 28 Oct for Médina and Point E (measures from 29 Oct)', () => {
  const ids = at('2026-10-28T20:00:00Z').map((a) => a.zone_id).sort();
  assert.deepEqual(ids, ['fann_point_e', 'medina']);
});

test('decree 001943: eve alert on 25 Oct for Saly (main road closed from 26 Oct)', () => {
  assert.deepEqual(at('2026-10-25T20:00:00Z').map((a) => a.zone_id), ['saly']);
});

test('Corniche: an eve alert before each dated closure, not only the first day', () => {
  const nov2 = at('2026-11-02T20:00:00Z').map((a) => a.zone_id).sort();
  assert.deepEqual(nov2, ['corniche', 'fann_point_e', 'ouakam']);
  const nov3 = at('2026-11-03T20:00:00Z');
  assert.deepEqual(nov3.map((a) => a.zone_id).sort(), ['corniche', 'fann_point_e', 'ouakam', 'saly']);
  // The body names the night closure with its dates.
  assert.match(nov3.find((a) => a.zone_id === 'corniche').body, /4 nov\..*22:00 → .*5 nov\..*06:00/);
});

test('Corniche: "soon" alert before the 22:00 night closure', () => {
  // At 21:00 the eve alert for 4 Nov is also due (sent from 19:00 in practice).
  const out = at('2026-11-03T21:00:00Z').filter((a) => a.kind === 'notice_soon');
  assert.deepEqual(out.map((a) => a.zone_id).sort(), ['corniche', 'fann_point_e', 'ouakam']);
  assert.ok(out.every((a) => a.kind === 'notice_soon' && a.key.includes(':22:00:')));
});

test('dated windows: no eve alert on days with nothing starting', () => {
  assert.equal(at('2026-11-07T20:00:00Z').filter((a) => a.zone_id === 'corniche').length, 1); // 8 Nov
  assert.equal(at('2026-11-10T20:00:00Z').length, 0);
});

test('every decree window sits inside its notice period', () => {
  for (const n of notices) for (const w of n.windows || []) if (w.from) {
    assert.ok(w.from >= n.starts_at && w.to <= n.ends_at, `${n.id} ${w.from}`);
  }
});
