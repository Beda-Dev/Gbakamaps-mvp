import { describe, expect, it } from 'vitest';
import { extractRideSegment } from './useTripSegments';

// Ligne droite est-ouest le long de lat=5.30, de lon=-4.05 à lon=-4.00,
// avec un point tous les 0.01° (~1.1km) — juste assez pour tester le
// "snapping" des arrêts sur le tracé sans dépendre d'un vrai jeu de données.
const STRAIGHT_LINE = {
  type: 'LineString' as const,
  coordinates: [
    [-4.05, 5.3],
    [-4.04, 5.3],
    [-4.03, 5.3],
    [-4.02, 5.3],
    [-4.01, 5.3],
    [-4.0, 5.3],
  ],
};

describe('extractRideSegment', () => {
  it("découpe la portion du tracé entre deux arrêts proches d'un point du tracé", () => {
    const from = { lat: 5.3, lon: -4.04 };
    const to = { lat: 5.3, lon: -4.01 };

    const result = extractRideSegment(STRAIGHT_LINE, from, to);

    expect(result).toEqual([
      [-4.04, 5.3],
      [-4.03, 5.3],
      [-4.02, 5.3],
      [-4.01, 5.3],
    ]);
  });

  it('inverse la portion quand la destination précède le départ dans le tracé', () => {
    const from = { lat: 5.3, lon: -4.01 };
    const to = { lat: 5.3, lon: -4.04 };

    const result = extractRideSegment(STRAIGHT_LINE, from, to);

    expect(result).toEqual([
      [-4.01, 5.3],
      [-4.02, 5.3],
      [-4.03, 5.3],
      [-4.04, 5.3],
    ]);
  });

  it("refuse d'extraire quand un arrêt est trop loin du tracé connu (> RIDE_SNAP_MAX_M)", () => {
    // ~0.05° de latitude ≈ 5.5km, largement au-delà du seuil de 350m —
    // ne doit jamais produire une extraction qui semblerait fausse.
    const from = { lat: 5.35, lon: -4.04 };
    const to = { lat: 5.3, lon: -4.01 };

    const result = extractRideSegment(STRAIGHT_LINE, from, to);

    expect(result).toBeNull();
  });

  it("choisit la meilleure sous-ligne d'un MultiLineString quand plusieurs branches existent", () => {
    const multi = {
      type: 'MultiLineString' as const,
      coordinates: [
        // Branche lointaine (mauvaise correspondance)
        [
          [-3.5, 5.5],
          [-3.4, 5.5],
        ],
        // Branche correcte
        STRAIGHT_LINE.coordinates,
      ],
    };
    const from = { lat: 5.3, lon: -4.04 };
    const to = { lat: 5.3, lon: -4.01 };

    const result = extractRideSegment(multi, from, to);

    expect(result).toEqual([
      [-4.04, 5.3],
      [-4.03, 5.3],
      [-4.02, 5.3],
      [-4.01, 5.3],
    ]);
  });

  it('retourne null pour un type de géométrie non supporté (ex. Polygon)', () => {
    const polygon = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [-4.05, 5.3],
          [-4.0, 5.3],
          [-4.0, 5.35],
        ],
      ],
    };

    const result = extractRideSegment(polygon, { lat: 5.3, lon: -4.04 }, { lat: 5.3, lon: -4.01 });

    expect(result).toBeNull();
  });
});
