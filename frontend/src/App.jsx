import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AuthProvider from './auth/AuthProvider';
import SettingsProvider from './settings/SettingsProvider';
import Navbar from './components/Navbar';
import ImpersonationBanner from './components/ImpersonationBanner';
import RequireAuth from './components/RequireAuth';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import TicketList from './pages/TicketList';
import CreateTicket from './pages/CreateTicket';
import TicketDetail from './pages/TicketDetail';
import Admin from './pages/Admin';
import Profile from './pages/Profile';
import MfaSetup from './pages/MfaSetup';
import Catalog from './pages/Catalog';
import CatalogForm from './pages/CatalogForm';
import FormBuilder from './pages/admin/FormBuilder';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <BrowserRouter>
      <SettingsProvider>
      <AuthProvider>
        <a
          href="#contenu"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
        >
          Aller au contenu
        </a>
        <ImpersonationBanner />
        <Navbar />
        <main id="contenu" className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 sm:px-6">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/double-authentification" element={<MfaSetup />} />
            <Route path="/tickets" element={<RequireAuth><TicketList /></RequireAuth>} />
            <Route path="/tickets/new" element={<RequireAuth><CreateTicket /></RequireAuth>} />
            <Route path="/tickets/:id" element={<RequireAuth><TicketDetail /></RequireAuth>} />
            <Route path="/catalogue" element={<RequireAuth><Catalog /></RequireAuth>} />
            <Route path="/catalogue/:id" element={<RequireAuth><CatalogForm /></RequireAuth>} />
            <Route path="/admin" element={<RequireAuth admin><Admin /></RequireAuth>} />
            <Route path="/admin/catalogue/:id" element={<RequireAuth admin><FormBuilder /></RequireAuth>} />
            <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
            {/* Anciennes adresses de la première version */}
            <Route path="/create" element={<Navigate to="/tickets/new" replace />} />
            <Route path="/admin/data" element={<Navigate to="/admin" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </AuthProvider>
      </SettingsProvider>
    </BrowserRouter>
  );
}
