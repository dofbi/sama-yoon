// Delegation arrival/departure waves at the airport, derived from the
// official day x sport grid. Pure function: (calendar, quotas, params) -> days.
const shift = (date, n) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function athletesPerSport(sports, quotas, totalAthletes) {
  const known = new Map(quotas.filter((q) => q.athletes).map((q) => [q.sport, q.athletes]));
  const events = (s) => Object.values(s.schedule).reduce((n, v) => n + (v.startsWith('medals:') ? +v.split(':')[1] : 0), 0);
  const competing = sports.filter((s) => Object.values(s.schedule).some((v) => v === 'competition' || v.startsWith('medals:')));
  const knownTotal = competing.reduce((n, s) => n + (known.get(s.sport) || 0), 0);
  const missing = competing.filter((s) => !known.has(s.sport));
  const missingEvents = missing.reduce((n, s) => n + Math.max(1, events(s)), 0);
  const rest = Math.max(0, totalAthletes - knownTotal);
  return competing.map((s) => ({
    sport: s.sport,
    athletes: known.get(s.sport) ?? Math.round((rest * Math.max(1, events(s))) / (missingEvents || 1)),
    athletes_source: known.has(s.sport) ? 'wikipedia' : 'estimate_by_events',
    first_day: Object.keys(s.schedule).filter((d) => s.schedule[d] !== 'opening_ceremony' && s.schedule[d] !== 'closing_ceremony').sort()[0],
    last_day: Object.keys(s.schedule).sort().at(-1),
  }));
}

export function computeWaves(perSport, { arrival_offsets_days, departure_offset_days, levels }) {
  const days = new Map();
  const day = (d) => {
    if (!days.has(d)) days.set(d, { date: d, arrivals_est: 0, departures_est: 0, sports_arriving: [], sports_leaving: [] });
    return days.get(d);
  };
  for (const s of perSport) {
    if (!s.first_day) continue;
    const share = s.athletes / arrival_offsets_days.length;
    for (const off of arrival_offsets_days) {
      const d = day(shift(s.first_day, -off));
      d.arrivals_est += share;
      if (!d.sports_arriving.includes(s.sport)) d.sports_arriving.push(s.sport);
    }
    const dep = day(shift(s.last_day, departure_offset_days));
    dep.departures_est += s.athletes;
    dep.sports_leaving.push(s.sport);
  }
  const levelFor = (n) => (n >= levels.HIGH ? 'HIGH' : n >= levels.MEDIUM ? 'MEDIUM' : n >= levels.LOW ? 'LOW' : 'FLUID');
  return [...days.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      ...d,
      arrivals_est: Math.round(d.arrivals_est),
      departures_est: Math.round(d.departures_est),
      level: levelFor(d.arrivals_est + d.departures_est),
    }));
}
