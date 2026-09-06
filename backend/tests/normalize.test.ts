import { describe, expect, it } from 'vitest';
import { namesLikelyMatch, normalizeName } from '../src/common/normalize.js';

describe('normalizeName', () => {
  it('retire les accents, met en minuscules, uniformise la ponctuation', () => {
    expect(normalizeName('Abobo-Gare')).toBe('abobo gare');
    expect(normalizeName('ABOBO GARE')).toBe('abobo gare');
    expect(normalizeName('Adjamé')).toBe('adjame');
    expect(normalizeName('  Gare  Sud  ')).toBe('gare sud');
  });
});

describe('namesLikelyMatch', () => {
  it('exemple de l\'utilisateur : "Abobo Gare" et "Abobo-Gare" correspondent', () => {
    expect(namesLikelyMatch('Abobo Gare', 'Abobo-Gare')).toBe(true);
  });

  it('un nom contenu dans un autre correspond (ex. avec un suffixe)', () => {
    expect(namesLikelyMatch('Abobo Gare', 'Abobo Gare Terminus')).toBe(true);
  });

  it('deux noms réellement différents ne correspondent jamais (jamais de faux rapprochement)', () => {
    expect(namesLikelyMatch('Abobo Gare', 'Abobo Sud')).toBe(false);
    expect(namesLikelyMatch('Adjamé', 'Cocody')).toBe(false);
  });

  it('chaînes vides ne correspondent jamais', () => {
    expect(namesLikelyMatch('', 'Adjamé')).toBe(false);
    expect(namesLikelyMatch('Adjamé', '')).toBe(false);
  });
});
