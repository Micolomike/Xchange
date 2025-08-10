// src/components/Navbar.jsx
import { Link, useLocation } from "react-router-dom";

export default function Navbar() {
  const { pathname } = useLocation();

  // Utility function to determine active link styling
  const linkClass = (path) =>
    `px-4 py-2 rounded hover:bg-indigo-100 transition ${
      pathname === path ? "bg-indigo-200 text-indigo-800 font-semibold" : ""
    }`;

  return (
    <nav className="px-6 py-3 bg-white shadow fixed top-0 left-0 right-0 z-50 flex flex-col sm:flex-row sm:justify-between sm:items-center">
      {/* Site title */}
      <Link to="/" className="text-2xl font-bold text-indigo-600 mb-2 sm:mb-0 whitespace-nowrap">
        Xchange
      </Link>
      {/* Navigation links */}
      <div className="flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-2">
        <Link to="/" className={`${linkClass("/")} whitespace-nowrap text-sm sm:text-base`}>Accueil</Link>
        <Link to="/admin" className={`${linkClass("/admin")} whitespace-nowrap text-sm sm:text-base`}>Administration</Link>
        <Link to="/create" className={`${linkClass("/create")} whitespace-nowrap text-sm sm:text-base`}>Nouveau ticket</Link>
        <Link to="/tickets" className={`${linkClass("/tickets")} whitespace-nowrap text-sm sm:text-base`}>Tickets</Link>
      </div>
    </nav>
  );
    {/* Liens d'authentification */}
      <div className="flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-2">
        <Link to="/login" className={`${linkClass("/login")} whitespace-nowrap text-sm sm:text-base`}>Connexion</Link>
        <Link to="/register" className={`${linkClass("/register")} whitespace-nowrap text-sm sm:text-base`}>Inscription</Link>
      </div>
  
}
