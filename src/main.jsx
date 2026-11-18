import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

import App from './App.jsx';
import { ThemeProvider } from './lib/theme.jsx';
import { initTelemetry } from './lib/telemetry.js';
import { adoptLegacyHash } from './lib/hashCompat.js';
import { registerServiceWorker } from './lib/pwa.js';

initTelemetry();
/* Must run before the router mounts: /#/pricing becomes /pricing. */
adoptLegacyHash();

/* Production only: in dev, Vite serves unbundled modules from /src and a worker
 * would cache them, which turns every edit into a "why did nothing change".
 *
 * An available update is announced as a DOM event rather than applied. Nothing
 * reloads on its own — swapping the bundle under a live form is how a half-typed
 * portfolio edit disappears. */
if (import.meta.env.PROD) {
  registerServiceWorker({
    onUpdate: () => {
      try {
        window.dispatchEvent(new CustomEvent('cx:sw-update'));
      } catch {
        /* no CustomEvent (very old browser) — the update still applies on next load */
      }
    }
  });
}

createRoot(document.getElementById('root')).render(<ThemeProvider>
        <App />
      </ThemeProvider>);
