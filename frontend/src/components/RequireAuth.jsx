import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/context';
import { ErrorState, Spinner } from './ui';

/** Protège une page : session requise, et rôle administrateur si `admin` est vrai. */
export default function RequireAuth({ children, admin = false }) {
  const { user, status, retry } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <Spinner label="Vérification de la session…" />;
  if (status === 'error') {
    return (
      <div className="px-4 py-16">
        <ErrorState
          error={{ message: "Le serveur ne répond pas pour l'instant. S'il était en veille, il redémarre en moins d'une minute." }}
          onRetry={retry}
        />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}
