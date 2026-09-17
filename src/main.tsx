import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import "./ds/ds-components.css";
import App from "./App";
import { queryClient } from "./lib/queryClient";
import { VaultProvider } from "./lib/vault/VaultProvider";
import { applyPlatformClasses, applyDevWindowTitle } from "./lib/platform";
import { applyStoredZoom } from "./hooks/useZoom";
import { registerSW } from "./pwa/registerSW";

applyPlatformClasses();
applyDevWindowTitle();
applyStoredZoom();
registerSW();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <VaultProvider>
        <App />
      </VaultProvider>
    </QueryClientProvider>
  </StrictMode>
);
