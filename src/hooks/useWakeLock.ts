import { useEffect, useRef, useState } from 'react';

export type WakeLockState = {
  isSupported: boolean;
  isActive: boolean;
  toggle: () => void;
};

// Screen Wake Lock: keeps the display on while the app is visible. The OS
// releases the lock whenever the page is hidden (tab switch, screen lock),
// so we remember the user's intent and re-acquire on return.
export function useWakeLock(): WakeLockState {
  const [isActive, setIsActive] = useState(false);
  const wantedRef = useRef(false);
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const isSupported = 'wakeLock' in navigator;

  async function acquire(): Promise<void> {
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      sentinelRef.current = sentinel;
      setIsActive(true);
      sentinel.addEventListener('release', () => {
        sentinelRef.current = null;
        setIsActive(false);
      });
    } catch {
      wantedRef.current = false;
      setIsActive(false);
    }
  }

  useEffect(() => {
    function onVisibilityChange() {
      if (!document.hidden && wantedRef.current && sentinelRef.current === null) {
        void acquire();
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  function toggle() {
    if (wantedRef.current) {
      wantedRef.current = false;
      void sentinelRef.current?.release();
      setIsActive(false);
    } else {
      wantedRef.current = true;
      void acquire();
    }
  }

  return { isSupported, isActive, toggle };
}
