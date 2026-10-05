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
