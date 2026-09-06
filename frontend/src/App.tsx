import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { SignupPage } from '@/pages/SignupPage';
import { FavoritesPage } from '@/pages/FavoritesPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { AdminReportsPage } from '@/pages/AdminReportsPage';

// La carte (/) reste publique : aucune redirection forcée vers /login.
// /login et /signup redirigent vers / quand l'utilisateur est déjà connecté
// (géré dans chaque page via useAuth, pas ici). /favorites redirige vers
// /login quand personne n'est connecté (géré dans la page elle-même).
const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/favorites', element: <FavoritesPage /> },
  { path: '/reports', element: <ReportsPage /> },
  { path: '/admin/reports', element: <AdminReportsPage /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
