import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import CreateTicket from "./pages/CreateTicket";
import TicketList from "./pages/TicketList";
import Admin from "./pages/Admin";
import TicketDetail from "./pages/TicketDetail"; // 🆕 Détail d'un ticket
import Navbar from "./components/Navbar"; // Barre de navigation
import AdminDataManager from "./pages/AdminDataManager";

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gradient-to-br from-white to-indigo-50">
        <Navbar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/create" element={<CreateTicket />} />
          <Route path="/tickets" element={<TicketList />} />
          <Route path="/tickets/:id" element={<TicketDetail />} /> {/* 🆕 Route ajoutée */}
          <Route path="/admin" element={<Admin />} />
          <Route path="/admin/data" element={<AdminDataManager />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
