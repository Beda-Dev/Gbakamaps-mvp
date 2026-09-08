// =============================================================================
// Client Gemini (Google AI) minimal — appel REST direct (pas de SDK
// `@google/generative-ai` ajouté : un seul usage simple, cohérent avec le
// reste du projet qui appelle les API externes via `fetch` brut — Overpass,
// ORS, GraphHopper).
//
// Clés vérifiées réellement valides le 2026-09-08 : GET /v1beta/models a
// répondu avec la liste complète des modèles disponibles pour les deux
// clés (pas supposé). Chaîne de repli clé 1 → clé 2, même principe que
// ORS_API_KEY_2 (routing.service.ts) : une clé Google AI Studio gratuite a
// un quota par minute/jour, une seconde clé absorbe un 429 isolé sans
// jamais bloquer l'utilisateur.
//
// JAMAIS appelé depuis le frontend — les clés ne quittent jamais le
// backend (voir gemini.routes usage dans trip-planning.routes.ts : le
// frontend appelle notre propre endpoint, qui appelle Gemini côté serveur).
// =============================================================================
import { env } from '../config/env.js';
import { AppError } from './errors.js';

const GEMINI_KEYS = [env.GEMINI_API_KEY_1, env.GEMINI_API_KEY_2].filter(
  (k): k is string => !!k
);

export class GeminiUnavailableError extends AppError {
  constructor(detail?: string) {
    super('Fonctionnalité IA indisponible', 503, 'GEMINI_UNAVAILABLE', detail);
  }
}

export function isGeminiConfigured(): boolean {
  return GEMINI_KEYS.length > 0;
}

// 25s (pas 15s initialement) : vérifié empiriquement le 2026-09-08 qu'un
// appel generateContent réel peut légitimement prendre jusqu'à ~35s en cas
// de forte demande côté Google ("This model is currently experiencing high
// demand", 503 transitoire) — un timeout trop court coupait des appels qui
// auraient fini par réussir, sur les DEUX clés à la fois (mauvaise
// coïncidence, pas un vrai indisponibilité). Toujours borné : jamais une
// requête qui pendrait indéfiniment.
const REQUEST_TIMEOUT_MS = 25_000;

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

async function callGemini(apiKey: string, prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        // Température basse : on veut une reformulation fidèle des faits
        // fournis dans le prompt, pas une production créative qui
        // risquerait de dériver des données réelles transmises.
        temperature: 0.3,
        maxOutputTokens: 800,
        // `gemini-flash-latest` fait du raisonnement interne par défaut
        // ("thinking": true, vérifié via GET /v1beta/models) qui consomme
        // une part du budget `maxOutputTokens` AVANT le texte final —
        // bug réel constaté le 2026-09-08 : plusieurs réponses tronquées
        // en plein milieu d'une phrase alors que `finishReason` était
        // "MAX_TOKENS". Désactivé ici (thinkingBudget: 0) : on ne demande
        // qu'une simple reformulation de faits déjà donnés, pas un
        // raisonnement — confirmé empiriquement que ça élimine la
        // troncature et accélère nettement la réponse.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Gemini HTTP ${response.status}`);
  }

  const data = (await response.json().catch(() => null)) as GeminiResponse | null;
  // Concatène TOUTES les parties de texte, pas seulement la première — un
  // second bug réel constaté le même jour : la réponse peut être scindée
  // en plusieurs `parts`, ne lire que parts[0] tronquait silencieusement le
  // texte même quand la réponse complète était bien présente.
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? '')
    .join('')
    .trim();
  if (!text) {
    throw new Error('Réponse Gemini vide ou mal formée');
  }
  return text;
}

// Génère du texte à partir d'un prompt, avec repli clé 1 → clé 2. Lève
// GeminiUnavailableError (503) si aucune clé n'est configurée ou si toutes
// les clés échouent — jamais un 500 opaque, et jamais un plantage de la
// fonctionnalité appelante (le planificateur/etc. doivent rester
// utilisables même si la narration IA échoue).
export async function generateText(prompt: string): Promise<string> {
  if (GEMINI_KEYS.length === 0) {
    throw new GeminiUnavailableError('Aucune clé Gemini configurée');
  }

  let lastError: unknown;
  for (const key of GEMINI_KEYS) {
    try {
      return await callGemini(key, prompt);
    } catch (err) {
      lastError = err;
    }
  }
  throw new GeminiUnavailableError(lastError instanceof Error ? lastError.message : 'Échec Gemini');
}
