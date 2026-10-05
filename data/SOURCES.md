# Sources des données — jojdakar2026

Généré par `scripts/build-data.mjs` le 2026-10-05T04:00Z. Ne pas éditer à la main.

- Collecte : `npm run data:scrape` (pages brutes + sha256 dans `data/raw/`)
- Génération : `npm run data:build` → `public/data/events/jojdakar2026/*.json` (chaque fichier porte `meta.dataset_version` et la date de collecte de chaque source)
- Historique : `data/CHANGELOG.md`

| Source | Éditeur | Publiée le | Mise à jour (source) | Collectée le | Méthode | URL |
|---|---|---|---|---|---|---|
| **officiel** Venues and Host Cities for the Dakar 2026 Youth Olympic Games | CIO | — | — | manuel | manual-websearch | [lien](https://www.olympics.com/ioc/dakar-2026-venues) |
| **officiel** Billetterie officielle Dakar 2026 — prochaines sessions | COJOJ Dakar 2026 | — | — | 2026-10-05T01:44Z | http-fetch | [lien](https://tickets.dakar2026.org/fr) |
| **officiel** Guide des compétitions — sites (billetterie officielle) | COJOJ Dakar 2026 | — | — | 2026-10-05T03:59Z | http-fetch | [lien](https://tickets.dakar2026.org/fr/guide/venues) |
| **officiel** Calendrier des épreuves (miroir Wikipédia du programme officiel) | Wikipédia | 2026-02-02 | rév. 1378349629 | 2026-10-05T01:43Z | http-fetch | [lien](https://en.wikipedia.org/w/api.php?action=parse&page=2026_Summer_Youth_Olympics&prop=wikitext%7Crevid&format=json&formatversion=2) |
| Saly-Portudal — JOJ Dakar 2026 : les hôtels partenaires en ordre de bataille | Le Soleil via allAfrica | 2026-04-25 | — | manuel | manual-webfetch | [lien](https://fr.allafrica.com/stories/202604250192.html) |
| JOJ Dakar 2026 : un plan de circulation temporaire présenté aux populations de Saly | APS | — | — | 2026-10-05T01:45Z | http-fetch | [lien](https://aps.sn/joj-dakar-2026-un-plan-de-circulation-temporaire-presente-aux-populations-de-saly/) |
| JOJ Dakar 2026 : programme complet des compétitions | Au Sénégal | — | — | 2026-10-05T01:45Z | http-fetch | [lien](https://www.au-senegal.com/jeux-olympiques-de-la-jeunesse-dakar-2026-programme-complet-des-competitions,18284.html?lang=fr) |
| Dakar 2026 : à un mois des JOJ, le TER relie désormais la capitale à l'aéroport | Agence Ecofin | 2026-10-01 | — | manuel | manual-websearch | [lien](https://www.agenceecofin.com/actualites-services/0110-142049-dakar-2026-a-un-mois-des-joj-le-ter-relie-desormais-la-capitale-a-l-aeroport) |
| Dakar 2026 : le Village olympique et le Centre équestre livrés à deux mois des JOJ | Agence Ecofin | 2026-09-08 | — | manuel | manual-websearch | [lien](https://www.agenceecofin.com/actualites-infrastructures/0809-141372-dakar-2026-le-village-olympique-et-le-centre-equestre-livres-a-deux-mois-des-joj) |
| Campus social de l'Université Amadou Mahtar Mbow et localités de Saly | OpenStreetMap | — | 2026-10-05T03:58:00Z | 2026-10-05T03:59Z | http-fetch | [lien](https://overpass-api.de/api/interpreter) |
| Tracé de la Route de la Corniche Ouest | OpenStreetMap | — | 2026-10-05T01:42:57Z | 2026-10-05T01:44Z | http-fetch | [lien](https://overpass-api.de/api/interpreter) |
| Repères culturels | OpenStreetMap | — | 2026-10-05T01:44:06Z | 2026-10-05T01:45Z | http-fetch | [lien](https://overpass-api.de/api/interpreter) |
| Parcs, jardins et plages | OpenStreetMap | — | 2026-10-05T01:44:06Z | 2026-10-05T01:45Z | http-fetch | [lien](https://overpass-api.de/api/interpreter) |
| Gares TER et stations BRT | OpenStreetMap | — | 2026-10-05T01:42:57Z | 2026-10-05T01:44Z | http-fetch | [lien](https://overpass-api.de/api/interpreter) |
| Organisation des JOJ 2026 : le ministre Samba Diouf supervise les tests technologiques à Kër AYO | PressAfrik | — | — | manuel | manual-webfetch | [lien](https://www.pressafrik.com/Organisation-des-JOJ-2026-le-ministre-Samba-Diouf-supervise-les-tests-technologiques-a-Ker-AYO_a311174.html) |
| Travaux des JOJ 2026 : la rue de Louga à Point E fermée à partir de jeudi | PressAfrik | 2026-08-11 | — | 2026-10-05T01:45Z | http-fetch | [lien](https://www.pressafrik.com/Travaux-des-JOJ-2026-la-rue-de-Louga-a-Point-E-fermee-a-partir-de-jeudi_a309755.html) |
| JOJ Dakar 2026 : le calendrier complet des batailles pour les médailles | Senego | 2026-09-21 | — | manuel | manual-webfetch | [lien](https://senego.com/joj-dakar-2026-le-calendrier-complet-des-batailles-pour-les-medaille_2004721.html) |
| JOJ Dakar 2026 : Saly Beach Ouest livré au COJOJ | Senego | — | — | manuel | manual-websearch | [lien](https://senego.com/joj-dakar-2026-saly-beach-ouest-livre-au-cojoj-apres-un-premier-test-operationnel-en-volleyball_1993025.html) |
| Horaires TER et BRT Dakar 2026 | Senego | — | — | 2026-10-05T01:45Z | http-fetch | [lien](https://senego.com/services/horaires-brt-ter) |
| Tests Events des JOJ Dakar 2026 : un plan de circulation spécial mis en place à Dakar | Senego | 2026-08-04 | — | 2026-10-05T01:45Z | http-fetch | [lien](https://senego.com/tests-events-des-joj-dakar-2026-un-plan-de-circulation-special-mis-en-place-a-dakar_1990497.html) |
| Mobilité durant les JOJ Dakar 2026 : le ministère des Transports terrestres mise sur un système fiable | SenePlus | 2026-05-22 | — | manuel | manual-webfetch | [lien](https://www.seneplus.com/article/mobilite-durant-les-joj-dakar-2026-le-ministere-des-transports-terrestres-mise-sur-un) |
| JOJ Dakar 2026, Diomaye réceptionne le village olympique | SenePlus | 2026-08-29 | — | manuel | manual-webfetch | [lien](https://www.seneplus.com/article/joj-dakar-2026-diomaye-receptionne-le-village-olympique) |
| JOJ Dakar 2026 : répétition générale des dispositifs technologiques à Kër Ayo | Teranga Times | — | — | manuel | manual-websearch | [lien](https://www.terangatimesn.com/JOJ-Dakar-2026-le-ministre-Samba-Diouf-supervise-la-repetition-generale-des-dispositifs-technologiques-a-Ker-Ayo_a8365.html) |
| JOJ Dakar 2026 : l'aéroport militaire de Ouakam en vitrine des Jeux | Wannel TV | — | — | manuel | manual-webfetch | [lien](https://www.wannel.tv/joj-dakar-2026-bacary-sarr-transforme-laeroport-militaire-de-ouakam-en-vitrine-des-jeux/) |

## Ce qui est officiel, ce qui est estimé

- **Officiel** : sites, Plus Codes, disciplines par site (guide de la billetterie COJOJ) ; grille jour × sport (programme officiel du 2 février 2026, via Wikipédia) ; horaires exacts des premières sessions affichées par la billetterie ; cérémonie d'ouverture (31 oct., 17:45, Stade Abdoulaye Wade).
- **Estimé par Sama Yoon** (`impact_estimate: true`) : niveau d'impact trafic, fenêtres horaires d'affluence, rayon des périmètres. Méthode : niveau de base par site (densité urbaine), +1 niveau les jours de finales, Corniche Ouest « réservée » 07:00-14:00 les jours de course.
- **À confirmer** (`verified: false`) : lieu et heure de la cérémonie de clôture ; tracé exact de l'épreuve sur la Corniche.
- **En attente** : aucun arrêté de circulation couvrant la période des Jeux n'était publié à la date de collecte (seuls ceux des épreuves tests d'août 2026 et des travaux sont référencés).

## Écarts relevés entre sources

- Taekwondo : Centre des Expositions selon Wikipédia, Complexe Iba Mar Diop selon le guide officiel de la billetterie → guide officiel retenu.
- Futsal : deux sites (Iba Mar Diop + Dakar Arena pour les finales selon Wikipédia) → impact appliqué aux deux.
- Centre équestre de Diamniadio : Le Plus Code publié (MHH3+X99) est celui d'Iba Mar Diop (copie probable) ; on retient le lien Google Maps officiel du même site.
- Saly Plage Ouest : Le lien Maps pointe en mer (zone de voile probable) ; le Plus Code publié situe le site sur la plage.
- Billetterie complète (toutes sessions) protégée par CAPTCHA : non collectée ; seules les sessions publiques de la page d'accueil sont utilisées.
