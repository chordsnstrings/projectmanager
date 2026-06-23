import { useEffect, useState } from 'react';

// The beforeinstallprompt event isn't in the standard TS lib.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * "Install app" affordance for the PWA. Renders only when the browser has
 * offered an install prompt and the app isn't already installed/standalone.
 */
export default function InstallButton({ className = '' }: { className?: string }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      // iOS Safari
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!deferred) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        await deferred.prompt();
        await deferred.userChoice.catch(() => {});
        setDeferred(null);
      }}
      className={`btn btn-sm btn-ghost ${className}`}
      title="install Cadence as an app"
    >
      ↓ Install app
    </button>
  );
}
