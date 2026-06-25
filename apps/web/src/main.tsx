import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Register the PWA service worker (offline shell + installability). Production only.
// Surfaces an "update available" event when a new build is waiting, and reloads
// once the new worker takes control — so deploys actually reach open tabs / the
// installed PWA instead of serving a stale cached app.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        const notify = (w: ServiceWorker | null) => {
          if (w && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent('sw-waiting', { detail: reg }));
          }
        };
        if (reg.waiting) notify(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          nw?.addEventListener('statechange', () => {
            if (nw.state === 'installed') notify(nw);
          });
        });
        // poll for updates when the tab regains focus
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void reg.update().catch(() => {});
        });
      })
      .catch(() => {});

    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  });
}
