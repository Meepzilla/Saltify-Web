import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PwaInstallState {
  isStandalone: boolean;
  isIosOrIpad: boolean;
  canPromptInstall: boolean;
  isOnline: boolean;
  promptInstall: () => Promise<boolean>;
}

function detectIosOrIpad(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isClassicIos = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ reports Macintosh UA with multi-touch support
  const isModernIpad =
    navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return isClassicIos || isModernIpad;
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const matchStandalone = window.matchMedia?.('(display-mode: standalone)').matches;
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
  return Boolean(matchStandalone || iosStandalone);
}

/**
 * Tracks PWA installation capability on Android/Windows (beforeinstallprompt),
 * iPadOS Safari Add-to-Home-Screen detection, and real-time online/offline status.
 */
export function usePwaInstall(): PwaInstallState {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(detectStandalone);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const isIosOrIpad = detectIosOrIpad();

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
      return true;
    }
    return false;
  }, [deferredPrompt]);

  return {
    isStandalone,
    isIosOrIpad,
    canPromptInstall: deferredPrompt !== null && !isStandalone,
    isOnline,
    promptInstall,
  };
}
