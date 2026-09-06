import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { SignupPage } from '@/pages/SignupPage';

// La carte (/) reste publique : aucune redirection forcée vers /login.
// /login et /signup redirigent vers / quand l'utilisateur est déjà connecté
// (géré dans chaque page via useAuth, pas ici).
const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
