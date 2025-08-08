import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom"; // Remplacer useHistory par useNavigate

export default function TicketList() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate(); // Déclare navigate pour la navigation

  const fetchTickets = async () => {
    try {
      const res = await fetch("https://xchange-backend-pasd.onrender.com/api/tickets");
      const data = await res.json();
      setTickets(data);
    } catch (err) {
      console.error("Erreur lors du chargement des tickets :", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, []);

  const handleDelete = async (id) => {
    const confirm = window.confirm("❌ Supprimer ce ticket ?");
    if (!confirm) return;

    try {
      const res = await fetch(`https://xchange-backend-pasd.onrender.com/api/tickets/${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setTickets((prev) => prev.filter((ticket) => ticket.id !== id));
      } else {
        console.error("Erreur lors de la suppression");
      }
    } catch (err) {
      console.error("Erreur réseau :", err);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-10 text-gray-500">
        ⏳ Chargement des tickets...
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto mt-10 p-6 bg-white rounded-xl shadow-lg">
      <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">📋 Liste des tickets</h2>

      {tickets.length === 0 ? (
        <p className="text-gray-600">Aucun ticket pour le moment.</p>
      ) : (
        <ul className="space-y-4">
          {tickets.map((ticket) => (
            <li
              key={ticket.id}
              className="border p-4 rounded hover:shadow transition duration-200"
              onClick={() => navigate(`/tickets/${ticket.id}`)} // Navigue vers le détail du ticket
            >
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-semibold text-lg">{ticket.title}</h3>
                  <p className="text-gray-700">{ticket.description}</p>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-medium px-2 py-1 rounded ${
                      ticket.priority === "high"
                        ? "bg-red-100 text-red-600"
                        : ticket.priority === "medium"
                        ? "bg-yellow-100 text-yellow-600"
                        : "bg-green-100 text-green-600"
                    }`}
                  >
                    {ticket.priority || "Non défini"}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation(); // Empêche la propagation du clic pour la suppression
                      handleDelete(ticket.id);
                    }}
                    className="text-red-500 hover:text-red-700 text-lg"
                    title="Supprimer"
                  >
                    🗑️
                  </button>
                </div>
              </div>

              <div className="text-sm text-gray-500 mt-2 flex flex-wrap gap-4">
                <span>
                  📅 Créé le :{" "}
                  {new Date(ticket.created_at).toLocaleString("fr-FR")}
                </span>
                {ticket.dueDate && (
                  <span>
                    ⏰ Échéance :{" "}
                    {new Date(ticket.dueDate).toLocaleDateString("fr-FR")}
                  </span>
                )}
                {ticket.category && (
                  <span>🏷️ Catégorie : {ticket.category}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
