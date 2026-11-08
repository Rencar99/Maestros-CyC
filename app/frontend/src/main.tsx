import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { aplicarTema, escucharSistema } from "./tema/cyc-tema";

aplicarTema();
escucharSistema();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
