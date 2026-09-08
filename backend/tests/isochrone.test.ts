// =============================================================================
// Test d'intégration de l'approximation "zone accessible en X minutes"
// (GET /api/isochrone, PROJECT_MEMORY.md §12.17) — contre la vraie base
// PostGIS, avec une petite topologie de lignes semée explicitement (pas les
// vraies données GTFS, pour un résultat déterministe).
//
// Topologie semée (temps GTFS relatifs volontairement gros pour séparer
// nettement les budgets testés) :
//   - Ligne L1, sens "Nord" : A(0s) -> B(180s) -> C(480s)
//   - Ligne L2, sens "Est"  : C(0s) -> D(300s)
// Coordonnées isolées (nord-ouest, loin d'Abidjan ET de la zone du test
// trip-planning) + walkRadius resserré à 100 m : seul l'arrêt d'origine est
// un point d'embarquement, tout le reste doit être atteint via les lignes.
// =============================================================================
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';

describe('isochrone (approximation zone accessible)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  // ~222 m entre A/B et B/C (0.002° de latitude), ~274 m entre C et D.
  const A = { lat: 9.9, lon: -6.2 };
  const B = { lat: 9.902, lon: -6.2 };
  const C = { lat: 9.904, lon: -6.2 };
  const D = { lat: 9.904, lon: -6.1975 };

  let stopIds: Record<'A' | 'B' | 'C' | 'D', string> = { A: '', B: '', C: '', D: '' };
  let lineIds: Record<'L1' | 'L2', string> = { L1: '', L2: '' };

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const [stopA, stopB, stopC, stopD] = await Promise.all([
      prisma.stop.create({ data: { name: 'Arrêt A [ISO]', lat: A.lat, lon: A.lon, stopType: 'BUS_STOP' } }),
      prisma.stop.create({ data: { name: 'Arrêt B [ISO]', lat: B.lat, lon: B.lon, stopType: 'BUS_STOP' } }),
      prisma.stop.create({ data: { name: 'Arrêt C [ISO]', lat: C.lat, lon: C.lon, stopType: 'BUS_STOP' } }),
      prisma.stop.create({ data: { name: 'Arrêt D [ISO]', lat: D.lat, lon: D.lon, stopType: 'BUS_STOP' } }),
    ]);
    stopIds = { A: stopA.id, B: stopB.id, C: stopC.id, D: stopD.id };

    const [lineL1, lineL2] = await Promise.all([
      prisma.transportLine.create({
        data: { name: 'Ligne L1 [ISO]', transportType: 'BUS', externalRef: 'test-iso-l1', fare: 200, fareVerified: true },
      }),
      prisma.transportLine.create({
        data: { name: 'Ligne L2 [ISO]', transportType: 'GBAKA', externalRef: 'test-iso-l2', fare: 250, fareVerified: true },
      }),
    ]);
    lineIds = { L1: lineL1.id, L2: lineL2.id };

    await prisma.stopLine.createMany({
      data: [
        { stopId: stopA.id, lineId: lineL1.id, direction: 'Nord', sequence: 0, secondsFromRouteStart: 0 },
        { stopId: stopB.id, lineId: lineL1.id, direction: 'Nord', sequence: 1, secondsFromRouteStart: 180 },
        { stopId: stopC.id, lineId: lineL1.id, direction: 'Nord', sequence: 2, secondsFromRouteStart: 480 },
      ],
    });
    await prisma.stopLine.createMany({
      data: [
        { stopId: stopC.id, lineId: lineL2.id, direction: 'Est', sequence: 0, secondsFromRouteStart: 0 },
        { stopId: stopD.id, lineId: lineL2.id, direction: 'Est', sequence: 1, secondsFromRouteStart: 300 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.stopLine.deleteMany({ where: { lineId: { in: [lineIds.L1, lineIds.L2] } } });
    await prisma.transportLine.deleteMany({ where: { id: { in: [lineIds.L1, lineIds.L2] } } });
    await prisma.stop.deleteMany({ where: { id: { in: Object.values(stopIds) } } });
    await app.close();
    await prisma.$disconnect();
  });

  const call = (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ).toString();
    return app.inject({ method: 'GET', url: `/api/isochrone?${qs}` });
  };

  it('refuse une requête sans `from` (400)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/isochrone' });
    expect(res.statusCode).toBe(400);
  });

  it('marque explicitement la réponse comme une approximation', async () => {
    const res = await call({ from: `${A.lat},${A.lon}`, maxMinutes: 15, walkRadius: 100 });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.approximation).toBe(true);
    expect(data.note).toMatch(/approximation/i);
    expect(data.note).toMatch(/isochrone/i);
  });

  it('budget court (5 min) : atteint B via L1, pas encore C ni D', async () => {
    const res = await call({ from: `${A.lat},${A.lon}`, maxMinutes: 5, walkRadius: 100 });
    const stops = res.json().data.reachableStops as { stopId: string; etaSeconds: number; rides: number }[];
    const ids = stops.map((s) => s.stopId);
    expect(ids).toContain(stopIds.B); // A(0s marche) + 180s trajet = 180s <= 300s
    expect(ids).not.toContain(stopIds.C); // 480s > 300s
    expect(ids).not.toContain(stopIds.D);

    const b = stops.find((s) => s.stopId === stopIds.B)!;
    expect(b.rides).toBe(1);
    expect(b.etaSeconds).toBe(180);
    // Invariant : aucun arrêt renvoyé ne dépasse le budget.
    expect(stops.every((s) => s.etaSeconds <= 300)).toBe(true);
  });

  it('budget large (15 min) : atteint D via une correspondance à C (rides=2)', async () => {
    const res = await call({ from: `${A.lat},${A.lon}`, maxMinutes: 15, walkRadius: 100 });
    const stops = res.json().data.reachableStops as {
      stopId: string;
      etaSeconds: number;
      rides: number;
      lastLine: { id: string } | null;
    }[];
    const d = stops.find((s) => s.stopId === stopIds.D);
    expect(d).toBeDefined();
    // A(0s) -> C(480s) sur L1, puis C -> D(+300s) sur L2 = 780s.
    expect(d!.etaSeconds).toBe(780);
    expect(d!.rides).toBe(2);
    expect(d!.lastLine?.id).toBe(lineIds.L2);
  });

  it('maxRides=1 : C atteint mais pas D (D exige une 2e montée)', async () => {
    const res = await call({ from: `${A.lat},${A.lon}`, maxMinutes: 15, walkRadius: 100, maxRides: 1 });
    const ids = (res.json().data.reachableStops as { stopId: string }[]).map((s) => s.stopId);
    expect(ids).toContain(stopIds.C);
    expect(ids).not.toContain(stopIds.D);
  });

  it('maxRides=0 : seuls les arrêts accessibles à pied (l’arrêt d’origine)', async () => {
    const res = await call({ from: `${A.lat},${A.lon}`, maxMinutes: 15, walkRadius: 100, maxRides: 0 });
    const stops = res.json().data.reachableStops as { stopId: string; rides: number; lastLine: unknown }[];
    expect(stops).toHaveLength(1);
    expect(stops[0].stopId).toBe(stopIds.A);
    expect(stops[0].rides).toBe(0);
    expect(stops[0].lastLine).toBeNull();
  });

  it('respecte le sens de circulation : depuis C, on n’atteint jamais A ni B', async () => {
    // C est le dernier arrêt du sens "Nord" de L1 : rien en amont n'est
    // atteignable. Seule L2 (C -> D) part de C.
    const res = await call({ from: `${C.lat},${C.lon}`, maxMinutes: 15, walkRadius: 100 });
    const ids = (res.json().data.reachableStops as { stopId: string }[]).map((s) => s.stopId);
    expect(ids).not.toContain(stopIds.A);
    expect(ids).not.toContain(stopIds.B);
    expect(ids).toContain(stopIds.D);
  });

  it('coordonnées isolées sans aucun arrêt → liste vide, pas une erreur', async () => {
    const res = await call({ from: '10.5,-8.0', maxMinutes: 30 });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.reachableStops).toEqual([]);
    expect(res.json().data.stats.stopsReachable).toBe(0);
  });
});
