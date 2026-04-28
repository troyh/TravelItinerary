import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Itinerary from "./components/Itinerary.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Itinerary />
  </StrictMode>
);
