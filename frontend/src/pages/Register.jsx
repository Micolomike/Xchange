import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Register() {
  const [form, setForm] = useState({
    username: "",
    password: "",
    confirmPassword: "",
    email: "",
    firstname: "",
    lastname: ""
  });
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirmPassword) {
      setError("Les mots de passe ne correspondent pas");
      return;
    }
    try {
      const { username, password, email, firstname, lastname } = form;
      const res = await fetch(
        "https://xchange-backend-pasd.onrender.com/api/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password, email, firstname, lastname })
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur lors de l'inscription");
      } else {
        // Rediriger vers la page de connexion après inscription
        navigate("/login");
      }
    } catch (err) {
      console.error(err);
      setError("Erreur réseau");
    }
  };

  return (
    <div className="max-w-md mx-auto mt-24 p-6 bg-white rounded-xl shadow">
      <h2 className="text-2xl font-bold mb-4 text-center">Inscription</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Nom d'utilisateur</label>
          <input
            type="text"
            name="username"
            value={form.username}
            onChange={handleChange}
            required
            className="w-full border px-3 py-2 rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Mot de passe</label>
          <input
            type="password"
            name="password"
            value={form.password}
            onChange={handleChange}
            required
            className="w-full border px-3 py-2 rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Confirmer le mot de passe</label>
          <input
            type="password"
            name="confirmPassword"
            value={form.confirmPassword}
            onChange={handleChange}
            required
            className="w-full border px-3 py-2 rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Email</label>
          <input
            type="email"
            name="email"
            value={form.email}
            onChange={handleChange}
            className="w-full border px-3 py-2 rounded"
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">Prénom</label>
            <input
              type="text"
              name="firstname"
              value={form.firstname}
              onChange={handleChange}
              className="w-full border px-3 py-2 rounded"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">Nom</label>
            <input
              type="text"
              name="lastname"
              value={form.lastname}
              onChange={handleChange}
              className="w-full border px-3 py-2 rounded"
            />
          </div>
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button
          type="submit"
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded"
        >
          S'inscrire
        </button>
      </form>
      <p className="text-center mt-4">
        Déjà un compte ?
        <span className="text-indigo-600 hover:underline ml-1 cursor-pointer" onClick={() => navigate("/login")}>Se connecter</span>
      </p>
    </div>
  );
}