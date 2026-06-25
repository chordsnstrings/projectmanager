import { useEffect, useState } from 'react';

/**
 * Banner shown when a new build is waiting (service worker update). Clicking
 * Reload tells the waiting worker to activate, which triggers a page reload.
 */
export default function UpdateToast() {
  const [reg, setReg] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    const onWaiting = (e: Event) => setReg((e as CustomEvent<ServiceWorkerRegistration>).detail);
    window.addEventListener('sw-waiting', onWaiting);
    return () => window.removeEventListener('sw-waiting', onWaiting);
  }, []);

  if (!reg) return null;

  const reload = () => {
    if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
    else window.location.reload();
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
      <div className="card px-4 py-2.5 flex items-center gap-3 shadow-glow-brass">
        <span className="text-sm text-text">A new version is available.</span>
        <button onClick={reload} className="btn btn-sm btn-primary">
          Reload
        </button>
      </div>
    </div>
  );
}
