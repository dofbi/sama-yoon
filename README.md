# Sama Yoon — La mobilité intelligente à Dakar

PWA mobile-first de *smart mobility* / *civic tech* pour vivre sereinement les **JOJ Dakar 2026** (31 oct. – 13 nov. 2026) : carte de fluidité autour des sites, programme officiel transformé en prévisions d'affluence, alternatives TER/BRT, voies fluides & points relais, et info-trafic citoyenne en temps réel.

*Informer, fluidifier, avancer ensemble.*

## Démarrer

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # valide les données puis build dans dist/
npm run preview
npm test               # tests de la logique d'impact (node:test)
```

Aperçu d'un moment précis des Jeux : `http://localhost:5173/?now=2026-11-08T09:00` (heure de Dakar = UTC).

Sans clés Supabase, l'app tourne en **mode démo** : les info-trafic restent dans le navigateur et se synchronisent entre onglets (BroadcastChannel).

## Données

Toutes les données viennent de sources collectées, datées et versionnées — rien n'est saisi de mémoire.

```bash
npm run data:scrape    # collecte : billetterie officielle, programme, OSM, presse → data/raw + data/scraped
npm run data:build     # fusion avec data/curated/jojdakar2026.json → public/data/events/jojdakar2026/*.json
npm run data:update    # les deux + validation
```

- Chaque jeu de données est `{ meta, items }` ; `meta` porte `dataset_version`, `generated_at`, `last_checked_at` et, par source, `fetched_at`, date de publication/mise à jour, révision et `sha256`.
- L'app affiche la date du programme officiel, la date de mise à jour et de vérification des données, et la liste des sources (menu → *Sources des données*).
- `data/SOURCES.md` (généré) détaille ce qui est **officiel**, **estimé** par Sama Yoon et **à confirmer**, ainsi que les écarts entre sources.
- `data/CHANGELOG.md` garde une entrée par nouvelle version de données. Relancer le build sans changement de contenu ne crée pas de version.
- Les fichiers de données sont servis en *stale-while-revalidate* par le service worker : une nouvelle version publiée atteint les utilisateurs sans redéployer l'app.

| Fichier | Contenu |
|---|---|
| `venues.json` | 8 sites officiels (coordonnées, Plus Code, disciplines, périmètre ou corridor) |
| `events_schedule.json` | créneaux d'impact par site et par jour (`impact_level` LOW/MEDIUM/HIGH/CLOSED) |
| `transit.json` | lignes TER/BRT (fréquences Jeux) + gares et stations |
| `quiet_spots.json` | voies fluides & points relais (parcs, plages) hors périmètres |
| `traffic_notices.json` | plans de circulation publiés |
| `landmarks.json` | repères culturels (décor de carte) |

## Supabase (signalements temps réel)

1. Créer un projet Supabase, ouvrir le SQL editor et exécuter `supabase/schema.sql` (tables, RLS, limitation 1 signalement / 2 min par client côté serveur, RPC `increment_upvote`, publication Realtime).
2. Copier `.env.example` en `.env.local` et renseigner `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
3. Sur Netlify, définir les mêmes variables dans *Site settings → Environment variables*.

Le SDK Supabase n'est chargé (import dynamique) que si les clés sont présentes.

## Alertes push (Web Push)

Les usagers choisissent des **zones suivies** (Corniche, Fann/Point E, Médina, Ouakam, Diamniadio, AIBD, Saly) et reçoivent :
- **programme officiel** : la veille entre 19h et 22h, et ~1 h avant un périmètre prioritaire (HIGH/CLOSED) ;
- **info-trafic citoyenne** : quand ≥ 3 signalements ou ≥ 5 confirmations se regroupent dans une zone en 30 min (max 1 alerte/zone/heure).

Heures calmes : pas d'alerte « 1 h avant » entre 22h et 6h, ni d'alerte citoyenne entre 23h et 6h. Logique : `netlify/lib/alerts.mjs` (testée), envoi : fonction planifiée `alerts-dispatch` (toutes les 10 min), abonnement : `alerts-subscribe`, aperçu sans envoi : `alerts-admin`.

Mise en route :
1. Exécuter `supabase/migrations/003_push_alerts.sql` (tables sans accès anonyme).
2. Générer les clés : `npx web-push generate-vapid-keys`.
3. Dans Netlify → *Environment variables* : `VITE_VAPID_PUBLIC_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:), `ALERTS_ADMIN_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` (**fonctions uniquement**, jamais côté client), puis redéployer.
4. Aperçu : `curl -H "Authorization: Bearer $ALERTS_ADMIN_TOKEN" "https://<site>/.netlify/functions/alerts-admin?now=2026-11-07T19:05"`.

Sur iPhone, le push ne fonctionne que si l'app est ajoutée à l'écran d'accueil (iOS 16.4+) ; l'interface l'explique.

## Déploiement Netlify

Connecter le dépôt : `netlify.toml` configure build, cache (assets immuables, données 5 min) et en-têtes de sécurité.

## Réutiliser après les JOJ

L'app est indépendante de l'événement : ajouter `data/curated/<slug>.json`, lancer `node scripts/build-data.mjs <slug>`, déclarer l'événement dans `src/config/event.js` et définir `VITE_EVENT=<slug>` (Magal, Gamou, fêtes de fin d'année, grands chantiers…).

## Ligne éditoriale

Tout le texte d'interface est dans `src/i18n/fr.js`. Le projet accompagne la ville pendant l'événement, il ne s'y oppose jamais : `npm run validate` refuse le vocabulaire banni (« éviter », « havre », « survie », « anti- »…) dans l'UI et les données.

## Architecture

```
index.html              shell (texte pré-rendu depuis fr.js au build)
src/main.js             orchestration UI (filtres, carnet de route, dialogues)
src/map.js              Leaflet : périmètres, corridor « piste », icônes
src/impact.js           logique pure : niveau par site selon le créneau
src/store/              adapter Supabase / démo + file hors ligne
src/icons.js            SVG inline (car rapide, baobab, coffre…)
src/i18n/fr.js          micro-copy
src/config/event.js     paramètres de l'événement
scripts/                collecte, build, validation, tests des données
supabase/schema.sql     schéma + RLS
```
