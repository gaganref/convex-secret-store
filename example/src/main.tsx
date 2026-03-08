import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import App from "./App";
import "./index.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";

const address = import.meta.env.VITE_CONVEX_URL;

const convex = new ConvexReactClient(address);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <ConvexProvider client={convex}>
          <App />
        </ConvexProvider>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
