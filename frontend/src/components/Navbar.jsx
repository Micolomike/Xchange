import { startTransition, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { FiLogOut, FiMenu, FiPlus, FiUser, FiX } from 'react-icons/fi';
import { useAuth } from '../auth/context';
import { Avatar } from './Badges';
import { useSettings } from '../settings/context';

export function Logo() {
  const { settings } = useSettings();
  return (
    <Link to="/" className="flex min-w-0 items-center gap-2 text-lg font-extrabold tracking-tight text-ink">
      <img src={settings.logoSrc || '/favicon.svg'} alt="" className="size-7 shrink-0 rounded object-contain" />
      <span className="truncate">{settings.appName}</span>
    </Link>
  );
}

const linkClass = ({ isActive }) =>
  `rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
    isActive ? 'bg-accent-soft text-accent-strong' : 'text-ink-soft hover:bg-ink/5 hover:text-ink'
  }`;

export default function Navbar() {
  const { user, isAdmin, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  // Referme les menus à chaque navigation.
  useEffect(() => {
    setOpen(false);
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // React Router navigue dans une transition : la session doit être effacée dans la même
  // transition, sinon la page protégée en cours redirige d'abord vers /login.
  const handleLogout = () => {
    navigate('/', { replace: true });
    startTransition(() => logout());
  };

  const links = user ? (
    <>
      <NavLink to="/" end className={linkClass}>
        Tableau de bord
      </NavLink>
      <NavLink to="/tickets" end className={linkClass}>
        Tickets
      </NavLink>
      <NavLink to="/catalogue" className={linkClass}>
        Catalogue
      </NavLink>
      {isAdmin && (
        <NavLink to="/admin" className={linkClass}>
          Administration
        </NavLink>
      )}
    </>
  ) : null;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6" aria-label="Navigation principale">
        <Logo />
        {user && <div className="hidden items-center gap-1 md:flex">{links}</div>}

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <Link to="/tickets/new" className="btn btn-primary hidden sm:inline-flex">
                <FiPlus aria-hidden="true" /> Nouveau ticket
              </Link>
              <div className="relative hidden md:block" ref={menuRef}>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold text-ink-soft hover:bg-ink/5"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((v) => !v)}
                >
                  <Avatar user={user} />
                  <span className="max-w-[10rem] truncate">{user.name}</span>
                </button>
                {menuOpen && (
                  <div role="menu" className="panel absolute right-0 mt-2 w-56 overflow-hidden py-1 shadow-lg">
                    <p className="border-b border-line px-4 py-2 text-xs text-ink-mute">
                      Connecté en tant que <span className="font-semibold text-ink">{user.username}</span>
                    </p>
                    <Link role="menuitem" to="/profile" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-paper">
                      <FiUser aria-hidden="true" /> Mon compte
                    </Link>
                    <button
                      role="menuitem"
                      type="button"
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-paper"
                    >
                      <FiLogOut aria-hidden="true" /> Se déconnecter
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                className="btn btn-ghost px-2 md:hidden"
                aria-expanded={open}
                aria-controls="mobile-menu"
                aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
                onClick={() => setOpen((v) => !v)}
              >
                {open ? <FiX className="text-xl" /> : <FiMenu className="text-xl" />}
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login" className={(s) => `${linkClass(s)} whitespace-nowrap`}>
                Se connecter
              </NavLink>
              <Link to="/register" className="btn btn-primary hidden whitespace-nowrap sm:inline-flex">
                Créer un compte
              </Link>
            </>
          )}
        </div>
      </nav>

      {user && open && (
        <div id="mobile-menu" className="border-t border-line bg-white px-4 pb-4 pt-2 md:hidden">
          <div className="flex flex-col gap-1">
            {links}
            <NavLink to="/tickets/new" className={linkClass}>
              Nouveau ticket
            </NavLink>
            <NavLink to="/profile" className={linkClass}>
              Mon compte
            </NavLink>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Avatar user={user} /> {user.name}
            </span>
            <button type="button" className="btn btn-ghost" onClick={handleLogout}>
              <FiLogOut aria-hidden="true" /> Se déconnecter
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
