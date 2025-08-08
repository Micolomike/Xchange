import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import StatCard from "../components/StatCard"; // adapte si besoin

export default function Admin() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await fetch("http://localhost:4000/api/logs/deleted");
        const data = await res.json();
        setLogs(data);
      } catch (err) {
        console.error("Erreur lors du chargement des logs :", err);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, []);

  return (
    <div className="max-w-5xl mx-auto mt-10 p-6 bg-white rounded-xl shadow">
      <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
        🛠️ Logs d'administration
      </h2>

      {/* 🧱 Tuiles statistiques */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <StatCard
          title="Tickets supprimés"
          value={logs.length}
          icon="🗑️"
          color="red"
        />

        {/* 👉 Tuile "Gestion des données" */}
        <Link to="/admin/data">
          <StatCard
            title="Gestion des données"
            value="Accéder"
            icon="📊"
            color="indigo"
          />
        </Link>
      </div>

      {/* 🧾 Liste des suppressions */}
      {loading ? (
        <p className="text-gray-500">Chargement...</p>
      ) : logs.length === 0 ? (
        <p className="text-gray-500">Aucun ticket supprimé pour l’instant.</p>
      ) : (
        <ul className="space-y-3">
          {logs.map((log, index) => (
            <li key={index} className="border p-3 rounded bg-gray-50">
              <p className="font-medium">
                🗑️ Ticket supprimé :{" "}
                <span className="text-red-600">{log.title}</span>
              </p>
              <p className="text-sm text-gray-500">
                ID : {log.id} — supprimé le{" "}
                {new Date(log.deleted_at).toLocaleString("fr-FR")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
