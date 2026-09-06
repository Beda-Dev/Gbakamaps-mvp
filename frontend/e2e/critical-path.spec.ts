// =============================================================================
// Parcours critique end-to-end (vrais services, ZÉRO mock) : backend Docker
// réel, frontend Vite réel, OpenRouteService réel, MapTiler réel.
//
// Comptes `e2e-*@example.com` restant en base après exécution : artefact de
// test ATTENDU, pas un problème (même philosophie que les tests d'intégration
// backend qui tournent contre une vraie base PostgreSQL). Base de dev, pas de
// production — aucun mécanisme de nettoyage automatique n'est construit ici,
// volontairement (complexité inutile pour ce besoin).
//
// Prérequis avant `npm run test:e2e` : `docker compose up -d` (racine) +
// `npm run dev` (frontend). Nécessite une connexion internet + clés API
// configurées (MapTiler côté frontend, OpenRouteService côté backend).
// =============================================================================
import { expect, test } from '@playwright/test';

// Géolocalisation accordée d'office, centrée sur le Plateau (Abidjan) près
// des arrêts réels : sans position, HomePage reste sur son centre par défaut
// (même quartier) mais le panneau "Itinéraire" exigerait d'activer la
// géolocalisation au lieu d'afficher les profils — ce mock de POSITION (pas
// des services) rend l'étape itinéraire testable de façon déterministe.
test.use({
  geolocation: { latitude: 5.32, longitude: -4.02 },
  permissions: ['geolocation'],
});

test('parcours critique complet', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'E2eTest123!';
  const displayName = 'E2E Test';
  const reportTitle = `E2E signalement ${Date.now()}`;

  await test.step('1. inscription', async () => {
    await page.goto('/signup');
    await page.locator('#signup-email').fill(email);
    await page.locator('#signup-displayName').fill(displayName);
    await page.locator('#signup-password').fill(password);
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    // Redirection vers la carte après inscription réussie.
    await expect(page).toHaveURL('/', { timeout: 15_000 });
    // L'utilisateur est connecté : son nom + liens visibles dans AuthStatus.
    await expect(page.locator('.auth-status__name')).toHaveText(displayName, {
      timeout: 15_000,
    });
  });

  await test.step('2. carte : marqueurs réels', async () => {
    // Rendu MapLibre réel (WebGL logiciel en headless), pas un mock.
    await page.waitForSelector('.maplibregl-marker', { timeout: 30_000 });
    await expect(page.locator('.stop-marker').first()).toBeVisible({
      timeout: 30_000,
    });
  });

  let stopName = '';
  await test.step("3. sélection d'un arrêt", async () => {
    await page.locator('.stop-marker').first().click();
    await expect(page.locator('.home__detail.is-open')).toBeVisible({
      timeout: 15_000,
    });
    const heading = page.locator('.home__detail h2');
    await expect(heading).toBeVisible({ timeout: 15_000 });
    stopName = (await heading.innerText()).trim();
    expect(stopName.length).toBeGreaterThan(0);
  });

  await test.step('4. favori', async () => {
    const favButton = page.getByRole('button', { name: 'Ajouter aux favoris' });
    await expect(favButton).toBeVisible({ timeout: 15_000 });
    await favButton.click();
    // État visuel actif après ajout.
    const activeFav = page.getByRole('button', { name: 'Retirer des favoris' });
    await expect(activeFav).toBeVisible({ timeout: 15_000 });
    await expect(activeFav).toHaveClass(/is-active/);
    // Le favori apparaît sur /favorites…
    await page.goto('/favorites');
    await expect(
      page.locator('.favorites__name', { hasText: stopName }).first(),
    ).toBeVisible({ timeout: 15_000 });
    // …puis retour à la carte.
    await page.goto('/');
    await page.waitForSelector('.stop-marker', { timeout: 30_000 });
  });

  await test.step('5. itinéraire (vrai OpenRouteService)', async () => {
    // Rouvrir le MÊME arrêt (les marqueurs sont réordonnés après rechargement
    // de la carte : on clique jusqu'à retrouver le nom mémorisé).
    const markers = page.locator('.stop-marker');
    const markerCount = await markers.count();
    let reopened = false;
    for (let i = 0; i < Math.min(markerCount, 15); i++) {
      await markers.nth(i).click();
      const heading = page.locator('.home__detail.is-open h2');
      try {
        await expect(heading).toHaveText(stopName, { timeout: 3_000 });
        reopened = true;
        break;
      } catch {
        // Pas le bon arrêt : on essaie le marqueur suivant.
      }
    }
    expect(reopened).toBe(true);

    await page.getByRole('button', { name: 'Itinéraire vers cet arrêt' }).click();
    await expect(
      page.getByRole('group', { name: 'Mode de transport' }),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Marche' }).click();
    // Résultat distance • durée calculé par le vrai OpenRouteService.
    const result = page.locator('.home__route-result');
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(result).toContainText('•');
  });

  await test.step('6. signalement', async () => {
    await page
      .getByRole('button', { name: 'Signaler un problème sur cet arrêt' })
      .click();
    await expect(page.locator('.home__report-panel')).toBeVisible({
      timeout: 15_000,
    });
    await page.locator('#report-title').fill(reportTitle);
    await page
      .locator('#report-description')
      .fill('Description de test E2E (parcours critique automatisé).');
    await page.locator('.home__report-submit').click();
    await expect(page.locator('.home__report-success')).toContainText(
      'Signalement envoyé',
      { timeout: 15_000 },
    );
    // Le signalement apparaît sur /reports avec le statut "En attente".
    await page.goto('/reports');
    const item = page.locator('.reports__item', { hasText: reportTitle });
    await expect(item).toBeVisible({ timeout: 15_000 });
    await expect(item.getByText('En attente')).toBeVisible();
  });

  await test.step('7. déconnexion', async () => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Déconnexion' }).click();
    await expect(page.getByRole('link', { name: 'Se connecter' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('.auth-status__name')).toBeHidden();
    await expect(page.getByRole('link', { name: 'Favoris' })).toBeHidden();
    await expect(page.getByRole('link', { name: 'Signalements' })).toBeHidden();
  });
});
