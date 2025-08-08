import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css"; // 👏 important si tu utilises Tailwind

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
