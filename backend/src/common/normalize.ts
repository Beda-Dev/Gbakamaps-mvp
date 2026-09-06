// =============================================================================
// Normalisation de noms — utilitaire partagé pour rapprocher des entités
// désignées différemment selon leur source (ex. "Abobo Gare" vs
// "Abobo-Gare" vs "ABOBO GARE"). Utilisé pour la correspondance
// places (Overpass) <-> stops (GTFS), voir places.service.ts — et
// réutilisable si une seconde source de arrêts/lignes est ajoutée un jour
// (cf. PROJECT_MEMORY.md, section sur la cohérence multi-sources).
//
// Volontairement simple (minuscules, accents retirés, ponctuation/espaces
// uniformisés) — PAS de correspondance floue (distance de Levenshtein,
// phonétique...) : une normalisation agressive risquerait de faire
// correspondre deux entités réellement différentes. "Abobo Gare" et
// "Abobo Sud" doivent rester distincts après normalisation, pas fusionnés
// par une similarité approximative.
// =============================================================================
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // retire les diacritiques (é -> e, etc.)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ') // ponctuation/tirets/espaces multiples -> un seul espace
    .trim();
}

// Deux noms normalisés sont considérés "correspondants" s'ils sont
// identiques, ou si l'un est entièrement contenu dans l'autre (ex.
// "abobo gare" contenu dans "abobo gare terminus") — jamais une similarité
// partielle plus permissive, qui risquerait un faux rapprochement.
export function namesLikelyMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}
