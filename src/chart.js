// Delegation waves: mirrored columns (arrivals above the baseline, departures
// below), one axis in athletes. Palette validated with the dataviz validator on
// the parchment surface (#F2E3C6): arrivals #2F55A4, departures #B5651D.
export const WAVE_COLORS = { arrivals: '#2F55A4', departures: '#B5651D' };

const W = 340;
const H = 180;
const PAD = { l: 34, r: 6, t: 14, b: 26 };

// Rounded data-end, square at the baseline.
function column(x, y0, h, w, up) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return up
    ? `M${x},${y0}V${y0 - h + r}Q${x},${y0 - h} ${x + r},${y0 - h}H${x + w - r}Q${x + w},${y0 - h} ${x + w},${y0 - h + r}V${y0}Z`
    : `M${x},${y0}V${y0 + h - r}Q${x},${y0 + h} ${x + r},${y0 + h}H${x + w - r}Q${x + w},${y0 + h} ${x + w},${y0 + h - r}V${y0}Z`;
}

const niceMax = (v) => {
  const steps = [100, 200, 250, 500, 1000];
  return steps.find((s) => s >= v) || Math.ceil(v / 500) * 500;
};

export function wavesChartSvg(days, selectedDate, { label = (d) => d.slice(8, 10) } = {}) {
  const max = niceMax(Math.max(...days.map((d) => Math.max(d.arrivals_est, d.departures_est)), 1));
  const plotH = H - PAD.t - PAD.b;
  const half = plotH / 2;
  const base = PAD.t + half;
  const band = (W - PAD.l - PAD.r) / days.length;
  const bw = Math.min(14, band - 2);
  const scale = (v) => (v / max) * (half - 2);
  const grid = [max, max / 2, 0, -max / 2, -max]
    .map((v) => {
      const y = base - (v / max) * (half - 2);
      return `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}" stroke="#8B4A2B" stroke-opacity="${v === 0 ? 0.55 : 0.15}" stroke-width="1"/>
        <text x="${PAD.l - 4}" y="${y + 3}" text-anchor="end" font-size="9" fill="#6B4A33">${Math.abs(v).toLocaleString('fr-FR')}</text>`;
    })
    .join('');
  const cols = days
    .map((d, i) => {
      const x = PAD.l + i * band + (band - bw) / 2;
      const sel = d.date === selectedDate;
      const lbl = i % 2 === 0 || sel ? `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="9" font-weight="${sel ? 700 : 400}" fill="${sel ? '#1F2F5C' : '#6B4A33'}">${label(d.date)}</text>` : '';
      return `<g data-day="${d.date}" tabindex="0" role="button" aria-label="${d.date} : ${d.arrivals_est} arrivées, ${d.departures_est} départs">
        ${sel ? `<rect x="${PAD.l + i * band}" y="${PAD.t}" width="${band}" height="${plotH}" fill="#1F2F5C" fill-opacity="0.08" rx="3"/>` : ''}
        <path d="${column(x, base - 1, scale(d.arrivals_est), bw, true)}" fill="${WAVE_COLORS.arrivals}"/>
        <path d="${column(x, base + 1, scale(d.departures_est), bw, false)}" fill="${WAVE_COLORS.departures}"/>
        <rect x="${PAD.l + i * band}" y="${PAD.t}" width="${band}" height="${plotH}" fill="transparent"/>
        ${lbl}
      </g>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Arrivées et départs estimés des délégations par jour" style="touch-action:manipulation">
    ${grid}
    <text x="${PAD.l + 2}" y="${PAD.t - 4}" font-size="9" fill="#6B4A33">↑ arrivées · ↓ départs (athlètes)</text>
    ${cols}
  </svg>`;
}

// Rain forecast: one series (mm per hour) as columns, one axis. Probability is
// shown in the readout/table, not as a second axis.
export const RAIN_COLOR = '#2F55A4';

export function rainChartSvg(hours, { label = 'Pluie prévue' } = {}) {
  const w = 340;
  const h = 150;
  const pad = { l: 28, r: 6, t: 12, b: 22 };
  const max = Math.max(2, ...hours.map((x) => x.mm));
  const top = max <= 2 ? 2 : max <= 5 ? 5 : max <= 10 ? 10 : Math.ceil(max / 10) * 10;
  const plotH = h - pad.t - pad.b;
  const band = (w - pad.l - pad.r) / hours.length;
  const bw = Math.min(10, band - 2);
  const y = (v) => pad.t + plotH - (v / top) * plotH;
  const grid = [0, top / 2, top]
    .map((v) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#8B4A2B" stroke-opacity="${v ? 0.15 : 0.5}"/>
      <text x="${pad.l - 4}" y="${y(v) + 3}" text-anchor="end" font-size="9" fill="#6B4A33">${v}</text>`)
    .join('');
  const cols = hours
    .map((x, i) => {
      const bx = pad.l + i * band + (band - bw) / 2;
      const bh = Math.max(0, y(0) - y(x.mm));
      const r = Math.min(3, bw / 2, bh);
      const path = bh > 0 ? `M${bx},${y(0)}V${y(0) - bh + r}Q${bx},${y(0) - bh} ${bx + r},${y(0) - bh}H${bx + bw - r}Q${bx + bw},${y(0) - bh} ${bx + bw},${y(0) - bh + r}V${y(0)}Z` : '';
      const lbl = i % 3 === 0 ? `<text x="${bx + bw / 2}" y="${h - 8}" text-anchor="middle" font-size="9" fill="#6B4A33">${x.time.slice(11, 13)}h</text>` : '';
      return `<g data-hour="${i}" tabindex="0" role="button" aria-label="${x.time.slice(11, 16)} : ${x.mm} mm, ${x.prob} %">
        ${path ? `<path d="${path}" fill="${RAIN_COLOR}" fill-opacity="${0.35 + 0.65 * Math.min(1, (x.prob || 0) / 100)}"/>` : ''}
        <rect x="${pad.l + i * band}" y="${pad.t}" width="${band}" height="${plotH}" fill="transparent"/>${lbl}</g>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${label}">${grid}<text x="${pad.l}" y="${pad.t - 3}" font-size="9" fill="#6B4A33">mm/h</text>${cols}</svg>`;
}
