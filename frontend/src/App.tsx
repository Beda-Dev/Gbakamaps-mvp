import { Suspense, lazy } from 'react';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { LoaderIcon } from '@/components/icons';

// Découpage du bundle par route (phase 2, PROJECT_MEMORY.md §9) : la carte
// (MapLibre, ~1 Mo à elle seule) n'est plus chargée pour un visiteur qui va
// directement sur /login, /reports, etc. — chaque page devient un chunk
// séparé, chargé à la demande. Les pages exportent des composants nommés
// (pas de défaut) : `.then(m => ({ default: m.X }))` adapte au contrat de
// React.lazy sans changer la convention d'export existante du projet.
const HomePage = lazy(() => import('@/pages/HomePage').then((m) => ({ default: m.HomePage })));
const LoginPage = lazy(() => import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const SignupPage = lazy(() => import('@/pages/SignupPage').then((m) => ({ default: m.SignupPage })));
const FavoritesPage = lazy(() =>
  import('@/pages/FavoritesPage').then((m) => ({ default: m.FavoritesPage }))
);
const ReportsPage = lazy(() => import('@/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const AdminReportsPage = lazy(() =>
  import('@/pages/AdminReportsPage').then((m) => ({ default: m.AdminReportsPage }))
);
const TripPlannerPage = lazy(() =>
  import('@/pages/TripPlannerPage').then((m) => ({ default: m.TripPlannerPage }))
);

// Repère de chargement minimal entre deux pages — la transition doit rester
// perceptible comme volontaire (pas un écran blanc qui ressemblerait à un
// bug), sans bloquer plus que le temps réel de téléchargement du chunk.
function RouteFallback() {
  return (
    <div className="route-fallback" role="status" aria-label="Chargement de la page">
      <LoaderIcon className="icon-spin" width={28} height={28} aria-hidden="true" />
    </div>
  );
}

function withSuspense(element: React.ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>;
}

// La carte (/) reste publique : aucune redirection forcée vers /login.
// /login et /signup redirigent vers / quand l'utilisateur est déjà connecté
// (géré dans chaque page via useAuth, pas ici). /favorites redirige vers
// /login quand personne n'est connecté (géré dans la page elle-même).
const router = createBrowserRouter([
  { path: '/', element: withSuspense(<HomePage />) },
  { path: '/login', element: withSuspense(<LoginPage />) },
  { path: '/signup', element: withSuspense(<SignupPage />) },
  { path: '/favorites', element: withSuspense(<FavoritesPage />) },
  { path: '/reports', element: withSuspense(<ReportsPage />) },
  { path: '/admin/reports', element: withSuspense(<AdminReportsPage />) },
  { path: '/planifier', element: withSuspense(<TripPlannerPage />) },
]);

export function App() {
  return <RouterProvider router={router} />;
}
