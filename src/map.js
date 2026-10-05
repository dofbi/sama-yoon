import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { icons, venueGlyph } from './icons.js';
import { LEVEL_COLORS } from './impact.js';
import { fr } from './i18n/fr.js';
import { ACTIVE_EVENT } from './config/event.js';

const divIcon = (html, size, cls = '') =>
  L.divIcon({ html, className: `sy-icon ${cls}`, iconSize: size, iconAnchor: [size[0] / 2, size[1] / 2], popupAnchor: [0, -size[1] / 2] });

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Compact popups on phones: scroll inside instead of covering the map.
L.Popup.prototype.options.maxHeight = 300;
L.Popup.prototype.options.maxWidth = 280;
L.Popup.prototype.options.autoPanPaddingTopLeft = L.point(10, 60);

export function createMap(el) {
  const { center, zoom, minZoom } = ACTIVE_EVENT.map;
  const map = L.map(el, { zoomControl: false, minZoom, maxZoom: 18, attributionControl: true }).setView(center, zoom);
  // Zoom sits top-right under "Me localiser": bottom-right is the share FAB.
  L.control.zoom({ position: 'topright' }).addTo(map);
  // Map overlays (legend, city jumps, banner) sit above Leaflet panes; hide
  // them while a popup is open so it stays readable.
  map.on('popupopen', () => document.documentElement.classList.add('popup-open'));
  map.on('popupclose', () => document.documentElement.classList.remove('popup-open'));
  map.on('popupopen', (e) => {
    e.popup.getElement()?.querySelector('[data-open-airport]')?.addEventListener('click', () => {
      map.closePopup();
      el.dispatchEvent(new CustomEvent('open-airport', { bubbles: true }));
    });
  });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    crossOrigin: true,
  }).addTo(map);

  const layers = {
    zones: L.layerGroup().addTo(map),
    venues: L.layerGroup().addTo(map),
    lodging: L.layerGroup().addTo(map),
    traffic: L.layerGroup().addTo(map),
    spots: L.layerGroup().addTo(map),
    transit: L.layerGroup(),
    landmarks: L.layerGroup(),
    rain: L.layerGroup().addTo(map),
    reports: L.layerGroup().addTo(map),
    me: L.layerGroup().addTo(map),
  };
  // Keep the map readable: secondary layers appear when zoomed in.
  const syncZoomLayers = () => {
    const z = map.getZoom();
    z >= 13 ? layers.landmarks.addTo(map) : layers.landmarks.remove();
    z >= 12 ? layers.transit.addTo(map) : layers.transit.remove();
    // BRT platforms are dense: show them from street level only.
    map.getContainer().classList.toggle('hide-brt', z < 14);
  };
  map.on('zoomend', syncZoomLayers);
  syncZoomLayers();

  return { map, layers };
}

function venuePopup(v, state) {
  const lvl = fr.levels[state.level];
  const evs = state.events
    .map((e) => `<li><b>${esc(e.start_time)}–${esc(e.end_time === '23:59' ? '00:00' : e.end_time)}</b> · ${esc(e.description)}${e.schedule_verified ? '' : ` <em>(${fr.impact.toConfirm})</em>`}</li>`)
    .join('');
  return `
    <div class="min-w-52 max-w-64">
      <p class="font-display text-lg leading-tight text-indigo">${esc(v.name)}</p>
      <p class="text-xs text-terre">${esc(v.neighborhood)}</p>
      <p class="my-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold text-white" style="background:${LEVEL_COLORS[state.level]}">${esc(lvl.label)}</p>
      ${evs ? `<ul class="mb-2 list-none space-y-1 p-0 text-[13px]">${evs}</ul>` : `<p class="mb-2 text-[13px]">${fr.impact.noEvent}</p>`}
      <p class="text-[12px]"><b>${fr.impact.sports} :</b> ${esc(v.sports.join(', '))}</p>
      ${v.context ? `<p class="mt-1 text-[12px]"><b>${fr.impact.tip} :</b> ${esc(v.context)}</p>` : ''}
      ${v.transitTip ? `<p class="mt-1 text-[12px]">🚆 ${esc(v.transitTip)}</p>` : ''}
      <p class="mt-2 text-[11px] text-terre">${fr.impact.estimate}.${v.coordinates_note ? ` ${esc(v.coordinates_note)}` : ''}${v.path_note ? ` ${esc(v.path_note)}` : ''}</p>
    </div>`;
}

export function renderVenues({ layers }, venues, levels) {
  layers.zones.clearLayers();
  layers.venues.clearLayers();
  layers.traffic.clearLayers();
  for (const v of venues) {
    const state = levels.get(v.id);
    const color = LEVEL_COLORS[state.level];
    const closed = state.level === 'CLOSED';
    const popup = venuePopup(v, state);
    if (v.impact_type === 'corridor' && v.path?.length) {
      // "Piste" style: wide earth underlay + dashed coloured track.
      L.polyline(v.path, { color: '#8B4A2B', weight: 14, opacity: 0.35, lineCap: 'round' }).addTo(layers.zones);
      L.polyline(v.path, { color, weight: 6, opacity: 0.95, dashArray: closed ? '2 10' : '14 8', lineCap: 'round' })
        .bindPopup(popup)
        .addTo(layers.zones);
    } else {
      L.circle([v.coordinates.lat, v.coordinates.lng], {
        radius: v.impact_radius_meters,
        color,
        weight: 2.5,
        dashArray: closed ? '4 6' : null,
        fillColor: color,
        fillOpacity: state.level === 'FLUID' ? 0.08 : 0.22,
      })
        .bindPopup(popup)
        .addTo(layers.zones);
    }
    L.marker([v.coordinates.lat, v.coordinates.lng], {
      icon: divIcon(icons.medallion('#1F2F5C', venueGlyph[v.code] || '★', { size: 38 }), [38, 38]),
      title: v.name,
      riseOnHover: true,
    })
      .bindPopup(popup)
      .addTo(layers.venues);
    // Car rapide queue: 1 = modéré, 2 = prioritaire, 3 = accès réservé.
    const queue = { MEDIUM: 1, HIGH: 2, CLOSED: 3 }[state.level];
    if (queue) {
      const html = `<div class="sy-traffic">${Array.from({ length: queue }, () => icons.carRapide({ size: 26 })).join('')}</div>`;
      const w = 26 + (queue - 1) * 16;
      L.marker([v.coordinates.lat, v.coordinates.lng], {
        icon: L.divIcon({ html, className: 'sy-icon', iconSize: [w, 26], iconAnchor: [w / 2, -14] }),
        interactive: false,
        keyboard: false,
      }).addTo(layers.traffic);
    }
  }
}

export function renderAccommodations({ layers }, items, levels, onOpen = null) {
  layers.lodging.clearLayers();
  for (const a of items) {
    const state = levels.get(a.id) || { level: 'FLUID', events: [] };
    const color = LEVEL_COLORS[state.level];
    const isVillage = a.kind === 'village';
    const kindLabel = { village: fr.accommodation.village, hotel_cluster: fr.accommodation.hotels, hq: fr.accommodation.hq, airport: fr.accommodation.airport }[a.kind] || '';
    const flows = state.events
      .map((e) => `<li><b>${esc(e.start_time)}–${esc(e.end_time)}</b> · ${esc(e.description)}</li>`)
      .join('');
    const popup = `
      <div class="min-w-52 max-w-64">
        <p class="font-display text-lg leading-tight text-indigo">${esc(a.name)}</p>
        <p class="text-xs text-terre">${esc(a.neighborhood)} · ${esc(kindLabel)}</p>
        ${a.impact_radius_meters ? `<p class="my-2 inline-flex rounded-full px-2 py-0.5 text-xs font-bold text-white" style="background:${color}">${esc(fr.levels[state.level].label)}</p>` : ''}
        ${a.impact_radius_meters ? (flows ? `<p class="text-[12px] font-bold">${isVillage ? fr.accommodation.flows : fr.accommodation.flowsHq}</p><ul class="mb-2 list-none space-y-1 p-0 text-[13px]">${flows}</ul>` : `<p class="mb-2 text-[13px]">${fr.accommodation.noFlow}</p>`) : ''}
        <ul class="list-disc space-y-0.5 pl-4 text-[12px]">${a.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        ${a.flows_note ? `<p class="mt-2 text-[11px] text-terre">${esc(a.flows_note)}</p>` : ''}
        ${a.kind === 'airport' ? `<button data-open-airport class="mt-2 rounded-full bg-indigo px-3 py-1.5 text-xs font-bold text-sable">${fr.airport.open}</button>` : ''}
      </div>`;
    if (a.path?.length) {
      L.polyline(a.path, { color: '#8B4A2B', weight: 12, opacity: 0.3, lineCap: 'round' }).addTo(layers.lodging);
      L.polyline(a.path, { color, weight: 5, opacity: 0.9, dashArray: '12 8', lineCap: 'round' }).bindPopup(popup).addTo(layers.lodging);
    }
    if (a.impact_radius_meters) {
      L.circle([a.coordinates.lat, a.coordinates.lng], {
        radius: a.impact_radius_meters,
        color,
        weight: 2,
        dashArray: '6 6',
        fillColor: color,
        fillOpacity: state.level === 'FLUID' ? 0.06 : 0.18,
      })
        .bindPopup(popup)
        .addTo(layers.lodging);
    }
    const big = a.kind !== 'hotel_cluster';
    const ic = { village: icons.village, hq: icons.lion, airport: icons.plane }[a.kind]?.({ size: 36 }) || icons.hotel({ size: 28 });
    const size = big ? [36, 36] : [28, 28];
    L.marker([a.coordinates.lat, a.coordinates.lng], { icon: divIcon(ic, size), title: a.name, riseOnHover: true })
      .bindPopup(popup)
      .addTo(layers.lodging);
  }
}

export function renderSpots({ layers }, spots, onGo) {
  layers.spots.clearLayers();
  for (const s of spots) {
    const m = L.marker([s.latitude, s.longitude], { icon: divIcon(icons.baobab({ size: 30 }), [30, 30]), title: s.name });
    const el = document.createElement('div');
    el.innerHTML = `<p class="font-display text-lg leading-tight text-baobab">${esc(s.name)}</p>
      <p class="text-xs text-terre">${s.category === 'PLAGE_CALME' ? 'Plage' : 'Parc / jardin'} · ${fr.levels.FLUID.label}</p>
      ${s.description ? `<p class="mt-1 text-[13px]">${esc(s.description)}</p>` : ''}
      <button class="mt-2 rounded-full bg-indigo px-3 py-1.5 text-xs font-bold text-sable">${fr.cta.go}</button>`;
    el.querySelector('button').addEventListener('click', () => onGo(s));
    m.bindPopup(el).addTo(layers.spots);
  }
}

export function renderTransit({ layers }, stations) {
  layers.transit.clearLayers();
  for (const s of stations) {
    const ic = s.mode === 'TER' ? icons.train({ size: 24 }) : icons.bus({ size: 24 });
    const size = [24, 24];
    L.marker([s.latitude, s.longitude], { icon: divIcon(ic, size, s.mode === 'BRT' ? 'sy-brt' : ''), title: `${s.mode} ${s.name}` })
      .bindPopup(`<p class="font-bold text-indigo">${s.mode} · ${esc(s.name)}</p>`)
      .addTo(layers.transit);
  }
}

export function renderLandmarks({ layers }, landmarks) {
  layers.landmarks.clearLayers();
  for (const l of landmarks) {
    const ic = (icons[l.icon] || icons.compass)({ size: 34 });
    L.marker([l.latitude, l.longitude], { icon: divIcon(ic, [34, 34], 'sy-landmark'), title: l.name, keyboard: false })
      .bindTooltip(esc(l.name), { direction: 'top', offset: [0, -14] })
      .addTo(layers.landmarks);
  }
}

export function renderReports({ layers }, reports, onUpvote) {
  layers.reports.clearLayers();
  for (const r of reports) {
    const t = fr.report.types[r.report_type];
    if (!t) continue;
    const flood = r.report_type === 'INONDATION';
    const size = (r.upvotes >= 5 ? 36 : 30) + (flood ? 6 : 0);
    const html = flood
      ? `<div class="sy-flood pulse-soft">${icons.flood({ size })}</div>`
      : `<div class="sy-report" style="width:${size}px;height:${size}px">${icons[t.icon]({ size: size - 8 })}</div>`;
    const el = document.createElement('div');
    const mins = Math.round((Date.now() - new Date(r.created_at)) / 60000);
    el.innerHTML = `<p class="font-bold text-ink">${esc(t.label)}${r.description ? ` — ${esc(r.description)}` : ''}</p>
      <p class="text-xs text-terre">${fr.feed.citizen} · ${fr.feed.ago(mins)} · ${fr.feed.confirmations(r.upvotes)}</p>
      <button class="mt-2 rounded-full border-2 border-baobab px-3 py-1 text-xs font-bold text-baobab">${fr.feed.confirm(r.upvotes)}</button>`;
    el.querySelector('button').addEventListener('click', () => onUpvote(r));
    L.marker([r.latitude, r.longitude], { icon: divIcon(html, [size, size]), title: t.label, zIndexOffset: 500 })
      .bindPopup(el)
      .addTo(layers.reports);
  }
}

export function renderRainNotices({ layers }, notices, now = new Date()) {
  layers.rain.clearLayers();
  for (const n of notices) {
    if (Date.parse(n.valid_until) < now.getTime()) continue;
    const color = n.kind === 'watch' ? '#5B9BD5' : '#1F2F5C';
    const kind = { flooded: fr.feed.rainFlooded, transit: fr.feed.rainTransit, watch: fr.feed.rainWatch }[n.kind];
    L.marker([n.coordinates.lat, n.coordinates.lng], { icon: divIcon(icons.drop({ size: 28 }, color), [28, 28]), title: n.title, zIndexOffset: 300 })
      .bindPopup(
        `<p class="font-bold text-indigo">${esc(n.title)}</p>
         <p class="text-xs font-semibold text-terre">${esc(kind)}</p>
         <p class="mt-1 text-[13px]">${esc(n.summary)}</p>
         <p class="mt-1 text-[11px] text-terre">${esc(n.source_label || '')}</p>`,
      )
      .addTo(layers.rain);
  }
}

export function showMe({ map, layers }, lat, lng, accuracy) {
  layers.me.clearLayers();
  L.circle([lat, lng], { radius: Math.min(accuracy || 30, 300), color: '#1F6FA0', weight: 1, fillOpacity: 0.12 }).addTo(layers.me);
  L.circleMarker([lat, lng], { radius: 8, color: '#F2E3C6', weight: 3, fillColor: '#1F6FA0', fillOpacity: 1 }).addTo(layers.me);
  map.setView([lat, lng], Math.max(map.getZoom(), 15));
}
