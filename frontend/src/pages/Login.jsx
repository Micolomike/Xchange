import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch(
        "https://xchange-backend-pasd.onrender.com/api/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password })
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur lors de la connexion");
      } else {
        // Enregistrer l'utilisateur dans le stockage local (simple gestion de session côté client)
        localStorage.setItem("user", JSON.stringify(data));
        navigate("/admin");
      }
    } catch (err) {
      console.error(err);
      setError("Erreur réseau");
    }
  };

  return (
    <div className="max-w-md mx-auto mt-24 p-6 bg-white rounded-xl shadow">
      <h2 className="text-2xl font-bold mb-4 text-center">Connexion</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Nom d'utilisateur</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            className="w-full border px-3 py-2 rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Mot de passe</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full border px-3 py-2 rounded"
          />
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button
          type="submit"
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded"
        >
          Se connecter
        </button>
      </form>
      <p className="text-center mt-4">
        Pas encore de compte ?
        <span className="text-indigo-600 hover:underline ml-1 cursor-pointer" onClick={() => navigate("/register")}>S'inscrire</span>
      </p>
    </div>
  );
}