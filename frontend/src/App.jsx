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
import UserOverview from './pages/admin/UserOverview';
import NotFound from './pages/NotFound';
import Discussions from './pages/Discussions';
import Dashboards from './pages/analytics/Dashboards';
import DashboardView from './pages/analytics/DashboardView';
import Reports from './pages/analytics/Reports';
import ReportView from './pages/analytics/ReportView';
import ReportEditor from './pages/analytics/ReportEditor';
import SlaDashboard from './pages/analytics/SlaDashboard';

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
        <main id="contenu" className="shell flex-1 pb-16 pt-8">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/double-authentification" element={<MfaSetup />} />
            <Route path="/tickets" element={<RequireAuth><TicketList /></RequireAuth>} />
            <Route path="/tickets/new" element={<div className="page-narrow"><RequireAuth><CreateTicket /></RequireAuth></div>} />
            <Route path="/tickets/:id" element={<div className="page-medium"><RequireAuth><TicketDetail /></RequireAuth></div>} />
            <Route path="/catalogue" element={<RequireAuth><Catalog /></RequireAuth>} />
            <Route path="/catalogue/:id" element={<div className="page-narrow"><RequireAuth><CatalogForm /></RequireAuth></div>} />
            <Route path="/discussions" element={<RequireAuth><Discussions /></RequireAuth>} />
            <Route path="/discussions/:id" element={<RequireAuth><Discussions /></RequireAuth>} />
            <Route path="/analyses" element={<Navigate to="/analyses/tableaux" replace />} />
            <Route path="/analyses/tableaux" element={<RequireAuth><Dashboards /></RequireAuth>} />
            <Route path="/analyses/tableaux/:id" element={<RequireAuth><DashboardView /></RequireAuth>} />
            <Route path="/analyses/sla" element={<RequireAuth><SlaDashboard /></RequireAuth>} />
            <Route path="/analyses/rapports" element={<RequireAuth><Reports /></RequireAuth>} />
            <Route path="/analyses/rapports/nouveau" element={<RequireAuth><ReportEditor /></RequireAuth>} />
            <Route path="/analyses/rapports/:id" element={<RequireAuth><ReportView /></RequireAuth>} />
            <Route path="/analyses/rapports/:id/modifier" element={<RequireAuth><ReportEditor /></RequireAuth>} />
            <Route path="/admin" element={<RequireAuth admin><Admin /></RequireAuth>} />
            <Route path="/admin/catalogue/:id" element={<div className="page-medium"><RequireAuth admin><FormBuilder /></RequireAuth></div>} />
            <Route path="/admin/utilisateurs/:id" element={<RequireAuth admin><UserOverview /></RequireAuth>} />
            <Route path="/profile" element={<div className="page-narrow"><RequireAuth><Profile /></RequireAuth></div>} />
            <Route path="/mentions-legales" element={<div className="page-narrow"><LegalPage kind="legalNotice" /></div>} />
            <Route path="/confidentialite" element={<div className="page-narrow"><LegalPage kind="privacyPolicy" /></div>} />
            <Route path="/charte" element={<div className="page-narrow"><LegalPage kind="charter" /></div>} />
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
