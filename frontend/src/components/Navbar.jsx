import { Link, useLocation } from "react-router-dom";

export default function Navbar() {
  const { pathname } = useLocation();

  const linkClass = (path) =>
    `px-4 py-2 rounded hover:bg-indigo-100 transition ${
      pathname === path ? "bg-indigo-200 text-indigo-800 font-semibold" : ""
    }`;

  return (
    <nav className="flex justify-between items-center px-6 py-3 bg-white shadow fixed top-0 left-0 right-0 z-50">
      <Link to="/" className="text-2xl font-bold text-indigo-600">
        Xchange
      </Link>
      <div className="space-x-2">
        <Link to="/" className={linkClass("/")}>
          Accueil
        </Link>
        <Link to="/admin" className={linkClass("/admin")}>
          Administration
        </Link>
        <Link to="/create" className={linkClass("/create")}>
          Nouveau ticket
        </Link>
        <Link to="/tickets" className={linkClass("/tickets")}>
          Tickets
        </Link>
      </div>
    </nav>
  );
}
