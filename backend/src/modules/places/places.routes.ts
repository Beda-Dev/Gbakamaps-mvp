// =============================================================================
// Routes du module places — public, lecture seule.
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { nearbyPoisQuerySchema, searchPlacesQuerySchema } from './places.schemas.js';
import { listNeighborhoods, searchNearbyPois, searchPlaces } from './places.service.js';

export async function placesRoutes(app: FastifyInstance) {
  app.get('/places/search', async (request, reply) => {
    const query = searchPlacesQuerySchema.parse(request.query);
    const places = await searchPlaces(query.q, query.limit);
    return reply.send({ success: true, data: { places, count: places.length } });
  });

  // Points d'intérêt à proximité d'un point (typiquement un arrêt) — enrichit
  // le panneau détail sans mélanger ces résultats avec les arrêts/lignes
  // réels (catégorie explicite, jamais présentée comme un arrêt de transport).
  app.get('/places/nearby', async (request, reply) => {
    const query = nearbyPoisQuerySchema.parse(request.query);
    const pois = await searchNearbyPois(query.lat, query.lon, query.radius, query.categories);
    return reply.send({ success: true, data: { pois, count: pois.length } });
  });

  // Quartiers du Grand Abidjan (étiquetage de zones sur la carte).
  app.get('/places/neighborhoods', async (_request, reply) => {
    const neighborhoods = await listNeighborhoods();
    return reply.send({ success: true, data: { neighborhoods, count: neighborhoods.length } });
  });
}
