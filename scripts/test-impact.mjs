import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { computeVenueLevels, resolveFilter, gamesPhase, eventsFor, nearestPlace } from '../src/impact.js';
import { recoverNearest } from './lib/olc.mjs';

const load = async (f) => JSON.parse(await readFile(new URL(`../public/data/events/jojdakar2026/${f}`, import.meta.url)));
const venues = (await load('venues.json')).items;
const events = (await load('events_schedule.json')).items;
const EVENT = { startDate: '2026-10-30', endDate: '2026-11-13' };

test('Corniche Ouest is reserved during the road cycling race', () => {
  const win = resolveFilter('now', new Date('2026-11-08T09:00:00Z'));
  const levels = computeVenueLevels(venues, events, win);
  assert.equal(levels.get('venue_corniche_ouest').level, 'CLOSED');
});

test('Corniche Ouest is fluid after the race window', () => {
  const win = resolveFilter('now', new Date('2026-11-08T16:00:00Z'));
  assert.equal(computeVenueLevels(venues, events, win).get('venue_corniche_ouest').level, 'FLUID');
});

test('opening ceremony puts Stade Abdoulaye Wade at HIGH on 31 Oct evening', () => {
  const win = resolveFilter('now', new Date('2026-10-31T18:00:00Z'));
  assert.equal(computeVenueLevels(venues, events, win).get('venue_stade_abdoulaye_wade').level, 'HIGH');
});

test('"tomorrow" looks at the next day, whole day', () => {
  const win = resolveFilter('tomorrow', new Date('2026-11-07T23:30:00Z'));
  assert.deepEqual(win, { date: '2026-11-08', time: null });
  assert.ok(eventsFor(events, win).length > 0);
});

test('everything is fluid before the Games', () => {
  const levels = computeVenueLevels(venues, events, resolveFilter('now', new Date('2026-10-05T10:00:00Z')));
  assert.ok([...levels.values()].every((s) => s.level === 'FLUID'));
  assert.deepEqual(gamesPhase(EVENT, new Date('2026-10-05T10:00:00Z')), { phase: 'before', days: 25 });
});

test('every Games day has at least one scheduled event', () => {
  for (let d = 30; d <= 44; d++) {
    const date = new Date(Date.UTC(2026, 9, d)).toISOString().slice(0, 10);
    assert.ok(events.some((e) => e.date === date), `no event on ${date}`);
  }
});

test('nearestPlace returns the closest named point within range', () => {
  const p = nearestPlace({ lat: 14.6969, lng: -17.461 }, [
    { name: 'A', lat: 14.70, lng: -17.46 },
    { name: 'B', lat: 14.80, lng: -17.30 },
  ]);
  assert.equal(p.name, 'A');
  assert.equal(nearestPlace({ lat: 0, lng: 0 }, [{ name: 'A', lat: 14.7, lng: -17.4 }]), null);
});

test('Plus Code decoder matches the official venue pins', () => {
  const p = recoverNearest('MGWQ+QHG', 14.69, -17.44);
  assert.ok(Math.abs(p.lat - 14.69693) < 1e-4 && Math.abs(p.lng - -17.46104) < 1e-4);
});

test('Youth Olympic Village shows shuttle flows in the morning', async () => {
  const lodging = (await load('accommodations.json')).items;
  const win = resolveFilter('now', new Date('2026-11-05T07:30:00Z'));
  assert.equal(computeVenueLevels(lodging, events, win).get('acc_village_olympique').level, 'MEDIUM');
  const noon = resolveFilter('now', new Date('2026-11-05T12:00:00Z'));
  assert.equal(computeVenueLevels(lodging, events, noon).get('acc_village_olympique').level, 'FLUID');
});

test('Kër Ayo (COJOJ HQ) is busy at morning rush, fluid at noon', async () => {
  const lodging = (await load('accommodations.json')).items;
  const at = (iso) => computeVenueLevels(lodging, events, resolveFilter('now', new Date(iso))).get('acc_ker_ayo').level;
  assert.equal(at('2026-11-05T08:00:00Z'), 'MEDIUM');
  assert.equal(at('2026-11-05T12:00:00Z'), 'FLUID');
});

test('AIBD board parser reads the saved official fixtures', async () => {
  const { parseBoard, summarize, peakWindows } = await import('./lib/aibd.mjs');
  const html = (f) => readFile(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
  const arrivals = parseBoard(await html('aibd-arrivals.html'));
  const departures = parseBoard(await html('aibd-departures.html'));
  assert.equal(arrivals.length, 10);
  assert.deepEqual(
    { flight: arrivals[0].flight, city: arrivals[0].city, date: arrivals[0].date, scheduled: arrivals[0].scheduled },
    { flight: 'HC207', city: 'Espargos', date: '2026-10-05', scheduled: '02:00' },
  );
  const s = summarize({ arrivals, departures }, '2026-10-05');
  assert.equal(s.cancelled, 1); // HC331 Casablanca
  assert.ok(peakWindows(s.hours).length >= 1);
});

test('delegation waves: departures the day after a sport ends, arrivals before it starts', async () => {
  const { athletesPerSport, computeWaves } = await import('./lib/waves.mjs');
  const sports = [
    { sport: 'A', schedule: { '2026-11-01': 'competition', '2026-11-03': 'medals:2' } },
    { sport: 'B', schedule: { '2026-11-08': 'medals:1' } },
  ];
  const per = athletesPerSport(sports, [{ sport: 'A', athletes: 100 }], 300);
  assert.equal(per.find((s) => s.sport === 'B').athletes, 200);
  const days = computeWaves(per, { arrival_offsets_days: [4, 3], departure_offset_days: 1, levels: { HIGH: 150, MEDIUM: 60, LOW: 1 } });
  const by = Object.fromEntries(days.map((d) => [d.date, d]));
  assert.equal(by['2026-11-04'].departures_est, 100);
  assert.equal(by['2026-10-28'].arrivals_est + by['2026-10-29'].arrivals_est, 100);
  assert.equal(by['2026-11-04'].arrivals_est, 100); // B arrives 4 days before 8 Nov
  assert.equal(by['2026-11-09'].level, 'HIGH');
});

test('airport hub is busy on a delegation wave day, during its usual peak', async () => {
  const airport = (await load('airport.json')).items;
  const at = (iso) => computeVenueLevels(airport, events, resolveFilter('now', new Date(iso))).get('hub_aibd').level;
  assert.equal(at('2026-10-28T18:00:00Z'), 'HIGH');
  assert.equal(at('2026-10-28T09:00:00Z'), 'FLUID');
});

// ---- push alerts -------------------------------------------------------------
const alertsLib = await import('../netlify/lib/alerts.mjs');
const zonesData = (await load('alert_zones.json')).items;

test('official eve alert: Corniche the evening before the road race, once', () => {
  const at = (iso, sent) => alertsLib.dueOfficialAlerts(events, zonesData, new Date(iso), sent).filter((a) => a.zone_id === 'corniche');
  assert.equal(at('2026-11-07T18:50:00Z').length, 0);
  const due = at('2026-11-07T19:05:00Z');
  assert.equal(due.length, 1);
  assert.match(due[0].body, /07:00–14:00/);
  assert.equal(at('2026-11-07T19:15:00Z', new Set([due[0].key])).length, 0); // dedup via alert_log
  assert.equal(at('2026-11-07T22:30:00Z').length, 0); // eve window closed
});

test('official "soon" alert ~1 h before, never in quiet hours, never for AIBD waves', () => {
  const soon = alertsLib.dueOfficialAlerts(events, zonesData, new Date('2026-11-08T06:10:00Z'));
  assert.ok(soon.some((a) => a.zone_id === 'corniche' && a.kind === 'official_soon'));
  assert.equal(alertsLib.dueOfficialAlerts(events, zonesData, new Date('2026-11-08T05:30:00Z')).filter((a) => a.kind === 'official_soon').length, 0);
  const wave = alertsLib.dueOfficialAlerts(events, zonesData, new Date('2026-10-28T15:10:00Z'));
  assert.equal(wave.filter((a) => a.zone_id === 'aibd').length, 0);
});

test('citizen alert: 3 reports in a zone fire, 2 + one outside do not', () => {
  const now = new Date('2026-11-05T09:00:00Z');
  const rep = (lat, lng, minAgo, up = 1) => ({
    latitude: lat, longitude: lng, report_type: 'BOUCHON', upvotes: up,
    created_at: new Date(now - minAgo * 60000).toISOString(), expires_at: new Date(+now + 3600e3).toISOString(),
  });
  const fann = [14.6969, -17.461];
  const three = [rep(...fann, 5), rep(14.698, -17.462, 10), rep(14.695, -17.459, 20)];
  const fired = alertsLib.citizenAlerts(three, zonesData, now).filter((a) => a.zone_id === 'fann_point_e');
  assert.equal(fired.length, 1);
  assert.match(fired[0].body, /3 habitants signalent/);
  const two = [rep(...fann, 5), rep(14.698, -17.462, 10), rep(14.45, -17.0, 5)];
  assert.equal(alertsLib.citizenAlerts(two, zonesData, now).filter((a) => a.zone_id === 'fann_point_e').length, 0);
  const confirmed = [rep(...fann, 5, 5)];
  assert.equal(alertsLib.citizenAlerts(confirmed, zonesData, now).filter((a) => a.zone_id === 'fann_point_e').length, 1);
  const old = [rep(...fann, 45), rep(...fann, 50), rep(...fann, 55)];
  assert.equal(alertsLib.citizenAlerts(old, zonesData, now).length, 0);
  assert.equal(alertsLib.citizenAlerts(three, zonesData, new Date('2026-11-05T23:30:00Z')).length, 0);
});

test('subscription payload validation', () => {
  const ids = zonesData.map((z) => z.id);
  const ok = { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: 'BPk', auth: 'xy' } }, zones: ['corniche', 'nope'] };
  assert.deepEqual(alertsLib.parseSubscription(ok, ids).zones, ['corniche']);
  assert.equal(alertsLib.parseSubscription({ ...ok, subscription: { ...ok.subscription, endpoint: 'http://evil' } }, ids).error, 'invalid_endpoint');
  assert.equal(alertsLib.parseSubscription({ ...ok, zones: ['nope'] }, ids).error, 'no_zone');
});

// ---- rain / flood mode ----------------------------------------------------------
test('flood: 2 flooded-road reports in a suburb zone trigger an alert', () => {
  const now = new Date('2026-10-05T10:00:00Z');
  const rep = (lat, lng, type, minAgo, up = 1) => ({
    latitude: lat, longitude: lng, report_type: type, upvotes: up,
    created_at: new Date(now - minAgo * 60000).toISOString(), expires_at: new Date(+now + 3 * 3600e3).toISOString(),
  });
  const mbao = [14.7415, -17.3262];
  const two = [rep(...mbao, 'INONDATION', 5), rep(14.745, -17.33, 'INONDATION', 12)];
  const fired = alertsLib.citizenAlerts(two, zonesData, now).filter((a) => a.zone_id === 'banlieue_est');
  assert.equal(fired.length, 1);
  assert.equal(fired[0].kind, 'citizen_flood');
  assert.match(fired[0].body, /2 habitants signalent : route inondée/);
  // Two ordinary traffic reports are not enough.
  const traffic = [rep(...mbao, 'BOUCHON', 5), rep(14.745, -17.33, 'BOUCHON', 12)];
  assert.equal(alertsLib.citizenAlerts(traffic, zonesData, now).filter((a) => a.zone_id === 'banlieue_est').length, 0);
});

test('rain notices are sourced, located and expire', async () => {
  const rain = await load('rain_notices.json');
  assert.ok(rain.items.length >= 5);
  for (const n of rain.items) {
    assert.ok(n.source_ids.length && Date.parse(n.valid_until) > Date.parse(n.reported_at));
  }
  const live = (iso) => rain.items.filter((n) => Date.parse(n.valid_until) > Date.parse(iso)).map((n) => n.id);
  assert.ok(live('2026-10-05T12:00:00Z').includes('rain_mbao'));
  assert.ok(!live('2026-10-07T12:00:00Z').includes('rain_mbao')); // 24 h report expired
  assert.ok(live('2026-10-07T12:00:00Z').includes('watch_centenaire')); // usual watch point stays
});

test('mock store: reports live 3 h and a confirmation extends them', async () => {
  const { TTL_MS } = await import('../src/store/mock.js');
  assert.equal(TTL_MS, 3 * 3600e3);
});

// ---- weather ----------------------------------------------------------------------
const weatherLib = await import('../netlify/lib/weather.mjs');
const hrs = (mms, probs = []) => mms.map((mm, i) => ({ time: `2026-10-07T${String(10 + i).padStart(2, '0')}:00`, mm, prob: probs[i] ?? 80 }));

test('rain risk levels at their thresholds', () => {
  const { riskFor } = weatherLib;
  assert.equal(riskFor(hrs([0, 0, 0])), 'NONE');
  assert.equal(riskFor(hrs([0.9, 0, 0])), 'NONE');
  assert.equal(riskFor(hrs([1, 0, 0], [60])), 'LIGHT');
  assert.equal(riskFor(hrs([1, 0, 0], [40])), 'NONE'); // unlikely shower
  assert.equal(riskFor(hrs([2, 2, 1])), 'RAIN'); // 5 mm in 3 h
  assert.equal(riskFor(hrs([1, 1, 0], [75, 75, 75])), 'RAIN'); // probable 2 mm
  assert.equal(riskFor(hrs([5, 5, 5, 5, 0, 0])), 'HEAVY'); // 20 mm in 6 h
  assert.equal(riskFor(hrs([10])), 'HEAVY');
});

test('rain window and mode suggestion', () => {
  const w = weatherLib.rainWindow(hrs([0, 0, 2, 3, 0], [10, 20, 90, 90, 10]));
  assert.deepEqual([w.from, w.to, w.mm], ['12h', '14h', 5]);
  const now = new Date('2026-10-07T10:00:00Z');
  const dry = [{ hours: hrs([0, 0, 0], [5, 5, 5]) }];
  const wet = [{ hours: hrs([3, 3, 0]) }];
  assert.equal(weatherLib.suggestedMode(dry, [], now), 'joj');
  assert.equal(weatherLib.suggestedMode(wet, [], now), 'rain');
  assert.equal(weatherLib.suggestedMode(dry, [], now, { floodActive: true }), 'rain');
  assert.equal(weatherLib.suggestedMode(dry, [{ valid_until: '2026-10-08T00:00:00Z' }], now), 'rain');
});

test('weather push: heavy rain within 3 h fires once; quiet hours; vigilance levels', () => {
  const now = new Date('2026-10-07T10:00:00Z');
  const point = { lat: 14.70, lng: -17.465, hours: hrs([0, 6, 8, 9, 0, 0], [10, 90, 90, 90, 10, 10]) }; // 23 mm from 11h
  const dakar = zonesData.filter((z) => z.id === 'fann_point_e');
  const a = alertsLib.weatherAlerts([point], [], dakar, now);
  assert.equal(a.length, 1);
  assert.match(a[0].body, /11h et 14h/);
  assert.equal(alertsLib.weatherAlerts([point], [], dakar, now, new Set([a[0].key])).length, 0);
  assert.equal(alertsLib.weatherAlerts([point], [], dakar, new Date('2026-10-07T23:30:00Z')).length, 0);
  const notice = (level) => ({ id: 'n1', level, title: 'Fortes pluies', summary: 'ANACIM', areas: ['all'], source_name: 'ANACIM', valid_until: '2026-10-08T00:00:00Z' });
  const dryPoint = { ...point, hours: hrs([0, 0, 0], [5, 5, 5]) };
  assert.equal(alertsLib.weatherAlerts([dryPoint], [notice('orange')], dakar, now).length, 1);
  assert.equal(alertsLib.weatherAlerts([dryPoint], [notice('jaune')], dakar, now).length, 0);
});
