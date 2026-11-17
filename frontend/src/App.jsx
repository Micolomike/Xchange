import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Footer from './components/Footer';
import AssistantWidget from './components/AssistantWidget';
import TermsBanner from './components/TermsBanner';
import LegalPage from './legal/LegalPage';
import AuthProvider from './auth/AuthProvider';
import ChatProvider from './chat/ChatProvider';
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
import Discussions from './pages/Discussions';
import Dashboards from './pages/analytics/Dashboards';
import DashboardView from './pages/analytics/DashboardView';
import Reports from './pages/analytics/Reports';
import ReportView from './pages/analytics/ReportView';
import ReportEditor from './pages/analytics/ReportEditor';

export default function App() {
  return (
    <BrowserRouter>
      <SettingsProvider>
      <AuthProvider>
      <ChatProvider>
        <a
          href="#contenu"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
        >
          Aller au contenu
        </a>
        <div className="flex min-h-screen flex-col">
        <ImpersonationBanner />
        <Navbar />
        <TermsBanner />
        <main id="contenu" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-8 sm:px-6">
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
            <Route path="/discussions" element={<RequireAuth><Discussions /></RequireAuth>} />
            <Route path="/discussions/:id" element={<RequireAuth><Discussions /></RequireAuth>} />
            <Route path="/analyses" element={<Navigate to="/analyses/tableaux" replace />} />
            <Route path="/analyses/tableaux" element={<RequireAuth><Dashboards /></RequireAuth>} />
            <Route path="/analyses/tableaux/:id" element={<RequireAuth><DashboardView /></RequireAuth>} />
            <Route path="/analyses/rapports" element={<RequireAuth><Reports /></RequireAuth>} />
            <Route path="/analyses/rapports/nouveau" element={<RequireAuth><ReportEditor /></RequireAuth>} />
            <Route path="/analyses/rapports/:id" element={<RequireAuth><ReportView /></RequireAuth>} />
            <Route path="/analyses/rapports/:id/modifier" element={<RequireAuth><ReportEditor /></RequireAuth>} />
            <Route path="/admin" element={<RequireAuth admin><Admin /></RequireAuth>} />
            <Route path="/admin/catalogue/:id" element={<RequireAuth admin><FormBuilder /></RequireAuth>} />
            <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
            <Route path="/mentions-legales" element={<LegalPage kind="legalNotice" />} />
            <Route path="/confidentialite" element={<LegalPage kind="privacyPolicy" />} />
            <Route path="/charte" element={<LegalPage kind="charter" />} />
            {/* Anciennes adresses de la première version */}
            <Route path="/create" element={<Navigate to="/tickets/new" replace />} />
            <Route path="/admin/data" element={<Navigate to="/admin" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <Footer />
        <AssistantWidget />
        </div>
      </ChatProvider>
      </AuthProvider>
      </SettingsProvider>
    </BrowserRouter>
  );
}
