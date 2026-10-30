import React from "react";
import { createRoot } from "react-dom/client";
import "./styles/theme.css";
import "./styles/global.css";
import "./styles/print.css";
import App from "./App";
import { useSettings } from "./state/settings";

// Apply persisted settings before the first paint to avoid a theme flash.
useSettings.getState().apply();

// Follow the OS colour scheme when the user chose "system".
const mq = window.matchMedia("(prefers-color-scheme: dark)");
mq.addEventListener("change", () => {
  const s = useSettings.getState();
  if (s.theme === "system") s.apply();
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
