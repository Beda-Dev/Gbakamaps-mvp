// =============================================================================
// Test d'intégration du module trip-planning — contre la vraie base
// PostGIS, avec une petite topologie de lignes semée explicitement (pas les
// vraies données GTFS, pour un résultat déterministe et rapide).
//
// Topologie semée : ligne L1 (sens "Nord") A -> B -> C, ligne L2 (sens
// "Est") C -> D. Un trajet de près de A vers près de D doit donc être
// trouvé comme un trajet à 1 correspondance (A->C sur L1, C->D sur L2).
// =============================================================================
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';

describe('trip-planning module', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  // Coordonnées volontairement isolées (nord de la Côte d'Ivoire, loin
  // d'Abidjan) : les vraies données GTFS importées (3820 arrêts réels,
  // dizaines de lignes autour du Plateau) pollueraient sinon les candidats
  // de recherche du planificateur si on testait avec des coordonnées
  // abidjanaises — bug de test réel rencontré et corrigé le 2026-09-06 (le
  // premier plan retourné utilisait une vraie ligne du jeu de données
  // plutôt que la topologie synthétique semée ici). Points espacés d'environ
  // 150-200m les uns des autres, alignés pour rester simples à raisonner.
  const A = { lat: 9.5, lon: -5.5 };
  const B = { lat: 9.5015, lon: -5.5 };
  const C = { lat: 9.503, lon: -5.5 };
  const D = { lat: 9.503, lon: -5.4985 };

  let stopIds: Record<'A' | 'B' | 'C' | 'D', string> = { A: '', B: '', C: '', D: '' };
  let lineIds: Record<'L1' | 'L2', string> = { L1: '', L2: '' };

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const [stopA, stopB, stopC, stopD] = await Promise.all([
      prisma.stop.create({ data: { name: 'Arrêt A [TEST]', lat: A.lat, lon: A.lon, stopType: 'BUS_STOP' } }),
      prisma.stop.create({ data: { name: 'Arrêt B [TEST]', lat: B.lat, lon: B.lon, stopType: 'BUS_STOP' } }),
      prisma.stop.create({ data: { name: 'Arrêt C [TEST]', lat: C.lat, lon: C.lon, stopType: 'BUS_STOP' } }),
      prisma.stop.create({ data: { name: 'Arrêt D [TEST]', lat: D.lat, lon: D.lon, stopType: 'BUS_STOP' } }),
    ]);
    stopIds = { A: stopA.id, B: stopB.id, C: stopC.id, D: stopD.id };

    const [lineL1, lineL2] = await Promise.all([
      prisma.transportLine.create({
        data: { name: 'Ligne L1 [TEST]', transportType: 'BUS', externalRef: 'test-tp-l1', fare: 200, fareVerified: true },
      }),
      prisma.transportLine.create({
        data: { name: 'Ligne L2 [TEST]', transportType: 'GBAKA', externalRef: 'test-tp-l2', fare: 250, fareVerified: true },
      }),
    ]);
    lineIds = { L1: lineL1.id, L2: lineL2.id };

    // L1, sens "Nord" : A(0s) -> B(120s) -> C(240s).
    await prisma.stopLine.createMany({
      data: [
        { stopId: stopA.id, lineId: lineL1.id, direction: 'Nord', sequence: 0, secondsFromRouteStart: 0 },
        { stopId: stopB.id, lineId: lineL1.id, direction: 'Nord', sequence: 1, secondsFromRouteStart: 120 },
        { stopId: stopC.id, lineId: lineL1.id, direction: 'Nord', sequence: 2, secondsFromRouteStart: 240 },
      ],
    });
    // L2, sens "Est" : C(0s) -> D(180s).
    await prisma.stopLine.createMany({
      data: [
        { stopId: stopC.id, lineId: lineL2.id, direction: 'Est', sequence: 0, secondsFromRouteStart: 0 },
        { stopId: stopD.id, lineId: lineL2.id, direction: 'Est', sequence: 1, secondsFromRouteStart: 180 },
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

  it('refuse une requête sans from/to (400)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/trip-plan' });
    expect(res.statusCode).toBe(400);
  });

  it('trajet direct A -> C sur L1 : trouvé, coût et durée cohérents avec les données semées', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/trip-plan?from=${A.lat},${A.lon}&to=${C.lat},${C.lon}&maxTransfers=0`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.plans.length).toBeGreaterThan(0);

    const plan = body.data.plans[0];
    const ride = plan.steps.find((s: { type: string }) => s.type === 'ride');
    expect(ride).toBeDefined();
    expect(ride.line.id).toBe(lineIds.L1);
    expect(ride.boardStop.id).toBe(stopIds.A);
    expect(ride.alightStop.id).toBe(stopIds.C);
    // A(0s) -> C(240s) : durée de trajet exacte tirée des données semées.
    expect(ride.durationSeconds).toBe(240);
    expect(ride.durationEstimateBasis).toBe('gtfs-schedule');
    expect(ride.costFCFA).toBe(200);
    expect(ride.costVerified).toBe(true);
  });

  it('ne propose jamais un trajet dans le mauvais sens (C -> A refusé comme direct)', async () => {
    // C est après A dans le sens "Nord" : aucun trajet direct de C vers A
    // ne doit être proposé (semerait un trajet à rebours, physiquement faux).
    // walkRadius=100 (au lieu du défaut 800m) : dans cette géométrie de test
    // compacte (~150-300m entre points), un rayon large ferait déborder les
    // candidats d'embarquement de C dans le rayon de A (et inversement),
    // ce qui rendrait un trajet A->B légitime mais non pertinent pour cette
    // assertion précise sur le sens de circulation.
    const res = await app.inject({
      method: 'GET',
      url: `/api/trip-plan?from=${C.lat},${C.lon}&to=${A.lat},${A.lon}&maxTransfers=0&walkRadius=100`,
    });
    expect(res.statusCode).toBe(200);
    const plans = res.json().data.plans;
    const wrongWay = plans.some((p: { steps: { type: string; line?: { id: string } }[] }) =>
      p.steps.some((s) => s.type === 'ride' && s.line?.id === lineIds.L1)
    );
    expect(wrongWay).toBe(false);
  });

  it('trajet à 1 correspondance A -> D (L1 puis L2 via C) trouvé quand maxTransfers=1', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/trip-plan?from=${A.lat},${A.lon}&to=${D.lat},${D.lon}&maxTransfers=1&walkRadius=300`,
    });
    expect(res.statusCode).toBe(200);
    const plans = res.json().data.plans;
    const withTransfer = plans.find((p: { transfersCount: number }) => p.transfersCount === 1);
    expect(withTransfer).toBeDefined();

    const rides = withTransfer.steps.filter((s: { type: string }) => s.type === 'ride');
    expect(rides).toHaveLength(2);
    expect(rides[0].line.id).toBe(lineIds.L1);
    expect(rides[0].alightStop.id).toBe(stopIds.C);
    expect(rides[1].line.id).toBe(lineIds.L2);
    expect(rides[1].boardStop.id).toBe(stopIds.C);
    expect(rides[1].alightStop.id).toBe(stopIds.D);
    // Coût total = somme des deux tarifs vérifiés semés (200 + 250).
    expect(withTransfer.totalCostFCFA).toBe(450);
    expect(withTransfer.costVerified).toBe(true);
  });

  it('aucun trajet à 1 correspondance proposé quand maxTransfers=0', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/trip-plan?from=${A.lat},${A.lon}&to=${D.lat},${D.lon}&maxTransfers=0&walkRadius=300`,
    });
    const plans = res.json().data.plans;
    expect(plans.every((p: { transfersCount: number }) => p.transfersCount === 0)).toBe(true);
  });

  it('optimize=cheapest trie par coût croissant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/trip-plan?from=${A.lat},${A.lon}&to=${D.lat},${D.lon}&maxTransfers=1&walkRadius=300&optimize=cheapest`,
    });
    const plans = res.json().data.plans as { totalCostFCFA: number | null }[];
    for (let i = 1; i < plans.length; i++) {
      const prev = plans[i - 1].totalCostFCFA ?? Infinity;
      const curr = plans[i].totalCostFCFA ?? Infinity;
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  it('aucun arrêt réel autour de coordonnées isolées → liste vide (pas une erreur)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/trip-plan?from=9.6,-5.6&to=9.61,-5.61',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.plans).toEqual([]);
  });

  // Bug réel trouvé le 2026-09-09 en écrivant le CRUD admin des lignes
  // (§12.16/§12.21) : `active: false` désactivait bien une ligne de
  // `GET /lines` (public), mais AUCUNE des requêtes stopLine.findMany de ce
  // module ne filtrait dessus — une ligne "désactivée" par un admin restait
  // donc pleinement utilisable dans un plan de trajet, rendant la
  // désactivation purement cosmétique. Corrigé dans trip-planning.service.ts.
  it("un trajet direct via une ligne DÉSACTIVÉE n'est plus proposé", async () => {
    await prisma.transportLine.update({ where: { id: lineIds.L1 }, data: { active: false } });
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/trip-plan?from=${A.lat},${A.lon}&to=${C.lat},${C.lon}&maxTransfers=0`,
      });
      expect(res.statusCode).toBe(200);
      const usesL1 = res
        .json()
        .data.plans.some((p: { steps: { type: string; line?: { id: string } }[] }) =>
          p.steps.some((s) => s.type === 'ride' && s.line?.id === lineIds.L1)
        );
      expect(usesL1).toBe(false);
    } finally {
      // Réactivation systématique (try/finally) : ne jamais laisser la
      // topologie semée dans un état modifié si une assertion échoue avant,
      // ce qui casserait silencieusement les tests suivants du fichier.
      await prisma.transportLine.update({ where: { id: lineIds.L1 }, data: { active: true } });
    }
  });

  it("une correspondance via une ligne DÉSACTIVÉE n'est plus proposée", async () => {
    await prisma.transportLine.update({ where: { id: lineIds.L2 }, data: { active: false } });
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/trip-plan?from=${A.lat},${A.lon}&to=${D.lat},${D.lon}&maxTransfers=1&walkRadius=300`,
      });
      expect(res.statusCode).toBe(200);
      const withTransfer = res
        .json()
        .data.plans.find((p: { transfersCount: number }) => p.transfersCount === 1);
      expect(withTransfer).toBeUndefined();
    } finally {
      await prisma.transportLine.update({ where: { id: lineIds.L2 }, data: { active: true } });
    }
  });
});
