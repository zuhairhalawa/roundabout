// App state kept on this device: saved words, the sentence being built, and settings.
// Also the hooks that watch the on-device model and the network.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { deviceAvailability, wakeDevice, type Availability } from '../core/ai';
import { cloudUp, onCloudChange } from '../core/find';
import type { SavedWord } from '../core/guess';
import type { DeviceState, Situation } from '../core/route';

export interface Saved {
  words: SavedWord[];
  strip: string[];          // key words for the sentence being built
  privateOnly: boolean;
  seenWelcome: boolean;
  practice: { done: number; noHint: number };
}

const KEY = 'roundabout:v1';
const fresh = (): Saved => ({ words: [], strip: [], privateOnly: false, seenWelcome: false, practice: { done: 0, noHint: 0 } });

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...fresh(), ...JSON.parse(raw) };
  } catch { /* storage blocked: start fresh */ }
  return fresh();
}

export function usePersisted(): [Saved, (f: (s: Saved) => Saved) => void] {
  const [s, set] = useState<Saved>(load);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }, [s]);
  return [s, useCallback((f: (s: Saved) => Saved) => set((prev) => f(prev)), [])];
}

export const newId = () => Math.random().toString(36).slice(2, 10);

/** offer: the model can be downloaded but is not on this device yet. */
export type Phase = 'checking' | 'none' | 'offer' | 'loading' | 'ready' | 'failed';

export interface Device {
  phase: Phase;
  availability: Availability | null;
  /** 0..1 while the model downloads, else null. */
  progress: number | null;
  wakeMs: number | null;
  /** Start (or join) the download and load the model. Call from a tap. */
  wake: () => void;
}

/** Watches the on-device model. The model is woken on the first tap, because Chrome needs a user action. */
export function useDevice(): Device {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [phase, setPhase] = useState<Phase>('checking');
  const [progress, setProgress] = useState<number | null>(null);
  const [wakeMs, setWakeMs] = useState<number | null>(null);
  const started = useRef(false);

  useEffect(() => {
    deviceAvailability().then((a) => {
      setAvailability(a);
      setPhase(a === 'available' || a === 'downloading' ? 'loading' : a === 'downloadable' ? 'offer' : 'none');
    });
  }, []);

  const wake = useCallback(() => {
    if (started.current) return;
    started.current = true;
    setPhase('loading');
    wakeDevice((p) => setProgress(p < 1 ? p : null))
      .then((ms) => { setWakeMs(ms); setProgress(null); setPhase('ready'); })
      .catch((e) => { console.warn('on-device model did not start', e); setProgress(null); setPhase('failed'); });
  }, []);

  // A model that is already on the device is woken on the first tap or key press.
  useEffect(() => {
    if (availability !== 'available' && availability !== 'downloading') return;
    const go = () => wake();
    addEventListener('pointerdown', go, { once: true });
    addEventListener('keydown', go, { once: true });
    return () => { removeEventListener('pointerdown', go); removeEventListener('keydown', go); };
  }, [availability, wake]);

  return { phase, availability, progress, wakeMs, wake };
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    addEventListener('online', on); addEventListener('offline', off);
    return () => { removeEventListener('online', on); removeEventListener('offline', off); };
  }, []);
  return online;
}

/** Re-render when the cloud is paused or comes back after a "quota used up" reply. */
export function useCloudUp(): boolean {
  const [up, setUp] = useState(cloudUp);
  useEffect(() => onCloudChange(() => setUp(cloudUp())), []);
  return up;
}

export function situationOf(phase: Phase, online: boolean, cloud: boolean, privateOnly: boolean): Situation {
  const device: DeviceState = phase === 'ready' ? 'ready' : phase === 'loading' ? 'loading' : 'none';
  return { device, online, cloud, privateOnly };
}
