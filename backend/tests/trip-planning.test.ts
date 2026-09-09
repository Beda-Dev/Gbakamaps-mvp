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

  // E, F : arrêts d'une 3e ligne (L3) desservant une correspondance à pied
  // depuis C — E placé au NORD-OUEST de C (~195m), dans la direction
  // OPPOSÉE à la fois de D (à l'est) ET de B (au sud, cf. topologie L1
  // A->B->C). Sert exclusivement le test de correspondance par courte
  // marche ci-dessous (§12.16/§12.23). Distances vérifiées explicitement
  // (pas au jugé), toutes hors de TRANSFER_WALK_RADIUS_METERS (300) ou du
  // rayon de recherche destination (300) des AUTRES tests, pour ne jamais
  // introduire de plan parasite : B-E ≈ 333m, D-E ≈ 335m, A-E ≈ 489m
  // (seul C-E ≈ 195m est sous le seuil — la correspondance voulue).
  const E = { lat: 9.5042, lon: -5.5013 };
  const F = { lat: 9.5042, lon: -5.5028 };

  let stopIds: Record<'A' | 'B' | 'C' | 'D' | 'E' | 'F', string> = {
    A: '',
    B: '',
    C: '',
    D: '',
    E: '',
    F: '',
  };
  let lineIds: Record<'L1' | 'L2' | 'L3', string> = { L1: '', L2: '', L3: '' };

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const [stopA, stopB, stopC, stopD, stopE, stopF] = await Promise.all([
      prisma.stop.create({ data: { name: 'Arrêt A [TEST]', lat: A.lat, lon: A.lon, stopType: 'BUS_STOP' } }),
      prisma.stop.create({ data: { name: 'Arrêt B [TEST]', lat: B.lat, lon: B.lon, stopType: 'BUS_STOP' } }),
      prisma.stop.create({ data: { name: 'Arrêt C [TEST]', lat: C.lat, lon: C.lon, stopType: 'BUS_STOP' } }),
      prisma.stop.create({ data: { name: 'Arrêt D [TEST]', lat: D.lat, lon: D.lon, stopType: 'BUS_STOP' } }),
      prisma.stop.create({ data: { name: 'Arrêt E [TEST]', lat: E.lat, lon: E.lon, stopType: 'BUS_STOP' } }),
      prisma.stop.create({ data: { name: 'Arrêt F [TEST]', lat: F.lat, lon: F.lon, stopType: 'BUS_STOP' } }),
    ]);
    stopIds = { A: stopA.id, B: stopB.id, C: stopC.id, D: stopD.id, E: stopE.id, F: stopF.id };

    const [lineL1, lineL2, lineL3] = await Promise.all([
      prisma.transportLine.create({
        data: { name: 'Ligne L1 [TEST]', transportType: 'BUS', externalRef: 'test-tp-l1', fare: 200, fareVerified: true },
      }),
      prisma.transportLine.create({
        data: { name: 'Ligne L2 [TEST]', transportType: 'GBAKA', externalRef: 'test-tp-l2', fare: 250, fareVerified: true },
      }),
      prisma.transportLine.create({
        data: { name: 'Ligne L3 [TEST]', transportType: 'WORO_WORO', externalRef: 'test-tp-l3', fare: 300, fareVerified: true },
      }),
    ]);
    lineIds = { L1: lineL1.id, L2: lineL2.id, L3: lineL3.id };

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
    // L3, sens "Sud" : E(0s) -> F(150s). E est proche de C (~11m) mais un
    // arrêt PHYSIQUEMENT DISTINCT — sert à tester la correspondance par
    // courte marche (L1 jusqu'à C, marche jusqu'à E, L3 jusqu'à F).
    await prisma.stopLine.createMany({
      data: [
        { stopId: stopE.id, lineId: lineL3.id, direction: 'Sud', sequence: 0, secondsFromRouteStart: 0 },
        { stopId: stopF.id, lineId: lineL3.id, direction: 'Sud', sequence: 1, secondsFromRouteStart: 150 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.stopLine.deleteMany({ where: { lineId: { in: [lineIds.L1, lineIds.L2, lineIds.L3] } } });
    await prisma.transportLine.deleteMany({ where: { id: { in: [lineIds.L1, lineIds.L2, lineIds.L3] } } });
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

  // ---------------------------------------------------------------------------
  // Correspondance par courte marche entre deux arrêts proches de lignes
  // différentes — §12.16/§12.23, extension du 2026-09-09 (auparavant limité
  // au seul même arrêt physique).
  // ---------------------------------------------------------------------------

  it("trajet à 1 correspondance A -> F (L1 puis L3 via une courte marche C→E) trouvé", async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/trip-plan?from=${A.lat},${A.lon}&to=${F.lat},${F.lon}&maxTransfers=1&walkRadius=300`,
    });
    expect(res.statusCode).toBe(200);
    const plans = res.json().data.plans;
    const withTransfer = plans.find((p: { transfersCount: number }) => p.transfersCount === 1);
    expect(withTransfer).toBeDefined();

    const rides = withTransfer.steps.filter((s: { type: string }) => s.type === 'ride');
    expect(rides).toHaveLength(2);
    expect(rides[0].line.id).toBe(lineIds.L1);
    expect(rides[0].alightStop.id).toBe(stopIds.C);
    expect(rides[1].line.id).toBe(lineIds.L3);
    expect(rides[1].boardStop.id).toBe(stopIds.E);
    expect(rides[1].alightStop.id).toBe(stopIds.F);

    // Une vraie marche de correspondance doit apparaître ENTRE les deux
    // trajets en véhicule (pas seulement au début/à la fin) — c'est la
    // preuve concrète que la correspondance n'a pas eu lieu au même arrêt
    // physique, contrairement au trajet A->D (§12.7, L1 puis L2 via C).
    const walks = withTransfer.steps.filter((s: { type: string }) => s.type === 'walk');
    expect(walks).toHaveLength(3); // départ->A, C->E, F->arrivée
    const transferWalk = walks[1];
    expect(transferWalk.distanceMeters).toBeGreaterThan(0);
    // C-E ≈ 195m à vol d'oiseau, x1.3 de détour ≈ 254m — sous
    // TRANSFER_WALK_RADIUS_METERS (300) mais une vraie marche, pas un
    // arrondi à zéro.
    expect(transferWalk.distanceMeters).toBeGreaterThan(150);
    expect(transferWalk.distanceMeters).toBeLessThan(280);
  });

  it("aucune correspondance A -> F proposée si maxTransfers=0", async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/trip-plan?from=${A.lat},${A.lon}&to=${F.lat},${F.lon}&maxTransfers=0`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.plans.every((p: { transfersCount: number }) => p.transfersCount === 0)).toBe(true);
  });

  it('note explique la correspondance par courte marche (plus "au même arrêt physique" uniquement)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/trip-plan?from=${A.lat},${A.lon}&to=${C.lat},${C.lon}&maxTransfers=0`,
    });
    const note: string = res.json().data.note;
    expect(note).toMatch(/courte marche/i);
    expect(note).not.toMatch(/limitées à un changement au même arrêt physique/i);
  });
});
