import './style.css';
import { fr } from './i18n/fr.js';
import { icons } from './icons.js';
import { ACTIVE_EVENT, dataUrl } from './config/event.js';
import {
  LEVEL_COLORS,
  computeVenueLevels,
  distanceMeters,
  eventsFor,
  gamesDays,
  gamesPhase,
  nearestPlace,
  resolveFilter,
} from './impact.js';
import { createStore } from './store/index.js';
import { directionsLink, mapShareText, reportShareTextFor, whatsappLink } from './share.js';
import * as mapMod from './map.js';
import { WAVE_COLORS, wavesChartSvg, rainChartSvg } from './chart.js';
import { outlook, suggestedMode } from '../netlify/lib/weather.mjs';
import * as alerts from './alerts.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const t = (path) => path.split('.').reduce((o, k) => o?.[k], fr);

const fmtDate = (iso, opts = { day: 'numeric', month: 'long' }) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Dakar', ...opts }).format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso));
const fmtDateTime = (iso) => fmtDate(iso, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const storage = {
  get(k, d) {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* private mode */
    }
  },
};

// ?now=2026-11-08T09:00 lets testers and partners preview any moment of the Games.
const nowOverride = new URLSearchParams(location.search).get('now');
const clock = () => (nowOverride ? new Date(`${nowOverride.replace(/Z$/, '')}Z`) : new Date());

const state = {
  mode: ACTIVE_EVENT.defaultMode || 'joj',
  weather: null,
  weatherNotices: [],
  filter: 'now',
  pickedDate: null,
  data: null,
  reports: [],
  myPos: null,
};

// ---------------------------------------------------------------------------
// Static chrome
// ---------------------------------------------------------------------------
function paintStatic() {
  $$('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  $$('[data-icon]').forEach((el) => (el.innerHTML = icons[el.dataset.icon]({ size: 26 })));
  $('#logo').innerHTML = icons.compass({ size: 40 });
  $('#btn-menu').innerHTML = icons.menu({ size: 24 });
  $('#btn-menu').setAttribute('aria-label', fr.cta.menu);
  $('#btn-locate').innerHTML = icons.locate({ size: 22 });
  $$('.dlg-close').forEach((b) => (b.innerHTML = icons.close({ size: 22 })));
  $$('[data-filter]').forEach((b) => (b.textContent = fr.filters[b.dataset.filter]));

  fillDayPicker(gamesDays(ACTIVE_EVENT));

  $('#legend').innerHTML = ['FLUID', 'MEDIUM', 'HIGH']
    .map((l) => `<span class="flex items-center gap-1"><span class="inline-block size-2.5 rounded-full" style="background:${LEVEL_COLORS[l]}"></span>${fr.levels[l].short}</span>`)
    .join('');
  $('#btn-share-map').innerHTML = icons.share({ size: 30 });

  if (storage.get('samayoon.standardMode', false)) document.documentElement.classList.add('standard-mode');
}

// Days offered in the picker: the Games period until data loads, then every
// day that has something scheduled (delegation arrivals start before the
// opening, departures end after the closing).
function fillDayPicker(days) {
  const select = $('#day-select');
  const current = select.value;
  select.innerHTML =
    `<option value="">${fr.filters.pickDay}</option>` +
    days
      .map((d) => {
        const extra = d < ACTIVE_EVENT.startDate || d > ACTIVE_EVENT.endDate ? ` · ${fr.filters.outsideGames}` : '';
        return `<option value="${d}">${fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' })}${extra}</option>`;
      })
      .join('');
  select.value = current;
}

function toast(msg, { ms = 3500, html = false } = {}) {
  const el = document.createElement('div');
  el.className = 'toast pointer-events-auto max-w-md rounded-2xl border-2 border-terre bg-sable px-4 py-3 text-sm font-semibold text-ink shadow-lg';
  el[html ? 'innerHTML' : 'textContent'] = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

function setupDialogs() {
  $$('dialog').forEach((d) => {
    d.addEventListener('click', (e) => e.target === d && d.close());
    $$('.dlg-close', d).forEach((b) => b.addEventListener('click', () => d.close()));
  });
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
async function loadData() {
  const files = ['venues', 'events_schedule', 'quiet_spots', 'transit', 'traffic_notices', 'landmarks', 'accommodations', 'airport', 'delegation_waves', 'alert_zones', 'rain_notices'];
  const res = await Promise.all(files.map((f) => fetch(dataUrl(`${f}.json`)).then((r) => r.json())));
  const [venues, events, spots, transit, notices, landmarks, lodgingRaw, airport, waves, alertZones, rain] = res;
  // Human-readable source line for each rain notice ("Senego · 05/10 09:28").
  const srcById = Object.fromEntries(rain.meta.sources.map((x) => [x.id, x]));
  for (const n of rain.items) {
    const pub = n.source_ids.map((id) => srcById[id]).find((x) => x?.publisher && x.publisher !== 'OpenStreetMap');
    // Midnight UTC = publication time unknown: show the date only.
    const when = n.reported_at.endsWith('T00:00:00Z') ? fmtDate(n.reported_at.slice(0, 10), { day: '2-digit', month: '2-digit', year: 'numeric' }) : fmtDateTime(n.reported_at);
    n.source_label = fr.feed.rainSource(pub?.publisher || 'presse', when);
    n.source_url = pub?.url || null;
  }
  // Village, HQ, hotel hub and airport share the "operational sites" layer.
  const lodging = { ...lodgingRaw, items: [...lodgingRaw.items, ...airport.items] };
  // Attach transit tips to the venues they serve.
  for (const line of Object.values(transit.lines)) {
    for (const v of venues.items) if (line.serves_venues?.includes(v.code)) v.transitTip = line.tip;
  }
  const places = [
    ...venues.items.map((v) => ({ name: v.neighborhood.split(' / ')[0], lat: v.coordinates.lat, lng: v.coordinates.lng })),
    ...transit.items.map((s) => ({ name: s.name, lat: s.latitude, lng: s.longitude })),
    ...spots.items.map((s) => ({ name: s.name, lat: s.latitude, lng: s.longitude })),
    ...landmarks.items.map((l) => ({ name: l.name, lat: l.latitude, lng: l.longitude })),
    ...lodging.items.map((a) => ({ name: a.name, lat: a.coordinates.lat, lng: a.coordinates.lng })),
  ];
  return { venues, events, spots, transit, notices, landmarks, lodging, airport, waves, alertZones, rain, places };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
let mapApi = null;

function currentWindow() {
  return resolveFilter(state.filter, clock(), state.pickedDate);
}

function renderBanner() {
  const banner = $('#banner');
  const p = gamesPhase(ACTIVE_EVENT, clock());
  const msgs = [];
  if (!navigator.onLine) msgs.push(fr.offline);

  const stale = state.data && Date.now() - new Date(state.data.events.meta.last_checked_at) > ACTIVE_EVENT.staleAfterHours * 3600e3 && p.phase === 'during';
  if (stale) msgs.push(fr.data.stale);
  banner.classList.toggle('hidden', !msgs.length);
  banner.innerHTML = msgs.map(esc).join(' · ');
}

// Top bar: rain/flood mode (default during the rainy season) or JOJ countdown.
function renderTopbar() {
  const rain = state.mode === 'rain';
  $$('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
  const text = $('#topbar-text');
  const action = $('#topbar-action');
  if (rain) {
    const w = state.weather && weatherHere()?.window;
    text.textContent = w ? fr.topbar.rainWindow(w.from, w.to) : fr.topbar.rain;
    action.textContent = fr.topbar.report;
    action.onclick = () => openReport('INONDATION');
  } else {
    const p = gamesPhase(ACTIVE_EVENT, clock());
    text.textContent = p.phase === 'before' ? fr.topbar.countdown(p.days) : p.phase === 'during' ? fr.topbar.during : fr.topbar.after;
    action.textContent = p.phase === 'before' ? fr.impact.seeDay(fmtDate(ACTIVE_EVENT.highlightDate)) : fr.filters.today;
    action.onclick = () => (p.phase === 'before' ? setFilter('day', ACTIVE_EVENT.highlightDate) : setFilter('today'));
  }
  $('#btn-share-map').href = whatsappLink(mapShareText(state.mode));
}

function collapseTopbar() {
  const root = document.documentElement;
  if (root.classList.contains('topbar-seen')) return;
  root.classList.add('topbar-seen');
  storage.set('samayoon.topbarSeen', true);
  setTimeout(() => mapApi?.map.invalidateSize(), 400);
}

function showTopbar() {
  document.documentElement.classList.remove('topbar-seen');
  setTimeout(() => mapApi?.map.invalidateSize(), 400);
}

// A manual choice wins over the automatic (weather-driven) mode for 24 h.
const MANUAL_MODE_MS = 24 * 3600e3;
function manualMode() {
  const c = storage.get('samayoon.modeChoice', null);
  return c && Date.now() - c.at < MANUAL_MODE_MS && (c.mode === 'rain' || c.mode === 'joj') ? c.mode : null;
}

function setMode(mode) {
  state.mode = mode;
  storage.set('samayoon.modeChoice', { mode, at: Date.now() });
  renderTopbar();
  render();
}

function render() {
  const { data } = state;
  if (!data) return;
  const win = currentWindow();
  $$('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === state.filter)));
  $('[data-filter-wrap="day"]').dataset.active = String(state.filter === 'day');
  $('#day-select').value = state.filter === 'day' ? state.pickedDate : '';
  const levels = computeVenueLevels([...data.venues.items, ...data.lodging.items], data.events.items, win);
  if (mapApi) {
    mapMod.renderVenues(mapApi, data.venues.items, levels);
    mapMod.renderAccommodations(mapApi, data.lodging.items, levels);
  }
  renderBanner();
  renderFeed(win);
}

function placeName(lat, lng) {
  return nearestPlace({ lat, lng }, state.data.places)?.name || null;
}

function renderFeed(win) {
  const { data } = state;
  const list = $('#feed-list');
  const items = [];
  for (const r of state.reports) {
    const type = fr.report.types[r.report_type];
    if (!type) continue;
    const mins = Math.max(0, Math.round((Date.now() - new Date(r.created_at)) / 60000));
    const place = r.description || placeName(r.latitude, r.longitude);
    items.push(`
      <li class="flex items-start gap-3 py-2">
        <span class="mt-0.5 shrink-0">${icons[type.icon]({ size: 26 })}</span>
        <div class="min-w-0 flex-1">
          <p class="font-semibold">${esc(type.label)}${place ? ` — ${esc(place)}` : ''}</p>
          <p class="text-xs text-terre">${fr.feed.citizen} · ${fr.feed.ago(mins)}</p>
        </div>
        <button data-upvote="${esc(r.id)}" class="shrink-0 rounded-full border-2 border-baobab px-2 py-1 text-xs font-bold text-baobab">${fr.feed.confirm(r.upvotes)}</button>
      </li>`);
  }
  if (state.mode === 'rain') {
    const now = Date.now();
    const live = data.rain.items.filter((n) => Date.parse(n.valid_until) > now).sort((a, b) => ({ flooded: 0, transit: 1, watch: 2 })[a.kind] - ({ flooded: 0, transit: 1, watch: 2 })[b.kind]);
    if (live.length) {
      items.push(`<li class="pt-3 pb-1"><h3 class="font-display text-lg text-indigo">${fr.feed.rainTitle}</h3><p class="text-xs text-terre">${esc(data.rain.advice?.text || '')}</p></li>`);
      for (const n of live) {
        const kind = { flooded: fr.feed.rainFlooded, transit: fr.feed.rainTransit, watch: fr.feed.rainWatch }[n.kind];
        items.push(`
          <li class="flex items-start gap-3 py-2">
            <span class="mt-0.5 shrink-0">${icons.drop({ size: 24 }, n.kind === 'watch' ? '#5B9BD5' : '#1F2F5C')}</span>
            <div class="min-w-0 flex-1">
              <p class="font-semibold">${esc(n.title)} <span class="ml-1 rounded bg-indigo/10 px-1.5 text-[11px] font-bold text-indigo">${esc(kind)}</span></p>
              <p class="text-xs">${esc(n.summary)}</p>
              <p class="text-[11px] text-terre">${n.source_url ? `<a class="underline" href="${esc(n.source_url)}" target="_blank" rel="noopener">${esc(n.source_label)}</a>` : esc(n.source_label)}</p>
            </div>
          </li>`);
      }
    }
  }
  const venueName = Object.fromEntries([...data.venues.items, ...data.lodging.items].map((v) => [v.id, v.name]));
  for (const e of eventsFor(data.events.items, win).sort((a, b) => a.start_time.localeCompare(b.start_time))) {
    items.push(`
      <li class="flex items-start gap-3 py-2">
        <span class="mt-1.5 inline-block size-3 shrink-0 rounded-full" style="background:${LEVEL_COLORS[e.impact_level]}"></span>
        <div class="min-w-0 flex-1">
          <p class="font-semibold">${esc(e.start_time)} — ${esc(venueName[e.venue_id])} · ${esc(fr.levels[e.impact_level].short)}</p>
          <p class="text-xs text-terre">${esc(e.description)}${e.schedule_verified ? '' : ` (${fr.impact.toConfirm})`}</p>
        </div>
      </li>`);
  }
  const day = win.date;
  const wave = data.waves.items.find((w) => w.date === day && w.level !== 'FLUID');
  if (wave) {
    items.unshift(`
      <li class="flex items-start gap-3 py-2">
        <span class="mt-0.5 shrink-0">${icons.plane({ size: 24 })}</span>
        <div class="min-w-0 flex-1">
          <p class="font-semibold">${esc(fr.airport.feedLine(fr.levels[wave.level].short))}</p>
          <p class="text-xs text-terre">${esc(fr.airport.dayReadout(fmtDate(day), wave.arrivals_est, wave.departures_est))} · ${fr.impact.estimate}</p>
        </div>
        <button data-open-airport class="shrink-0 rounded-full border-2 border-indigo px-2 py-1 text-xs font-bold text-indigo">✈️</button>
      </li>`);
  }
  for (const n of data.notices.items) {
    if (n.starts_at.slice(0, 10) > day || n.ends_at.slice(0, 10) < day) continue;
    items.push(`
      <li class="flex items-start gap-3 py-2">
        <span class="mt-0.5 shrink-0">${icons.barrier({ size: 22 })}</span>
        <div class="min-w-0 flex-1">
          <p class="font-semibold">${fr.feed.notice} — ${esc(n.title)}</p>
          <p class="text-xs text-terre">${n.status === 'awaiting_official' ? `${fr.data.awaiting}. ` : ''}${esc(n.summary)}</p>
        </div>
      </li>`);
  }
  if (!state.reports.length) items.unshift(`<li class="py-2 text-xs italic text-terre">${fr.feed.empty}</li>`);
  else items.unshift(`<li class="pb-1 text-[11px] text-terre">${fr.feed.expiresHint}</li>`);
  const here = state.weather && weatherHere();
  const notice = activeNotices()[0];
  if (notice || (here && ['RAIN', 'HEAVY'].includes(here.risk) && here.window)) {
    const line = notice
      ? `${notice.level === 'rouge' ? '🔴' : notice.level === 'orange' ? '🟠' : '🟡'} ${fr.weather.vigilance(notice.level)} — ${notice.title}`
      : here.risk === 'HEAVY'
        ? fr.weather.feedHeavy(here.zone.name, here.window.from, here.window.to)
        : fr.weather.feedLine(here.zone.name, here.window.from, here.window.to, here.window.prob);
    items.unshift(`<li class="py-2"><button data-open-weather class="w-full rounded-xl bg-indigo-2/10 px-3 py-2 text-left text-sm font-semibold text-indigo">${esc(line)} ›</button></li>`);
  }
  list.innerHTML = items.join('');
  $('#feed-count').textContent = String(state.reports.length + eventsFor(data.events.items, win).length);

  const m = data.events.meta;
  const official = m.sources.filter((s) => s.official && s.fetched_at);
  const checked = official.reduce((min, s) => (!min || s.fetched_at < min ? s.fetched_at : min), null);
  const programme = official.find((s) => s.source_published_at)?.source_published_at;
  $('#data-freshness').innerHTML = `${programme ? `${esc(fr.data.programme(fmtDate(programme, { day: 'numeric', month: 'long', year: 'numeric' })))} · ` : ''}${esc(fr.data.updated(fmtDateTime(m.generated_at)))}, ${esc(fr.data.checked(fmtDateTime(checked || m.last_checked_at)))} · ${esc(fr.data.version(m.dataset_version))} · <button id="open-sources" class="underline">${fr.data.sources}</button>${state.store?.mode === 'mock' ? ` · ${fr.backendMock}` : ''}`;
  $('#open-sources').addEventListener('click', () => openMenu(true));
}

function setFilter(filter, pickedDate = null) {
  state.filter = filter;
  state.pickedDate = pickedDate;
  storage.set('samayoon.filter', filter === 'day' ? { filter, pickedDate } : { filter });
  render();
}

// ---------------------------------------------------------------------------
// Geolocation
// ---------------------------------------------------------------------------
function locate({ timeout = 8000, center = false } = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        state.myPos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
        if (center && mapApi) mapMod.showMe(mapApi, state.myPos.lat, state.myPos.lng, state.myPos.accuracy);
        resolve(state.myPos);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    );
  });
}

// ---------------------------------------------------------------------------
// Citizen report (3 taps max: open → choose type → sent)
// ---------------------------------------------------------------------------
function contributions() {
  return storage.get('samayoon.contributions', 0);
}
function renderBadge() {
  const n = contributions();
  const b = $('#badge');
  b.classList.toggle('hidden', n === 0);
  b.textContent = n >= 3 ? `🏅 ${n}` : String(n);
  b.title = n >= 3 ? fr.gamification.badge : fr.gamification.counter(n);
}

function openReport(focusType = null) {
  const dlg = $('#dlg-report');
  const landmark = $('#report-landmark');
  landmark.value = '';
  landmark.placeholder = fr.report.landmarkPlaceholder;
  $('#report-landmark-wrap').classList.remove('hidden');
  const geo = $('#report-geo');
  const types = $('#report-types');
  const result = $('#report-result');
  result.classList.add('hidden');
  types.classList.remove('hidden');
  geo.innerHTML = `<span class="pulse">${fr.report.locating}</span>`;
  let pos = null;
  const locating = locate().then((p) => {
    pos = p;
    geo.textContent = p ? `📍 ${fr.report.located}` : `📍 ${fr.report.fallback}`;
    return p;
  });
  types.innerHTML = Object.entries(fr.report.types)
    .map(
      ([key, tdef]) => `
      <button data-type="${key}" class="btn-seal w-full justify-start border-2 ${key === 'INONDATION' ? 'border-indigo-2 bg-indigo-2/10' : 'border-terre bg-sable'} py-3 text-left text-base text-ink">
        <span class="shrink-0">${icons[tdef.icon]({ size: 34 })}</span>${esc(tdef.label)}
      </button>`,
    )
    .join('');
  $$('[data-type]', types).forEach((b) =>
    b.addEventListener('click', async () => {
      const wait = state.store.cooldownRemainingMs();
      if (wait > 0) return toast(fr.report.tooSoon(Math.ceil(wait / 60000)));
      $$('[data-type]', types).forEach((x) => (x.disabled = true));
      // Use GPS if it answered within 3 s, else the map centre.
      await Promise.race([locating, new Promise((r) => setTimeout(r, 3000))]);
      const c = pos || mapApi.map.getCenter();
      const where = landmark.value.trim().replace(/\s+/g, ' ').slice(0, 120);
      const report = { latitude: +c.lat.toFixed(6), longitude: +c.lng.toFixed(6), report_type: b.dataset.type, ...(where ? { description: where } : {}) };
      try {
        const res = await state.store.create(report);
        const n = contributions() + 1;
        storage.set('samayoon.contributions', n);
        renderBadge();
        if (n === 3) toast(fr.gamification.badgeUnlocked, { ms: 5000 });
        showReportResult(res.report || report, res.queued);
      } catch (e) {
        console.error(e);
        toast(e?.message === 'rate_limited' ? fr.report.tooSoon(2) : fr.report.error);
        $$('[data-type]', types).forEach((x) => (x.disabled = false));
      }
    }),
  );
  dlg.showModal();
  if (focusType) $(`[data-type="${focusType}"]`, types)?.focus();
}

function showReportResult(report, queued) {
  const place = placeName(report.latitude, report.longitude);
  const text = reportShareTextFor(report, place);
  $('#report-types').classList.add('hidden');
  $('#report-landmark-wrap').classList.add('hidden');
  const result = $('#report-result');
  result.classList.remove('hidden');
  result.innerHTML = `
    <p class="mb-4 text-base font-semibold text-baobab">${queued ? fr.report.queued : fr.report.sent}</p>
    <a href="${whatsappLink(text)}" target="_blank" rel="noopener" class="btn-seal w-full bg-whatsapp text-white">${icons.share({ size: 26 })}${fr.report.shareAfter}</a>
    <p class="mt-3 text-center text-xs text-terre">${fr.gamification.counter(contributions())}${contributions() >= 3 ? ` · 🏅 ${fr.gamification.badge}` : ''}</p>`;
  maybeIosInstall();
}

// ---------------------------------------------------------------------------
// Weather: forecast (Open-Meteo via Netlify), ANACIM vigilance, auto mode
// ---------------------------------------------------------------------------
async function loadWeather() {
  try {
    const r = await fetch('/.netlify/functions/weather');
    const j = await r.json();
    state.weather = r.ok && j.zones ? j : null;
  } catch {
    state.weather = null;
  }
  try {
    state.weatherNotices = (await state.store.listWeatherNotices()) || [];
  } catch {
    state.weatherNotices = [];
  }
}

// Forecast point nearest to the user (or the map centre).
function weatherHere(zoneId = null) {
  const zones = state.weather?.zones || [];
  if (!zones.length) return null;
  const ref = state.myPos || (mapApi ? mapApi.map.getCenter() : { lat: ACTIVE_EVENT.map.center[0], lng: ACTIVE_EVENT.map.center[1] });
  const z = (zoneId && zones.find((x) => x.id === zoneId)) || zones.reduce((a, b) => (distanceMeters(ref, a) <= distanceMeters(ref, b) ? a : b));
  return { zone: z, ...outlook(z.hours, clock(), 12) };
}

const activeNotices = () => state.weatherNotices.filter((n) => Date.parse(n.valid_until) > Date.now());

function floodActive() {
  const now = Date.now();
  return (
    (state.data?.rain.items || []).some((n) => n.kind !== 'watch' && Date.parse(n.valid_until) > now) ||
    state.reports.some((r) => r.report_type === 'INONDATION' && Date.parse(r.expires_at) > now)
  );
}

function applyAutoMode() {
  if (manualMode()) return;
  const mode = state.weather || state.weatherNotices.length ? suggestedMode(state.weather?.zones || [], activeNotices(), clock(), { floodActive: floodActive() }) : floodActive() ? 'rain' : ACTIVE_EVENT.defaultMode || 'joj';
  if (mode !== state.mode) {
    state.mode = mode;
    renderTopbar();
    render();
  }
}

function paintWeatherChip() {
  const btn = $('#btn-weather');
  const here = weatherHere();
  const notice = activeNotices()[0];
  if (!here && !notice) return btn.classList.add('hidden');
  const dot = notice ? (notice.level === 'rouge' ? '🔴 ' : notice.level === 'orange' ? '🟠 ' : '🟡 ') : '';
  btn.textContent = dot + (here?.window ? fr.weather.chipWindow(here.window.from, here.window.to, here.window.prob) : fr.weather.chipDry);
  btn.setAttribute('aria-label', `${fr.weather.title} : ${here ? fr.weather.risk[here.risk] : ''}`);
  btn.classList.toggle('border-prioritaire', here?.risk === 'HEAVY' || notice?.level === 'rouge');
  btn.classList.remove('hidden');
}

function openWeather(zoneId = null) {
  const here = weatherHere(zoneId);
  const body = $('#weather-body');
  const notices = activeNotices();
  const noticesHtml = notices
    .map(
      (n) => `<article class="mb-3 rounded-2xl border-2 ${n.level === 'rouge' ? 'border-prioritaire' : n.level === 'orange' ? 'border-modere' : 'border-ocre'} bg-white/50 p-3">
        <p class="font-bold">${n.level === 'rouge' ? '🔴' : n.level === 'orange' ? '🟠' : '🟡'} ${esc(fr.weather.vigilance(n.level))} — ${esc(n.title)}</p>
        <p class="mt-1 text-[13px]">${esc(n.summary)}</p>
        <p class="mt-1 text-[11px] text-terre">${n.source_url ? `<a class="underline" href="${esc(n.source_url)}" target="_blank" rel="noopener">${esc(n.source_name)}</a>` : esc(n.source_name)} · ${esc(fr.weather.validUntil(fmtDateTime(n.valid_until)))}</p>
      </article>`,
    )
    .join('');
  if (!here) {
    body.innerHTML = `${noticesHtml}<p class="text-sm">${fr.weather.unavailable}</p><p class="mt-3 text-[11px] text-terre">${fr.weather.attribution}</p>`;
    return $('#dlg-weather').showModal();
  }
  const zones = state.weather.zones;
  const next24 = outlook(here.zone.hours, clock(), 24).hours;
  const spots = (state.data?.rain.items || []).filter((n) => n.kind === 'watch' && distanceMeters(here.zone, n.coordinates) < 8000);
  const icon = (code, mm) => (mm >= 10 ? '⛈️' : mm >= 1 ? '🌧️' : code >= 51 ? '🌦️' : code >= 2 ? '⛅' : '☀️');
  body.innerHTML = `
    ${noticesHtml}
    <label class="mb-3 flex items-center gap-2 text-sm font-semibold">${fr.weather.zone}
      <select id="weather-zone" class="rounded-xl border-2 border-terre/50 bg-white/70 px-2 py-1.5">${zones.map((z) => `<option value="${esc(z.id)}" ${z.id === here.zone.id ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}</select>
    </label>
    <section class="mb-3 rounded-2xl border-2 border-indigo-2/40 bg-white/40 p-3">
      <p class="text-xs font-semibold text-terre">${fr.weather.next12}</p>
      <p class="text-lg font-bold text-indigo">${esc(fr.weather.risk[here.risk])}</p>
      ${here.window ? `<p class="text-[13px]">${esc(fr.weather.windowLine(here.window.from, here.window.to, here.window.mm, here.window.prob))}</p>` : ''}
    </section>
    <section class="mb-3">
      <h3 class="text-sm font-bold text-terre">${fr.weather.chart}</h3>
      <div id="rain-chart">${rainChartSvg(next24, { label: fr.weather.chartLabel })}</div>
      <p id="rain-readout" class="min-h-5 text-[13px] font-semibold" aria-live="polite"></p>
      <details class="text-[12px]"><summary class="cursor-pointer text-indigo underline">${fr.weather.table}</summary>
        <table class="mt-1"><tbody>${next24.map((x) => `<tr><td class="pr-3">${x.time.slice(11, 16)}</td><td class="pr-3 text-right">${x.mm} mm</td><td class="text-right">${x.prob} %</td></tr>`).join('')}</tbody></table>
      </details>
    </section>
    <section class="mb-3">
      <h3 class="text-sm font-bold text-terre">${fr.weather.days}</h3>
      <div class="mt-1 grid grid-cols-3 gap-2">${here.zone.days
        .map((d) => `<div class="rounded-xl border-2 border-terre/30 bg-white/40 p-2 text-center"><p class="text-xs font-semibold">${fmtDate(d.date, { weekday: 'short', day: 'numeric' })}</p><p class="text-2xl">${icon(d.code, d.mm)}</p><p class="text-[11px]">${esc(fr.weather.day(d.mm, d.prob))}</p></div>`)
        .join('')}</div>
    </section>
    ${spots.length ? `<section class="mb-3"><h3 class="text-sm font-bold text-terre">${fr.weather.watchPoints}</h3><ul class="list-disc pl-5 text-[13px]">${spots.map((n) => `<li>${esc(n.title)}</li>`).join('')}</ul></section>` : ''}
    <p class="text-[11px] text-terre">${fr.weather.attribution} · ${esc(fmtDateTime(state.weather.fetched_at))}</p>`;
  $('#weather-zone').addEventListener('change', (e) => openWeather(e.target.value));
  const readout = $('#rain-readout');
  $$('[data-hour]', body).forEach((g) => {
    const x = next24[+g.dataset.hour];
    const show = () => (readout.textContent = fr.weather.readout(x.time.slice(11, 16), x.mm, x.prob));
    g.addEventListener('click', show);
    g.addEventListener('mouseenter', show);
    g.addEventListener('focus', show);
  });
  if (!$('#dlg-weather').open) $('#dlg-weather').showModal();
}

// ---------------------------------------------------------------------------
// Alternatives: TER/BRT + voies fluides & points relais
// ---------------------------------------------------------------------------
function openAlternatives() {
  const { data } = state;
  const ref = state.myPos || (mapApi ? mapApi.map.getCenter() : { lat: ACTIVE_EVENT.map.center[0], lng: ACTIVE_EVENT.map.center[1] });
  const nearest = (mode) =>
    data.transit.items
      .filter((s) => s.mode === mode)
      .map((s) => ({ ...s, d: distanceMeters(ref, { lat: s.latitude, lng: s.longitude }) }))
      .sort((a, b) => a.d - b.d)[0];
  const lines = Object.entries(data.transit.lines)
    .map(([mode, l]) => {
      const n = nearest(mode);
      return `
      <article class="mb-3 rounded-2xl border-2 border-indigo/30 bg-white/40 p-3">
        <div class="flex items-center gap-2">${mode === 'TER' ? icons.train({ size: 28 }) : icons.bus({ size: 28 })}
          <h4 class="font-bold text-indigo">${mode} · ${esc(l.operator)}</h4></div>
        <p class="mt-1 text-[13px]">${esc(l.summary)}</p>
        ${l.fares ? `<p class="mt-1 text-xs text-terre">${esc(l.fares)}</p>` : ''}
        ${l.tip ? `<p class="mt-1 text-[13px]">💡 ${esc(l.tip)}</p>` : ''}
        ${n ? `<p class="mt-2 text-[13px]"><b>${fr.alternatives.nearestStation} :</b> ${esc(n.name)} (${fr.alternatives.distance(n.d)}) — <a class="font-bold text-indigo underline" target="_blank" rel="noopener" href="${directionsLink(n.latitude, n.longitude)}">${fr.cta.go}</a></p>` : ''}
      </article>`;
    })
    .join('');
  const spots = data.spots.items
    .map((s) => ({ ...s, d: distanceMeters(ref, { lat: s.latitude, lng: s.longitude }) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 8)
    .map(
      (s) => `
      <li class="flex items-center gap-3 py-2">
        <span class="shrink-0">${icons.baobab({ size: 28 })}</span>
        <div class="min-w-0 flex-1"><p class="truncate font-semibold">${esc(s.name)}</p>
          <p class="text-xs text-terre">${s.category === 'PLAGE_CALME' ? 'Plage' : 'Parc / jardin'} · ${fr.alternatives.distance(s.d)}</p></div>
        <button data-fly="${s.latitude},${s.longitude}" class="rounded-full border-2 border-terre px-2 py-1 text-xs font-bold">🗺️</button>
        <a target="_blank" rel="noopener" href="${directionsLink(s.latitude, s.longitude)}" class="rounded-full bg-indigo px-3 py-1.5 text-xs font-bold text-sable">${fr.cta.go}</a>
      </li>`,
    )
    .join('');
  $('#alt-body').innerHTML = `
    <section class="mb-4">
      <h3 class="font-display text-xl text-terre">${fr.alternatives.transitTitle}</h3>
      <p class="mb-3 text-[13px]">${fr.alternatives.transitIntro}</p>
      ${lines}
    </section>
    <section>
      <h3 class="flex items-center gap-2 font-display text-xl text-terre">${icons.chest({ size: 26 })}${fr.alternatives.spotsTitle}</h3>
      <p class="text-[13px]">${fr.alternatives.spotsIntro}</p>
      <ul class="divide-y divide-terre/15 text-sm">${spots}</ul>
    </section>`;
  $$('[data-fly]', $('#alt-body')).forEach((b) =>
    b.addEventListener('click', () => {
      const [lat, lng] = b.dataset.fly.split(',').map(Number);
      $('#dlg-alt').close();
      mapApi?.map.setView([lat, lng], 16);
    }),
  );
  $('#dlg-alt').showModal();
}

// ---------------------------------------------------------------------------
// Airport (AIBD): live board + delegation waves
// ---------------------------------------------------------------------------
async function fetchAirportLive() {
  try {
    const r = await fetch('/.netlify/functions/aibd');
    const j = await r.json();
    return r.ok ? j : null;
  } catch {
    return null;
  }
}

async function openAirport() {
  const { data } = state;
  const ap = data.airport.items[0];
  const win = currentWindow();
  const days = data.waves.items;
  const selected = days.some((d) => d.date === win.date) ? win.date : null;
  const tips = ap.tips.map((tip) => `<li>${esc(tip)}</li>`).join('');
  const rows = days
    .map((d) => `<tr class="${d.date === selected ? 'font-bold' : ''}"><td class="py-0.5 pr-3">${fmtDate(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}</td><td class="pr-3 text-right">${d.arrivals_est}</td><td class="pr-3 text-right">${d.departures_est}</td><td>${esc(fr.levels[d.level].short)}</td></tr>`)
    .join('');
  const body = $('#airport-body');
  body.innerHTML = `
    <section class="mb-4 rounded-2xl border-2 border-indigo/30 bg-white/40 p-3" aria-live="polite">
      <h3 class="flex items-center gap-2 font-bold text-indigo">${icons.plane({ size: 24 })}${fr.airport.today}</h3>
      <div id="airport-live" class="mt-1 text-[13px]"><span class="pulse">${fr.airport.loading}</span></div>
    </section>
    <section class="mb-4">
      <h3 class="font-display text-xl text-terre">${fr.airport.wavesTitle}</h3>
      <div class="mt-1 flex gap-4 text-xs font-semibold">
        <span class="inline-flex items-center gap-1.5"><span class="inline-block size-3 rounded-sm" style="background:${WAVE_COLORS.arrivals}"></span>${fr.airport.arrivals}</span>
        <span class="inline-flex items-center gap-1.5"><span class="inline-block size-3 rounded-sm" style="background:${WAVE_COLORS.departures}"></span>${fr.airport.departures}</span>
      </div>
      <div id="waves-chart" class="mt-2">${wavesChartSvg(days, selected)}</div>
      <p id="waves-readout" class="min-h-5 text-[13px] font-semibold" aria-live="polite"></p>
      <details class="mt-1 text-[13px]"><summary class="cursor-pointer text-indigo underline">${fr.airport.tableToggle}</summary>
        <table class="mt-2 text-[12px]"><thead><tr class="text-left text-terre"><th class="pr-3">Jour</th><th class="pr-3">${fr.airport.arrivals}</th><th class="pr-3">${fr.airport.departures}</th><th>Niveau</th></tr></thead><tbody>${rows}</tbody></table>
      </details>
      <p class="mt-2 text-[11px] text-terre">${esc(ap.flows_note)}</p>
    </section>
    <section class="mb-4">
      <h3 class="font-display text-xl text-terre">${fr.airport.tips}</h3>
      <ul class="mt-1 list-disc space-y-1 pl-5 text-[13px]">${tips}</ul>
    </section>
    <section class="text-[12px]"><ul class="list-disc space-y-0.5 pl-5">${ap.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></section>`;
  const readout = $('#waves-readout');
  const show = (date) => {
    const d = days.find((x) => x.date === date);
    if (d) readout.textContent = fr.airport.dayReadout(fmtDate(d.date, { weekday: 'long', day: 'numeric', month: 'long' }), d.arrivals_est, d.departures_est);
  };
  if (selected) show(selected);
  $$('[data-day]', body).forEach((g) => {
    g.addEventListener('click', () => show(g.dataset.day));
    g.addEventListener('mouseenter', () => show(g.dataset.day));
    g.addEventListener('focus', () => show(g.dataset.day));
  });
  $('#dlg-airport').showModal();

  const live = await fetchAirportLive();
  const el = $('#airport-live');
  const b = ap.baseline;
  if (live && !live.error) {
    el.innerHTML = `<p class="font-semibold">${esc(fr.airport.live(live.arrivals, live.departures))}</p>
      ${live.next_peak_hour != null ? `<p>${esc(fr.airport.nextPeak(live.next_peak_hour))} · ${esc(fr.airport.issues(live.delayed, live.cancelled))}</p>` : ''}
      <p class="text-xs text-terre">${esc(fr.airport.liveSource(fmtDateTime(live.fetched_at)))} · <a class="underline" href="${esc(live.source_url)}" target="_blank" rel="noopener">dakaraeroport.com</a></p>`;
  } else {
    el.innerHTML = `<p>${esc(fr.airport.liveDown)}</p>
      <p class="font-semibold">${esc(fr.airport.live(b.arrivals, b.departures))} · ${esc(fr.airport.peak(b.peak_hour))}</p>
      <p class="text-xs text-terre">${esc(fr.airport.baseline(fmtDate(b.date)))}</p>`;
  }
}

// ---------------------------------------------------------------------------
// Menu: about, standard mode, install, data sources with dates
// ---------------------------------------------------------------------------
let installPrompt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIosSafari = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);
function paintInstall() {
  const show = !isStandalone() && (installPrompt || isIosSafari());
  $('#btn-install')?.classList.toggle('hidden', !show);
}
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  paintInstall();
});
addEventListener('appinstalled', () => {
  installPrompt = null;
  paintInstall();
});
async function installApp() {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    paintInstall();
  } else if (isIosSafari()) {
    $('#ios-steps').innerHTML = fr.install.iosSteps.map((x) => `<li>${esc(x)}</li>`).join('');
    $('#dlg-ios').showModal();
  }
}
// iOS has no install prompt: suggest it once, after a first contribution.
function maybeIosInstall() {
  if (!isIosSafari() || isStandalone() || storage.get('samayoon.iosHintShown', false)) return;
  storage.set('samayoon.iosHintShown', true);
  setTimeout(installApp, 1500);
}

// ---------------------------------------------------------------------------
// Push alerts: zones followed + triggers
// ---------------------------------------------------------------------------
async function paintBell() {
  const on = !!(await alerts.currentSubscription().catch(() => null)) && !!alerts.savedPrefs();
  $('#btn-alerts').textContent = on ? '🔔' : '🔕';
  $('#btn-alerts').classList.toggle('bg-ocre', on);
  return on;
}

async function openAlerts() {
  const body = $('#alerts-body');
  const support = alerts.support();
  const prefs = alerts.savedPrefs() || { zones: [], triggers: ['official', 'citizen', 'weather'] };
  const active = await paintBell();
  const zones = state.data?.alertZones.items || [];
  const notice = { denied: fr.alerts.denied, unsupported: fr.alerts.unsupported, ios_install: fr.alerts.ios, not_configured: fr.alerts.soon }[support];
  body.innerHTML = `
    <p class="mb-3 text-[13px]">${fr.alerts.intro}</p>
    ${notice ? `<p class="mb-3 rounded-xl bg-indigo px-3 py-2 text-sm font-semibold text-sable">${esc(notice)}</p>` : ''}
    ${alerts.isIos() && support === 'ok' && !alerts.isStandalone() ? `<p class="mb-3 text-xs text-terre">${esc(fr.alerts.ios)}</p>` : ''}
    <fieldset class="mb-3"><legend class="mb-1 font-bold text-terre">${fr.alerts.zones}</legend>
      <div class="grid grid-cols-2 gap-2">${zones
        .map((z) => `<label class="flex min-h-11 items-center gap-2 rounded-xl border-2 border-terre/40 px-3 text-sm font-semibold"><input type="checkbox" name="zone" value="${esc(z.id)}" class="size-5 accent-indigo" ${prefs.zones.includes(z.id) ? 'checked' : ''}/>${esc(z.name)}</label>`)
        .join('')}</div>
    </fieldset>
    <fieldset class="mb-4"><legend class="mb-1 font-bold text-terre">${fr.alerts.triggers}</legend>
      ${['official', 'citizen', 'weather']
        .map((t) => `<label class="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="trigger" value="${t}" class="size-5 accent-indigo" ${prefs.triggers.includes(t) ? 'checked' : ''}/>${fr.alerts[t]}</label>`)
        .join('')}
    </fieldset>
    <p id="alerts-status" class="mb-3 min-h-5 text-sm font-semibold text-baobab" role="status">${active ? fr.alerts.on : ''}</p>
    <div class="flex flex-col gap-2">
      <button id="alerts-save" class="btn-seal bg-ocre text-white" ${support === 'ok' ? '' : 'disabled'}>🔔 ${active ? fr.alerts.update : fr.alerts.enable}</button>
      ${active ? `<button id="alerts-off" class="btn-seal border-2 border-terre bg-sable text-terre">${fr.alerts.disable}</button>` : ''}
    </div>`;
  const status = $('#alerts-status');
  const values = (name) => $$(`input[name="${name}"]:checked`, body).map((i) => i.value);
  const saveBtn = $('#alerts-save');
  saveBtn.addEventListener('click', async () => {
    const chosen = values('zone');
    const triggers = values('trigger');
    if (!chosen.length || !triggers.length) return (status.textContent = fr.alerts.pickZone);
    saveBtn.disabled = true;
    try {
      await alerts.enable({ zones: chosen, triggers });
      await openAlerts(); // re-render: shows the "disable" action
      $('#alerts-status').textContent = active ? fr.alerts.saved : fr.alerts.on;
      return;
    } catch (err) {
      console.warn('alerts', err);
      status.textContent = err.message === 'denied' ? fr.alerts.denied : fr.alerts.error;
    }
    saveBtn.disabled = false;
  });
  $('#alerts-off')?.addEventListener('click', async () => {
    await alerts.disable();
    await paintBell();
    openAlerts();
    toast(fr.alerts.off);
  });
  if (!$('#dlg-alerts').open) $('#dlg-alerts').showModal();
}

function openMenu(focusSources = false) {
  const { data } = state;
  const all = new Map();
  for (const ds of [data.venues, data.events, data.transit, data.spots, data.notices, data.landmarks, data.lodging, data.airport, data.waves, data.rain]) for (const s of ds.meta.sources) all.set(s.id, s);
  const sources = [...all.values()]
    .sort((a, b) => b.official - a.official || (a.title || a.id).localeCompare(b.title || b.id))
    .map(
      (s) => `
      <li class="py-2">
        ${s.official ? '<span class="mr-1 rounded bg-indigo px-1.5 text-[10px] font-bold text-sable">OFFICIEL</span>' : ''}<a class="font-semibold text-indigo underline" href="${esc(s.url?.startsWith('https://overpass') ? 'https://www.openstreetmap.org' : s.url)}" target="_blank" rel="noopener">${esc(s.title || s.id)}</a>
        <p class="text-xs text-terre">
          ${s.publisher ? `${esc(s.publisher)} · ` : ''}${s.source_published_at ? `publié le ${fmtDate(s.source_published_at)} · ` : ''}${s.source_updated_at ? `mis à jour le ${fmtDateTime(s.source_updated_at)} · ` : ''}${s.source_revision ? `révision ${esc(s.source_revision)} · ` : ''}${s.fetched_at ? `collecté le ${fmtDateTime(s.fetched_at)}` : 'collecte manuelle'}
        </p>${s.note ? `<p class="text-xs">${esc(s.note)}</p>` : ''}
      </li>`,
    )
    .join('');
  const n = contributions();
  const std = document.documentElement.classList.contains('standard-mode');
  $('#menu-body').innerHTML = `
    <p class="font-display text-xl text-indigo">${fr.app.motto}</p>
    <section><h3 class="font-bold text-terre">${fr.menu.about}</h3><p class="mt-1">${fr.menu.aboutText}</p></section>
    <section class="rounded-2xl border-2 border-ocre/60 p-3"><p class="font-bold">${n >= 3 ? `🏅 ${fr.gamification.badge}` : '🧭'} ${fr.gamification.counter(n)}</p></section>
    <div class="flex items-center gap-2" role="group" aria-label="${fr.topbar.modeLabel}">
      <button data-menu-mode="rain" class="chip ${state.mode === 'rain' ? 'bg-indigo text-sable' : ''}">${fr.topbar.rainChip}</button>
      <button data-menu-mode="joj" class="chip ${state.mode === 'joj' ? 'bg-indigo text-sable' : ''}">${fr.topbar.jojChip}</button>
      <button id="menu-topbar" class="ml-auto text-xs font-semibold text-indigo underline">${fr.menu.showBanner}</button>
    </div>
    <label class="flex items-center justify-between gap-3 font-semibold">${fr.menu.standardMode}
      <input id="toggle-standard" type="checkbox" class="size-6 accent-indigo" ${std ? 'checked' : ''} /></label>
    ${!isStandalone() && (installPrompt || isIosSafari()) ? `<button id="menu-install" class="btn-seal bg-indigo text-sable">${fr.menu.install}</button>` : ''}
    <button id="menu-share" class="btn-seal bg-whatsapp text-white">${icons.share({ size: 24 })}${fr.cta.shareMap}</button>
    <section id="menu-sources"><h3 class="font-bold text-terre">${fr.data.sources}</h3>
      <p class="mt-1 text-xs">${fr.data.version(data.events.meta.dataset_version)} · ${fr.data.updated(fmtDateTime(data.events.meta.generated_at))}</p>
      <ul class="divide-y divide-terre/15">${sources}</ul></section>
    <p class="text-xs text-terre">${fr.menu.legal}</p>`;
  $('#toggle-standard').addEventListener('change', (e) => {
    document.documentElement.classList.toggle('standard-mode', e.target.checked);
    storage.set('samayoon.standardMode', e.target.checked);
  });
  $('#menu-install')?.addEventListener('click', installApp);
  $$('[data-menu-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      setMode(b.dataset.menuMode);
      $('#dlg-menu').close();
    }),
  );
  $('#menu-topbar').addEventListener('click', () => {
    $('#dlg-menu').close();
    showTopbar();
  });
  $('#menu-share').addEventListener('click', () => open(whatsappLink(mapShareText(state.mode)), '_blank', 'noopener'));
  $('#dlg-menu').showModal();
  if (focusSources) $('#menu-sources').scrollIntoView();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  paintStatic();
  setupDialogs();
  renderBadge();

  const saved = storage.get('samayoon.filter', null);
  if (saved?.filter) Object.assign(state, { filter: saved.filter, pickedDate: saved.pickedDate || null });

  $$('[data-filter]').forEach((b) => b.addEventListener('click', () => setFilter(b.dataset.filter)));
  $('#day-select').addEventListener('change', (e) => (e.target.value ? setFilter('day', e.target.value) : setFilter('now')));
  $('#feed-toggle').addEventListener('click', () => {
    const feed = $('#feed');
    const open = feed.dataset.expanded !== 'true';
    feed.dataset.expanded = String(open);
    feed.style.height = open ? '55dvh' : '';
    $('#feed-toggle').setAttribute('aria-expanded', String(open));
    $('#feed-chevron').textContent = open ? '▼' : '▲';
  });
  $('#feed-list').addEventListener('click', (e) => {
    const id = e.target.closest('[data-upvote]')?.dataset.upvote;
    if (id) upvote({ id });
    if (e.target.closest('[data-open-airport]')) openAirport();
    if (e.target.closest('[data-open-weather]')) openWeather();
  });
  $('#btn-menu').addEventListener('click', () => state.data && openMenu());
  state.mode = manualMode() || ACTIVE_EVENT.defaultMode || 'joj';
  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('#btn-install').addEventListener('click', installApp);
  $('#ios-later').addEventListener('click', () => $('#dlg-ios').close());
  renderTopbar();
  paintInstall();
  addEventListener('online', renderBanner);
  addEventListener('offline', renderBanner);

  // Start tiles immediately; data and store load in parallel.
  renderBanner();
  mapApi = mapMod.createMap($('#map'));
  const mod = mapMod;
  const [data, store] = await Promise.all([loadData(), createStore()]);
  Object.assign(state, { data, store });
  fillDayPicker([...new Set([...gamesDays(ACTIVE_EVENT), ...data.events.items.map((e) => e.date)])].sort());
  render();
  // Secondary layers after first paint to keep the main thread free.
  const idle = self.requestIdleCallback || ((cb) => setTimeout(cb, 200));
  idle(() => {
    mod.renderSpots(mapApi, data.spots.items, (s) => open(directionsLink(s.latitude, s.longitude), '_blank', 'noopener'));
    mod.renderTransit(mapApi, data.transit.items);
    mod.renderLandmarks(mapApi, data.landmarks.items);
  });
  mod.renderRainNotices(mapApi, data.rain.items);

  // "Aller à…": one compact button opening the list of areas.
  const zonesMenu = $('#zones');
  const zonesBtn = $('#btn-zones');
  const toggleZones = (open) => {
    zonesMenu.classList.toggle('hidden', !open);
    zonesMenu.classList.toggle('flex', open);
    zonesBtn.setAttribute('aria-expanded', String(open));
  };
  zonesMenu.innerHTML = ACTIVE_EVENT.zones
    .map((z, i) => `<button data-zone="${i}" class="rounded-xl px-3 py-2 text-left text-sm font-bold hover:bg-ocre/15">📍 ${esc(z.name)}</button>`)
    .join('');
  zonesBtn.addEventListener('click', () => toggleZones(zonesMenu.classList.contains('hidden')));
  zonesMenu.addEventListener('click', (e) => {
    const z = ACTIVE_EVENT.zones[e.target.closest('[data-zone]')?.dataset.zone];
    if (!z) return;
    toggleZones(false);
    mapApi.map.flyTo(z.center, z.zoom, { duration: 0.8 });
  });
  mapApi.map.on('click', () => toggleZones(false));

  // Info top bar: shown on first visit only, then collapses (15 s or first action).
  if (!document.documentElement.classList.contains('topbar-seen')) {
    const timer = setTimeout(collapseTopbar, 15000);
    const onFirstAction = () => {
      clearTimeout(timer);
      collapseTopbar();
    };
    mapApi.map.once('dragstart zoomstart', onFirstAction);
    $('#btn-report').addEventListener('click', onFirstAction, { once: true });
  }

  $('#map').addEventListener('open-airport', openAirport);
  $('#btn-alerts').addEventListener('click', openAlerts);
  paintBell();
  // Deep link from a notification: /?zone=<id>[&day=YYYY-MM-DD]
  const params = new URLSearchParams(location.search);
  const zone = data.alertZones.items.find((z) => z.id === params.get('zone'));
  if (zone) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(params.get('day') || '')) setFilter('day', params.get('day'));
    mapApi.map.flyTo([zone.center.lat, zone.center.lng], 14, { duration: 0.6 });
  }
  $('#btn-report').addEventListener('click', openReport);
  $('#btn-alt').addEventListener('click', openAlternatives);
  $('#btn-locate').addEventListener('click', async () => {
    if (!(await locate({ center: true }))) toast(fr.report.fallback);
  });

  const refreshReports = async () => {
    try {
      state.reports = await store.list();
    } catch (e) {
      console.warn('reports unavailable', e);
    }
    mod.renderReports(mapApi, state.reports, upvote);
    renderFeed(currentWindow());
  };
  store.subscribe(({ type, report }) => {
    state.reports = [report, ...state.reports.filter((r) => r.id !== report.id)].filter((r) => new Date(r.expires_at) > new Date());
    state.reports.sort((a, b) => b.created_at.localeCompare(a.created_at));
    mod.renderReports(mapApi, state.reports, upvote);
    renderFeed(currentWindow());
    if (type === 'insert') $('#feed-count').classList.add('pulse');
  });
  await refreshReports();
  $('#btn-weather').addEventListener('click', () => openWeather());
  const refreshWeather = async () => {
    await loadWeather();
    applyAutoMode();
    paintWeatherChip();
    renderTopbar();
    renderFeed(currentWindow());
  };
  refreshWeather();
  store.subscribeWeather(refreshWeather);
  setInterval(refreshWeather, 30 * 60000);
  // Re-evaluate "Maintenant" and expire reports every minute.
  setInterval(() => {
    render();
    refreshReports();
  }, 60000);
}

async function upvote(r) {
  try {
    await state.store.upvote(r.id);
    toast(fr.feed.thanksUpvote);
  } catch {
    toast(fr.report.error);
  }
}

boot().catch((e) => {
  console.error(e);
  toast(fr.report.error);
});
