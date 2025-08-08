import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

export default function TicketDetail() {
  const { id } = useParams(); // Récupère l'ID du ticket depuis l'URL
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Appel API pour récupérer le ticket par ID
    fetch(`https://xchange-backend-pasd.onrender.com/api/tickets/${id}`)
      .then((res) => res.json())
      .then((data) => {
        setTicket(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Erreur lors du chargement du ticket :", err);
        setLoading(false);
      });
  }, [id]); // Re-fetch si l'ID change

  if (loading) return <p className="text-center mt-10">Chargement...</p>;
  if (!ticket) return <p className="text-center mt-10 text-red-500">Ticket introuvable</p>;

  return (
    <div className="max-w-2xl mx-auto mt-10 p-6 bg-white rounded-xl shadow-lg">
      <h2 className="text-2xl font-bold mb-4">{ticket.title}</h2>
      <p className="mb-4">{ticket.description}</p>

      <div className="space-y-2 text-sm text-gray-700">
        <p>📅 Créé le : {new Date(ticket.created_at).toLocaleString("fr-FR")}</p>
        {ticket.due_date && (
          <p>📆 Date limite : {new Date(ticket.due_date).toLocaleDateString("fr-FR")}</p>
        )}
        {ticket.priority && <p>🚦 Priorité : {ticket.priority}</p>}
        {ticket.category && <p>🏷 Catégorie : {ticket.category}</p>}
        {ticket.attachments && <p>📎 Pièce jointe : {ticket.attachments}</p>}
      </div>
    </div>
  );
}
