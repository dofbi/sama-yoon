// All user-facing copy lives here. Editorial line (Smart Mobility / Civic Tech):
// the app accompanies the city through the event; it never frames the event as
// something to escape. scripts/validate-data.mjs lints this file and the data
// against the banned vocabulary below.
export const BANNED_WORDS = ['éviter', 'evitez', 'évitez', 'bouchons des joj', 'havre', 'survie', 'anti-'];

export const fr = {
  app: {
    name: 'Sama Yoon',
    tagline: 'La mobilité intelligente à Dakar',
    motto: 'Informer, fluidifier, avancer ensemble.',
    companion: 'Compagnon de mobilité urbaine',
  },
  filters: {
    now: 'Maintenant',
    today: "Aujourd'hui",
    tomorrow: 'Demain',
    pickDay: 'Choisir un jour',
  },
  levels: {
    FLUID: { label: 'Circulation fluide', short: 'Fluide' },
    LOW: { label: 'Circulation fluide', short: 'Fluide' },
    MEDIUM: { label: 'Trafic modéré / Événement en cours', short: 'Modéré' },
    HIGH: { label: 'Périmètre prioritaire / Axe au ralenti', short: 'Prioritaire' },
    CLOSED: { label: 'Périmètre prioritaire — accès réservé', short: 'Réservé' },
  },
  cta: {
    contribute: "Contribuer à l'info-trafic en 1 clic",
    contributeShort: 'Info-trafic',
    alternatives: 'Consulter les itinéraires alternatifs',
    alternativesShort: 'Alternatives',
    shareMap: 'Partager la carte de fluidité',
    go: 'Itinéraire',
    stillValid: 'Toujours vrai',
    close: 'Fermer',
    menu: 'Menu',
  },
  report: {
    title: "Partager l'état du trafic en direct",
    locating: 'Localisation en cours…',
    located: 'Position GPS trouvée',
    fallback: 'Position : centre de la carte (déplacez la carte pour ajuster)',
    types: {
      BOUCHON: { label: 'Trafic dense', icon: 'carRapide' },
      ROUTE_BLOQUEE: { label: 'Axe fermé', icon: 'barrier' },
      BARRAGE_POLICE: { label: 'Contrôle / point de régulation', icon: 'police' },
    },
    sent: 'Merci ! Votre info-trafic est partagée avec la communauté.',
    queued: 'Hors ligne : votre info-trafic sera envoyée dès le retour du réseau.',
    tooSoon: (min) => `Merci pour votre engagement ! Prochaine contribution possible dans ${min} min.`,
    error: "L'envoi a échoué. Réessayez dans un instant.",
    shareAfter: 'Prévenir mes proches sur WhatsApp',
  },
  feed: {
    title: 'Carnet de route',
    empty: 'Aucune info-trafic citoyenne pour le moment. Soyez le premier éclaireur !',
    citizen: 'Info citoyenne',
    official: 'Programme officiel',
    notice: 'Plan de circulation',
    confirmations: (n) => `${n} confirmation${n > 1 ? 's' : ''}`,
    thanksUpvote: '👍 Merci pour la confirmation !',
    near: (place) => `vers ${place}`,
    ago: (min) => (min < 1 ? "à l'instant" : min < 60 ? `il y a ${min} min` : `il y a ${Math.floor(min / 60)} h`),
  },
  impact: {
    beforeGames: (days) => `Les Jeux débutent dans ${days} jour${days > 1 ? 's' : ''}. Choisissez un jour pour anticiper vos trajets.`,
    afterGames: 'Les Jeux sont terminés. Merci d’avoir fait vivre la ville ensemble !',
    seeDay: (d) => `Voir le ${d}`,
    noEvent: 'Aucun événement programmé sur ce créneau : circulation fluide attendue autour des sites.',
    estimate: 'Prévision Sama Yoon à partir du programme officiel',
    toConfirm: 'à confirmer',
    sessions: 'Créneau',
    sports: 'Disciplines',
    tip: 'Conseil mobilité',
  },
  accommodation: {
    village: 'Village Olympique de la Jeunesse',
    hotels: 'Hébergement des délégations',
    flows: 'Flux de navettes athlètes',
    noFlow: 'Pas de mouvement de navettes prévu sur ce créneau.',
  },
  alternatives: {
    title: 'Itinéraires alternatifs & voies fluides',
    transitTitle: 'Mobilité douce & transports',
    transitIntro: 'Aux heures d’affluence, le TER et le BRT sont les alternatives les plus intelligentes à la voiture individuelle.',
    spotsTitle: 'Voies fluides & points relais',
    spotsIntro: 'Espaces calmes à distance des périmètres prioritaires, pour une pause ou un rendez-vous.',
    distance: (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`),
    nearestStation: 'Station la plus proche',
  },
  share: {
    report: (type, place, url) => `Info-trafic Dakar : ${type.toLowerCase()} ${place ? `vers ${place}` : 'signalé'}. Carte de fluidité en temps réel : ${url}`,
    map: (url) => `Sama Yoon — la carte de fluidité de Dakar pendant les JOJ 2026. Optimisez vos temps de parcours : ${url}`,
  },
  data: {
    updated: (d) => `Données mises à jour le ${d}`,
    programme: (d) => `Programme officiel publié le ${d}`,
    checked: (d) => `vérifié le ${d}`,
    version: (v) => `Version des données ${v}`,
    stale: 'Données de plus de 72 h : la mise à jour est en cours.',
    sources: 'Sources des données',
    awaiting: 'En attente de publication officielle',
  },
  gamification: {
    counter: (n) => `${n} contribution${n > 1 ? 's' : ''} citoyenne${n > 1 ? 's' : ''}`,
    badge: 'Éclaireur de Dakar',
    badgeUnlocked: 'Badge débloqué : Éclaireur de Dakar ! Merci de faire avancer la ville.',
  },
  menu: {
    about: 'À propos',
    aboutText:
      'Sama Yoon (« ma route » en wolof) est un outil civic tech qui aide chacun à optimiser ses temps de parcours pendant les JOJ Dakar 2026, en combinant le programme officiel, les transports en commun et l’info-trafic partagée par les habitants.',
    standardMode: 'Mode clair standard (plein soleil)',
    install: "Installer l'application",
    legal: 'Fond de carte © contributeurs OpenStreetMap',
  },
  offline: 'Hors ligne — affichage des dernières données enregistrées.',
  backendMock: 'Mode démo : les info-trafic restent sur cet appareil.',
};
