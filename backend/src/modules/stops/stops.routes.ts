// =============================================================================
// Routes du module stops.
//
// Lecture : publique (recherche, proximité, détail).
// Écriture : réservée au rôle ADMIN via `requireAdmin`, jamais publique —
// corrige la faille de l'ancien projet où PATCH /api/stops/[id] n'exigeait
// aucune authentification (cf. PROJECT_MEMORY.md §7). Un utilisateur normal
// qui veut signaler un problème sur un arrêt passe toujours par le module
// reports (modération communautaire), pas par ces endpoints.
//
// Les routes publiques ci-dessous sont inchangées : le CRUD admin s'ajoute,
// il ne remplace rien.
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireAuth } from '../../common/auth-middleware.js';
import { UnauthorizedError, ValidationError } from '../../common/errors.js';
import {
  createStopBodySchema,
  nearbyStopsQuerySchema,
  searchStopsQuerySchema,
  stopIdParamsSchema,
  stopPhotoParamsSchema,
  updateStopBodySchema,
} from './stops.schemas.js';
import {
  addStopPhoto,
  createStop,
  deleteStop,
  deleteStopPhoto,
  findById,
  findNearby,
  findStopPhotos,
  getStopDeletionImpact,
  isPhotosFeatureConfigured,
  listCommunityPhotos,
  searchStops,
  updateStop,
} from './stops.service.js';

export async function stopsRoutes(app: FastifyInstance) {
  // Recherche textuelle (nom d'arrêt ou de ligne) — écart UX comblé en
  // phase 2 (PROJECT_MEMORY.md §12) : jusqu'ici seule la proximité
  // géographique permettait de trouver un arrêt.
  app.get('/stops/search', async (request, reply) => {
    const query = searchStopsQuerySchema.parse(request.query);
    const stops = await searchStops({ query: query.q, limit: query.limit, near: query.near });
    return reply.send({ success: true, data: { stops, count: stops.length } });
  });

  app.get('/stops/nearby', async (request, reply) => {
    const query = nearbyStopsQuerySchema.parse(request.query);

    const stops = await findNearby({
      lat: query.lat,
      lon: query.lon,
      radiusMeters: query.radius,
      limit: query.limit,
      type: query.type,
      modes: query.modes,
      lineId: query.lineId,
    });

    return reply.send({
      success: true,
      data: { stops, count: stops.length, radius: query.radius },
    });
  });

  app.get('/stops/:id', async (request, reply) => {
    const { id } = stopIdParamsSchema.parse(request.params);
    const stop = await findById(id);
    return reply.send({ success: true, data: stop });
  });

  // Photos réelles à proximité (Mapillary + Panoramax, voir
  // stops.service.ts) — couverture partielle et vérifiée (§9/§12.8) :
  // Panoramax ne nécessite aucune clé, donc `configured` reste toujours
  // `true` désormais (Mapillary reste une source en plus si sa clé est
  // présente) — un tableau `photos` vide est un résultat réel ("rien
  // trouvé près de cet arrêt"), pas une fonctionnalité désactivée.
  app.get('/stops/:id/photos', async (request, reply) => {
    const { id } = stopIdParamsSchema.parse(request.params);
    const [external, community] = await Promise.all([
      findStopPhotos(id),
      listCommunityPhotos(id),
    ]);
    return reply.send({
      success: true,
      data: {
        photos: external,
        // Distinctes des photos externes : hébergées par nous (URL relative
        // /api/uploads/..., pas un CDN tiers), avec l'auteur et un vrai
        // bouton de suppression côté frontend (soi-même ou un admin).
        communityPhotos: community.map((p) => ({
          id: p.id,
          url: `/api/uploads/stop-photos/${p.filePath}`,
          createdAt: p.createdAt.toISOString(),
          uploadedByUserId: p.uploadedByUserId,
          uploadedByName: p.uploadedByName,
        })),
        configured: isPhotosFeatureConfigured(),
      },
    });
  });

  // Ajout d'une photo par un utilisateur connecté (ou un admin) — demande
  // explicite de l'utilisateur, complète les sources externes ci-dessus
  // dont la couverture reste partielle. Upload multipart (1 fichier, champ
  // "photo", 5 Mo max — voir la limite globale posée dans app.ts).
  app.post('/stops/:id/photos', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = stopIdParamsSchema.parse(request.params);
    if (!request.currentUser) throw new UnauthorizedError();

    const file = await request.file();
    if (!file) throw new ValidationError('Aucun fichier reçu (champ "photo" attendu)');

    const buffer = await file.toBuffer();
    const photo = await addStopPhoto(id, request.currentUser.id, file.mimetype, buffer);

    return reply.status(201).send({
      success: true,
      data: {
        id: photo.id,
        url: `/api/uploads/stop-photos/${photo.filePath}`,
        createdAt: photo.createdAt.toISOString(),
        uploadedByUserId: photo.uploadedByUserId,
        uploadedByName: photo.uploadedByName,
      },
    });
  });

  // Suppression réservée à l'auteur de la photo ou à un admin (vérifié dans
  // deleteStopPhoto — jamais uniquement côté route).
  app.delete('/stops/:id/photos/:photoId', { preHandler: requireAuth }, async (request, reply) => {
    const { photoId } = stopPhotoParamsSchema.parse(request.params);
    if (!request.currentUser) throw new UnauthorizedError();
    await deleteStopPhoto(photoId, request.currentUser.id, request.currentUser.role);
    return reply.send({ success: true, data: null });
  });

  // ---------------------------------------------------------------------------
  // Administration (rôle ADMIN requis)
  // ---------------------------------------------------------------------------

  // Liste ADMIN distincte de GET /stops/nearby (public) : inclut les arrêts
  // désactivés, sinon impossible de les retrouver pour les réactiver — même
  // principe que GET /admin/lines (§12.22).
  app.get('/admin/stops', { preHandler: requireAdmin }, async (request, reply) => {
    const query = nearbyStopsQuerySchema.parse(request.query);
    const stops = await findNearby({
      lat: query.lat,
      lon: query.lon,
      radiusMeters: query.radius,
      limit: query.limit,
      type: query.type,
      modes: query.modes,
      lineId: query.lineId,
      includeInactive: true,
    });
    return reply.send({
      success: true,
      data: { stops, count: stops.length, radius: query.radius },
    });
  });

  app.post('/admin/stops', { preHandler: requireAdmin }, async (request, reply) => {
    const body = createStopBodySchema.parse(request.body);
    const stop = await createStop(body);
    return reply.status(201).send({ success: true, data: stop });
  });

  app.patch('/admin/stops/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = stopIdParamsSchema.parse(request.params);
    const body = updateStopBodySchema.parse(request.body);
    const stop = await updateStop(id, body);
    return reply.send({ success: true, data: stop });
  });

  // Consulté par l'UI AVANT d'afficher la confirmation de suppression, pour
  // annoncer ce qui va réellement se passer plutôt qu'un "êtes-vous sûr ?"
  // aveugle : favoris et dessertes sont détruits en cascade, tandis que les
  // signalements survivent mais sont détachés (SetNull). Voir le détail dans
  // stops.service.ts (StopDeletionImpact).
  app.get('/admin/stops/:id/impact', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = stopIdParamsSchema.parse(request.params);
    const impact = await getStopDeletionImpact(id);
    return reply.send({ success: true, data: impact });
  });

  app.delete('/admin/stops/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = stopIdParamsSchema.parse(request.params);
    const deleted = await deleteStop(id);
    return reply.send({ success: true, data: deleted });
  });
}
