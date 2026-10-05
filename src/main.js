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
import { directionsLink, reportShareText, shareMap, whatsappLink } from './share.js';
import * as mapMod from './map.js';
import { WAVE_COLORS, wavesChartSvg } from './chart.js';

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
  $('#btn-share-map').innerHTML = icons.share({ size: 30 });
  $('#btn-share-map').setAttribute('aria-label', fr.cta.shareMap);
  $('#btn-share-map').title = fr.cta.shareMap;
  $$('.dlg-close').forEach((b) => (b.innerHTML = icons.close({ size: 22 })));
  $$('[data-filter]').forEach((b) => (b.textContent = fr.filters[b.dataset.filter]));

  const select = $('#day-select');
  select.innerHTML =
    `<option value="">${fr.filters.pickDay}</option>` +
    gamesDays(ACTIVE_EVENT)
      .map((d) => `<option value="${d}">${fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' })}</option>`)
      .join('');

  $('#legend').innerHTML = ['FLUID', 'MEDIUM', 'HIGH']
    .map((l) => `<div class="flex items-center gap-1.5"><span class="inline-block size-3 rounded-full" style="background:${LEVEL_COLORS[l]}"></span>${fr.levels[l].short}</div>`)
    .join('');

  if (storage.get('samayoon.standardMode', false)) document.documentElement.classList.add('standard-mode');
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
  const files = ['venues', 'events_schedule', 'quiet_spots', 'transit', 'traffic_notices', 'landmarks', 'accommodations', 'airport', 'delegation_waves'];
  const res = await Promise.all(files.map((f) => fetch(dataUrl(`${f}.json`)).then((r) => r.json())));
  const [venues, events, spots, transit, notices, landmarks, lodgingRaw, airport, waves] = res;
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
  return { venues, events, spots, transit, notices, landmarks, lodging, airport, waves, places };
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
  if (p.phase === 'before' && state.filter !== 'day') msgs.push(fr.impact.beforeGames(p.days));
  if (p.phase === 'after') msgs.push(fr.impact.afterGames);
  const stale = state.data && Date.now() - new Date(state.data.events.meta.last_checked_at) > ACTIVE_EVENT.staleAfterHours * 3600e3 && p.phase === 'during';
  if (stale) msgs.push(fr.data.stale);
  banner.classList.toggle('hidden', !msgs.length);
  banner.innerHTML = msgs.map(esc).join(' · ');
  if (p.phase === 'before' && state.filter !== 'day') {
    const b = document.createElement('button');
    b.className = 'ml-2 underline decoration-ocre decoration-2 underline-offset-2';
    b.textContent = fr.impact.seeDay(fmtDate(ACTIVE_EVENT.highlightDate));
    b.addEventListener('click', () => setFilter('day', ACTIVE_EVENT.highlightDate));
    banner.append(b);
  }
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
    const place = placeName(r.latitude, r.longitude);
    items.push(`
      <li class="flex items-start gap-3 py-2">
        <span class="mt-0.5 shrink-0">${icons[type.icon]({ size: 24 })}</span>
        <div class="min-w-0 flex-1">
          <p class="font-semibold">${esc(new Date(r.created_at).toISOString().slice(11, 16))} — ${esc(type.label)}${place ? ` ${esc(fr.feed.near(place))}` : ''}</p>
          <p class="text-xs text-terre">${fr.feed.citizen} · ${fr.feed.ago(mins)} · ${fr.feed.confirmations(r.upvotes)}</p>
        </div>
        <button data-upvote="${esc(r.id)}" class="shrink-0 rounded-full border-2 border-baobab px-2 py-1 text-xs font-bold text-baobab" aria-label="${fr.cta.stillValid}">👍 ${r.upvotes}</button>
      </li>`);
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

function openReport() {
  const dlg = $('#dlg-report');
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
      <button data-type="${key}" class="btn-seal w-full justify-start border-2 border-terre bg-sable py-3 text-left text-base text-ink">
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
      const report = { latitude: +c.lat.toFixed(6), longitude: +c.lng.toFixed(6), report_type: b.dataset.type };
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
}

function showReportResult(report, queued) {
  const place = placeName(report.latitude, report.longitude);
  const text = reportShareText(report, place);
  $('#report-types').classList.add('hidden');
  const result = $('#report-result');
  result.classList.remove('hidden');
  result.innerHTML = `
    <p class="mb-4 text-base font-semibold text-baobab">${queued ? fr.report.queued : fr.report.sent}</p>
    <a href="${whatsappLink(text)}" target="_blank" rel="noopener" class="btn-seal w-full bg-whatsapp text-white">${icons.share({ size: 26 })}${fr.report.shareAfter}</a>
    <p class="mt-3 text-center text-xs text-terre">${fr.gamification.counter(contributions())}${contributions() >= 3 ? ` · 🏅 ${fr.gamification.badge}` : ''}</p>`;
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
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});

function openMenu(focusSources = false) {
  const { data } = state;
  const all = new Map();
  for (const ds of [data.venues, data.events, data.transit, data.spots, data.notices, data.landmarks, data.lodging, data.airport, data.waves]) for (const s of ds.meta.sources) all.set(s.id, s);
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
    <label class="flex items-center justify-between gap-3 font-semibold">${fr.menu.standardMode}
      <input id="toggle-standard" type="checkbox" class="size-6 accent-indigo" ${std ? 'checked' : ''} /></label>
    ${installPrompt ? `<button id="btn-install" class="btn-seal bg-indigo text-sable">${fr.menu.install}</button>` : ''}
    <button id="menu-share" class="btn-seal bg-whatsapp text-white">${icons.share({ size: 24 })}${fr.cta.shareMap}</button>
    <section id="menu-sources"><h3 class="font-bold text-terre">${fr.data.sources}</h3>
      <p class="mt-1 text-xs">${fr.data.version(data.events.meta.dataset_version)} · ${fr.data.updated(fmtDateTime(data.events.meta.generated_at))}</p>
      <ul class="divide-y divide-terre/15">${sources}</ul></section>
    <p class="text-xs text-terre">${fr.menu.legal}</p>`;
  $('#toggle-standard').addEventListener('change', (e) => {
    document.documentElement.classList.toggle('standard-mode', e.target.checked);
    storage.set('samayoon.standardMode', e.target.checked);
  });
  $('#btn-install')?.addEventListener('click', async () => {
    await installPrompt.prompt();
    installPrompt = null;
  });
  $('#menu-share').addEventListener('click', shareMap);
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
  });
  $('#btn-menu').addEventListener('click', () => state.data && openMenu());
  $('#btn-share-map').addEventListener('click', shareMap);
  addEventListener('online', renderBanner);
  addEventListener('offline', renderBanner);

  // Start tiles immediately; data and store load in parallel.
  renderBanner();
  mapApi = mapMod.createMap($('#map'));
  const mod = mapMod;
  const [data, store] = await Promise.all([loadData(), createStore()]);
  Object.assign(state, { data, store });
  render();
  // Secondary layers after first paint to keep the main thread free.
  const idle = self.requestIdleCallback || ((cb) => setTimeout(cb, 200));
  idle(() => {
    mod.renderSpots(mapApi, data.spots.items, (s) => open(directionsLink(s.latitude, s.longitude), '_blank', 'noopener'));
    mod.renderTransit(mapApi, data.transit.items);
    mod.renderLandmarks(mapApi, data.landmarks.items);
  });

  $('#zones').innerHTML = ACTIVE_EVENT.zones
    .map((z, i) => `<button data-zone="${i}" class="rounded-full border-2 border-terre bg-sable/95 px-2.5 py-1 text-xs font-bold shadow-md">📍 ${esc(z.name)}</button>`)
    .join('');
  $('#zones').addEventListener('click', (e) => {
    const z = ACTIVE_EVENT.zones[e.target.closest('[data-zone]')?.dataset.zone];
    if (z) mapApi.map.flyTo(z.center, z.zoom, { duration: 0.8 });
  });

  $('#map').addEventListener('open-airport', openAirport);
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
