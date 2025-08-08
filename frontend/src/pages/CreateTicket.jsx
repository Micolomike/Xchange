import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function CreateTicket() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "",
    category: "",
    dueDate: "",
    attachments: null,
  });

  const [errors, setErrors] = useState({});

  const requiredMark = <span className="text-red-500">*</span>;

  const validate = () => {
    const newErrors = {};
    if (!form.title.trim()) newErrors.title = "Le titre est requis.";
    if (!form.description.trim()) newErrors.description = "La description est requise.";
    if (!form.priority) newErrors.priority = "La priorité est requise.";
    return newErrors;
  };

  const handleChange = (e) => {
    const { name, value, type, files } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "file" ? files[0] : value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    console.log("✅ submit lancé");

    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      console.log("❌ Erreurs de validation :", validationErrors);
      return;
    }

    const ticketData = {
      ...form,
      dueDate: form.dueDate || null,
    };

    console.log("📦 Données envoyées au backend :", ticketData);

    try {
      const res = await fetch("https://xchange-backend-pasd.onrender.com/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ticketData),
      });

      if (res.ok) {
        console.log("✅ Ticket créé avec succès");
        navigate("/tickets");
      } else {
        const error = await res.json();
        console.error("❌ Erreur serveur :", error);
      }
    } catch (err) {
      console.error("❌ Erreur réseau :", err);
    }
  };

  return (
    <div className="max-w-xl mx-auto mt-10 p-6 bg-white rounded-xl shadow-lg">
      <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">🧾 Créer un ticket</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Titre */}
        <div>
          <label className="block font-medium">Titre {requiredMark}</label>
          <input
            type="text"
            name="title"
            value={form.title}
            onChange={handleChange}
            className="w-full border px-3 py-2 rounded"
          />
          {errors.title && <p className="text-red-500 text-sm">{errors.title}</p>}
        </div>

        {/* Description */}
        <div>
          <label className="block font-medium">Description {requiredMark}</label>
          <textarea
            name="description"
            value={form.description}
            onChange={handleChange}
            className="w-full border px-3 py-2 rounded"
          />
          {errors.description && <p className="text-red-500 text-sm">{errors.description}</p>}
        </div>

        {/* Priorité */}
        <div>
          <label className="block font-medium">Priorité {requiredMark}</label>
          <select
            name="priority"
            value={form.priority}
            onChange={handleChange}
            className="w-full border px-3 py-2 rounded"
          >
            <option value="">-- À définir --</option>
            <option value="low">Basse</option>
            <option value="medium">Moyenne</option>
            <option value="high">Haute</option>
          </select>
          {errors.priority && <p className="text-red-500 text-sm">{errors.priority}</p>}
        </div>

        {/* Catégorie */}
        <div>
          <label className="block font-medium">Catégorie</label>
          <select
            name="category"
            value={form.category}
            onChange={handleChange}
            className="w-full border px-3 py-2 rounded"
          >
            <option value="">-- Aucune --</option>
            <option value="bug">🐛 Bug</option>
            <option value="feature">🌟 Fonctionnalité</option>
            <option value="support">🛠 Support</option>
          </select>
        </div>

        {/* Date limite */}
        <div>
          <label className="block font-medium">Date limite souhaitée</label>
          <input
            type="date"
            name="dueDate"
            value={form.dueDate}
            onChange={handleChange}
            className="w-full border px-3 py-2 rounded"
          />
        </div>

        {/* Pièce jointe */}
        <div>
          <label className="block font-medium">Fichier joint</label>
          <input
            type="file"
            name="attachments"
            onChange={handleChange}
            className="w-full"
          />
        </div>

        {/* Bouton */}
        <button
          type="submit"
          className="w-full bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
        >
          Envoyer
        </button>
      </form>
    </div>
  );
}
