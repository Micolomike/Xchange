import { useEffect, useState } from "react";
import Swal from "sweetalert2";

export default function AdminDataManager() {
  const [selectedTable, setSelectedTable] = useState("users");
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({});
  const [editRow, setEditRow] = useState(null);

  // Fetch data from the selected table
  const fetchTableData = async (tableName) => {
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:4000/api/admin/table/${tableName}`);
      const data = await res.json();
      setColumns(data.columns || []);
      setRows(data.rows || []);

      const defaultForm = data.columns.reduce((acc, col) => {
        if (col !== "created_at" && col !== "id") acc[col] = col === "id" ? "auto" : "";
        return acc;
      }, {});
      setFormData(defaultForm);
      setEditRow(null);
    } catch (err) {
      console.error("Error loading data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTableData(selectedTable);
  }, [selectedTable]);

  // Handle deleting a row with a confirmation dialog
  const handleDelete = async (id) => {
    const result = await Swal.fire({
      title: "Are you sure?",
      text: "This will permanently delete the ticket!",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#d33",
      cancelButtonColor: "#3085d6",
      confirmButtonText: "Yes, delete it!"
    });

    if (result.isConfirmed) {
      try {
        const res = await fetch(`http://localhost:4000/api/admin/table/${selectedTable}/${id}`, { method: "DELETE" });
        if (res.ok) {
          setRows(rows.filter((row) => row.id !== id));
          Swal.fire("Deleted!", "Your file has been deleted.", "success");
        } else {
          console.error("Deletion failed");
        }
      } catch (err) {
        console.error("Network error:", err);
      }
    }
  };

  const handleSubmit = async () => {
    const toSend = { ...formData };
    delete toSend.created_at;
    
    if (toSend.due_date) {
      const date = new Date(toSend.due_date);
      if (!isNaN(date)) {
        toSend.due_date = date.toISOString().slice(0, 10);
      }
    }

    const url = editRow ? `http://localhost:4000/api/admin/table/${selectedTable}/${editRow.id}` : `http://localhost:4000/api/${selectedTable}`;
    const method = editRow ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toSend)
      });
      if (res.ok) {
        Swal.fire("Success!", editRow ? "Ticket updated!" : "Ticket created!", "success");
        fetchTableData(selectedTable);
        setShowForm(false);
      } else {
        console.error("Error:", await res.json());
      }
    } catch (err) {
      console.error("Network error:", err);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <div className="max-w-6xl mx-auto mt-10 p-6 bg-white rounded-xl shadow">
      <h2 className="text-2xl font-bold mb-4">📊 Gestion des données</h2>
      <div className="mb-4 flex items-center gap-4">
        <label className="font-medium">Table :</label>
        <select
          value={selectedTable}
          onChange={(e) => setSelectedTable(e.target.value)}
          className="border px-3 py-2 rounded"
        >
          <option value="users">users</option>
          <option value="tickets">tickets</option>
        </select>
        <button
          onClick={() => {
            setShowForm(true);
            setEditRow(null);
            const resetForm = columns.reduce((acc, col) => {
              acc[col] = col === "id" ? "auto" : "";
              return acc;
            }, {});
            setFormData(resetForm);
          }}
          className="text-purple-600 text-xl hover:text-purple-800"
          title="Ajouter une entrée"
        >
          ➕
        </button>
      </div>

      {showForm && (
        <div className="mb-6 p-4 border rounded bg-gray-50">
          <h3 className="font-semibold mb-2">
            {editRow ? "✏️ Modifier une entrée" : "➕ Nouvelle entrée"}
          </h3>

          <div className="grid grid-cols-2 gap-4">
            {columns.map((col) => {
              if (col === "created_at") return null;
              if (col === "priority" || col === "category") {
                const options = col === "priority" ? ["low", "medium", "high"] : ["bug", "feature", "support"];
                return (
                  <div key={col}>
                    <label className="block text-sm font-medium">{col}</label>
                    <select
                      name={col}
                      value={formData[col] || ""}
                      onChange={handleInputChange}
                      className="w-full border px-2 py-1 rounded"
                    >
                      <option value="">-- Sélectionner --</option>
                      {options.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              }

              if (col === "due_date") {
                return (
                  <div key={col}>
                    <label className="block text-sm font-medium">{col}</label>
                    <input
                      type="date"
                      name={col}
                      value={formData[col] ? formData[col].slice(0, 10) : ""}
                      onChange={handleInputChange}
                      className="w-full border px-2 py-1 rounded"
                    />
                  </div>
                );
              }

              return (
                <div key={col}>
                  <label className="block text-sm font-medium">{col}</label>
                  <input
                    name={col}
                    value={formData[col] || ""}
                    onChange={handleInputChange}
                    readOnly={col === "id"}
                    className={`w-full border px-2 py-1 rounded ${col === "id" ? "bg-gray-100" : "bg-white"}`}
                  />
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={handleSubmit}
              className={`px-4 py-2 rounded border ${editRow ? "bg-orange-600 hover:bg-orange-700 text-black" : "bg-green-600 hover:bg-green-700 text-white"}`}
            >
              {editRow ? "Enregistrer" : "Créer"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="bg-gray-300 text-black px-4 py-2 rounded hover:bg-gray-400"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Chargement...</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-500">Aucune donnée à afficher.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border">
            <thead className="bg-gray-100">
              <tr>
                {columns.map((col) => (
                  <th key={col} className="border px-4 py-2 text-left">{col}</th>
                ))}
                <th className="border px-4 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  {columns.map((col) => (
                    <td key={col} className="border px-4 py-2">{row[col]}</td>
                  ))}
                  <td className="border px-4 py-2 text-center">
                    <button
                      onClick={() => {
                        setEditRow(row);
                        setFormData(row);
                        setShowForm(true);
                      }}
                      title="Modifier"
                      className="text-orange-500 hover:text-orange-700 text-lg mr-2"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleDelete(row.id)}
                      title="Supprimer"
                      className="text-red-500 hover:text-red-700 text-lg"
                    >
                      ❌
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
