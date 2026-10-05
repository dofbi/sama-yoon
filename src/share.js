import { fr } from './i18n/fr.js';

export const appUrl = () => import.meta.env.VITE_PUBLIC_URL || 'https://samayoon.app';

export const whatsappLink = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

export function reportShareText(report, placeName) {
  const label = fr.report.types[report.report_type]?.label || 'Info-trafic';
  return fr.share.report(label, placeName, appUrl());
}

export const mapShareText = (mode) => (mode === 'rain' ? fr.share.rain(appUrl()) : fr.share.map(appUrl()));

export function reportShareTextFor(report, placeName) {
  // A street / landmark typed by the reporter beats the nearest known place.
  return reportShareText(report, report.description || placeName);
}

// Native share sheet when available (Android/iOS), WhatsApp link otherwise.
export async function shareMap(mode = 'joj') {
  const text = mapShareText(mode);
  if (navigator.share) {
    try {
      await navigator.share({ title: fr.app.name, text, url: appUrl() });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  open(whatsappLink(text), '_blank', 'noopener');
}

export const directionsLink = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=transit`;
