---
name: info-trafic
description: Publie dans Sama Yoon (carte + carnet de route + alertes push) l'état du trafic relayé depuis les réseaux sociaux (posts, captures, messages WhatsApp collés). À utiliser quand l'utilisateur partage des infos de trafic ou d'inondation à Dakar à ajouter en direct, ou tape /info-trafic.
argument-hint: "[posts, textes ou captures décrivant le trafic]"
---

# /info-trafic — relayer l'info trafic des réseaux sociaux

L'utilisateur colle des posts (X, Facebook, WhatsApp, TikTok…), du texte libre ou des captures d'écran. Chaque incident devient un **signalement ordinaire** de l'app : même affichage que « Info citoyenne », expiration après 3 h prolongée par chaque 👍, et déclenchement des alertes push des zones suivies. En base, `origin = 'relay'` (interne, jamais affiché).

## 1. Extraire les incidents

Pour chaque incident distinct, produire un objet :

| champ | règle |
|---|---|
| `place` | lieu le plus précis possible, tel qu'écrit (« VDN au niveau de Castors », « rond-point Case Bi », « Keur Massar marché »). Un lieu par objet ; un post citant 3 lieux → 3 objets. |
| `type` | `INONDATION` (eau, inondé, impraticable à cause de la pluie), `ROUTE_BLOQUEE` (fermé, coupé, accident bloquant, travaux), `BOUCHON` (embouteillage, ralenti, dense), `BARRAGE_POLICE` (contrôle, barrage, régulation). En cas de doute entre deux types, prendre le plus prudent pour l'usager (inondé > bloqué > dense). |
| `note` | libellé court affiché dans le carnet (≤ 120 caractères) : « VDN — Castors, chaussée inondée ». **Jamais** de nom, pseudo, numéro, plaque ou visage de particulier. |
| `posted_at` | heure du post si connue (ISO UTC, Dakar = UTC+0). Les posts de plus de 3 h sont rejetés automatiquement. |
| `lat` / `lng` | seulement si le post donne une position ou une localisation Google Maps. |

Ne rien inventer. Ignorer :
- les rumeurs sans lieu ;
- les messages hors région Dakar / Thiès ;
- les infos de plus de 3 h ;
- tout ce qui n'est pas de l'état de trafic (opinions, politique…).

Si un message est ambigu (lieu flou, homonyme), le signaler à l'utilisateur au lieu de deviner.

## 2. Prévisualiser (obligatoire)

Écrire les objets dans un fichier temporaire du scratchpad, puis lancer le dry run :

```bash
node scripts/relay-reports.mjs <scratchpad>/relay-<horodatage>.json
```

Montrer à l'utilisateur le tableau (statut, type, lieu, position, `via`), en mettant en évidence :
- les lieux `lieu introuvable` / `hors zone` → proposer une reformulation (« Castors » plutôt que « devant chez Modou à Castors ») ou demander des coordonnées ;
- les correspondances douteuses dans `via` (ex. « Paris » → « HLM Paris ») : à confirmer explicitement.

## 3. Publier après accord

Seulement après un « ok » explicite de l'utilisateur :

```bash
node scripts/relay-reports.mjs <même fichier> --apply
```

Puis résumer ce qui est en ligne, avec l'heure d'expiration. `node scripts/relay-reports.mjs --list` montre les infos relayées encore actives.

## Prérequis

- `.env.local` doit contenir `VITE_SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`. Cette clé est serveur uniquement : ne jamais l'afficher, la commiter ni la coller dans le chat. Si elle manque, demander à l'utilisateur de l'ajouter lui-même dans `.env.local`.
- La migration `supabase/migrations/005_relayed_reports.sql` doit avoir été exécutée (colonne `origin`, pas de limite d'IP pour la clé serveur).
- Le géocodage passe d'abord par les lieux connus de l'app (stations TER/BRT, repères, quartiers des points de vigilance, sites JOJ), puis par OpenStreetMap Nominatim, limité à la région et à 1 requête par seconde.
