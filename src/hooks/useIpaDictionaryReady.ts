import { useEffect, useState } from 'react';
import { ensureIpaDictionary, isIpaDictionaryLoaded } from '../engine/ipaTranscription';

/** Loads the CMU pronouncing dictionary once (needed for expected pronunciations). */
export function useIpaDictionaryReady(enabled: boolean): boolean {
  const [ready, setReady] = useState<boolean>(() => isIpaDictionaryLoaded());
  useEffect(() => {
    if (!enabled || ready) return;
    let cancelled = false;
    void ensureIpaDictionary().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, ready]);
  return ready;
}
