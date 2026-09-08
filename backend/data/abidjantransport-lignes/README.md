# Lignes de transport à Abidjan — data.gouv.ci

**Source** : [data.gouv.ci/datasets/abidjantransport-lignes](https://data.gouv.ci/datasets/abidjantransport-lignes) (portail officiel ivoirien, plateforme data-fair de Koumoul), lui-même dérivé de relations OSM `route=bus` relevées par [DigitalTransport4Africa](http://sites.digitaltransport.io/abidjantransport/).
**Fourni par l'utilisateur le** : 2026-09-08 (export local), puis retrouvé et confirmé identique sur le portail officiel le même jour.
**Relevé terrain** : 2021. **Dernière mise à jour côté portail** : 2025-06-10 (republication, pas un nouveau relevé).
**Licence** : Licence Ouverte / Open Licence.
**Contenu** : 325 lignes (bus SOTRA/Express/Wibus/Monbus, gbaka, wôrô-wôrô, navettes lagunaires), chacune avec un tracé `MULTILINESTRING` réel.

## ⚠️ Ce fichier n'est PAS utilisé directement par le code

`backend/src/scripts/import-line-shapes.ts` interroge l'**API data-fair en direct**
(`https://data.gouv.ci/data-fair/api/v1/datasets/abidjantransport-lignes/lines`)
plutôt que de dépendre de cet export ponctuel — vérifié identique (325 lignes,
même schéma) le 2026-09-08. Ce fichier est conservé ici uniquement comme
**référence/sauvegarde locale** (utile si le portail est temporairement
indisponible, ou pour ré-explorer le schéma sans re-télécharger 10 Mo), pas
comme source de vérité active.

## Correspondance avec nos lignes

`line_id` (format `"Line:relation:<id_relation_OSM>"`) correspond exactement à
`TransportLine.externalRef` (format `"r<id_relation_OSM>"`) posé par
`import-gtfs.ts` — même relation OSM, jamais une correspondance devinée. Voir
`PROJECT_MEMORY.md` §12.19 pour le détail de la vérification et le taux de
correspondance réel (318/391 lignes en base).
