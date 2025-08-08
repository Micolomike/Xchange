// Barre de navigation principale
// Utilise des classes Tailwind pour un design responsive sur mobile et desktop.
// Ajoute des liens pour l'authentification (Login/Inscription).
import { Link, useLocation } from "react-router-dom";

export default function Navbar() {
  const { pathname } = useLocation();

  // Fonction utilitaire pour le style actif
  const linkClass = (path) =>
    `px-4 py-2 rounded hover:bg-indigo-100 transition ` +
    (pathname === path ? "bg-indigo-200 text-indigo-800 font-semibold" : "");

  return (
    <nav className="px-6 py-3 bg-white shadow fixed top-0 left-0 right-0 z-50 flex flex-col sm:flex-row sm:justify-between sm:items-center">
      {/* Titre du site */}
      <Link to="/" className="text-2xl font-bold text-indigo-600 mb-2 sm:mb-0">
        Xchange
      </Link>
      {/* Liens de navigation */}
      <div className="flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-2">
        <Link to="/" className={linkClass("/")}>Accueil</Link>
        <Link to="/admin" className={linkClass("/admin")}>Administration</Link>
        <Link to="/create" className={linkClass("/create")}>Nouveau ticket</Link>
        <Link to="/tickets" className={linkClass("/tickets")}>Tickets</Link>
        {/* Liens d'authentification */}
        <Link to="/login" className={linkClass("/login")}>Connexion</Link>
        <Link to="/register" className={linkClass("/register")}>Inscription</Link>
      </div>
    </nav>
  );
}