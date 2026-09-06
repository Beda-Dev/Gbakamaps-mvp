# Données GTFS — Grand Abidjan (JungleBus)

**Source** : [JungleBus](https://junglebus.io), publié via [Transitland](https://www.transit.land/feeds/f-ebvn-grand~abidjan) (Onestop ID `f-ebvn-grand~abidjan`).
**Téléchargé le** : 2026-09-06, depuis `https://gitlab.com/digitaltransport/data/africa/abidjan/raw/master/Données/abidjan.zip`.
**Licence** : Open Data Commons Open Database License (ODbL). Attribution requise : *"Jungle Bus © OpenStreetMap contributors"*.

## Pourquoi cette source plutôt qu'Overpass en direct

L'audit de l'ancien projet a montré que les tags OSM `gbaka=yes`, `woro_woro=yes`, `moto_taxi=yes` etc. interrogés directement via Overpass ne renvoient quasiment aucun résultat sur le terrain (vérifié empiriquement : 0 résultat sur un rayon de 2km à Abidjan Plateau). JungleBus a fait le travail de terrain nécessaire — relevé des lignes informelles, conversion en GTFS standard — et sépare déjà gbaka et woro-woro **par commune et par opérateur** (ex. "Gbaka d'Adjamé", "Woro-woro de Cocody").

## Contenu conservé (fichiers essentiels au MVP)

| Fichier | Description |
|---|---|
| `agency.txt` | 24 opérateurs (monbus/SOTRA, 9 réseaux gbaka par commune, 11 réseaux woro-woro par commune, 3 opérateurs de transport lagunaire) |
| `routes.txt` | 398 lignes |
| `trips.txt` | 831 voyages (relie une ligne à ses arrêts via stop_times) |
| `stop_times.txt` | séquences d'arrêts par voyage — utilisé uniquement pour savoir QUELS arrêts sont desservis par QUELLES lignes, pas pour les horaires |
| `stops.txt` | 3 820 arrêts nommés, avec coordonnées précises |

**Fichiers volontairement exclus** (non nécessaires au MVP, pour ne pas alourdir le dépôt) : `shapes.txt` (6 Mo, tracé géométrique des lignes — utile pour un affichage V2 du tracé sur la carte, pas pour la recherche d'arrêts), `frequencies.txt`, `calendar.txt`, `feed_info.txt`.

## ⚠️ Limite connue : horaires obsolètes

La version active de ce flux date de décembre 2021, avec des dates de service allant jusqu'à juin 2022. **Les horaires et fréquences ne sont plus fiables.** C'est pourquoi le script d'import (`src/scripts/import-gtfs.ts`) n'utilise **que la topologie** (quel arrêt, quelle ligne, quel opérateur) et ignore délibérément tout ce qui concerne les horaires. Les arrêts physiques et la structure des lignes changent beaucoup plus lentement que les horaires — cette partie reste largement exploitable.

## Exclu de cet import : transport lagunaire (ferry)

Les opérateurs `Aqualines`, `STL` et `monbato` (route_type GTFS = 4, ferry) sont **ignorés par le script d'import** — le transport lagunaire est hors du périmètre MVP défini (bus/gbaka/woro-woro terrestres). Le schéma de données (`TransportType`) ne modélise pas ce mode ; à ajouter en V2 si le produit s'étend au transport lagunaire.
