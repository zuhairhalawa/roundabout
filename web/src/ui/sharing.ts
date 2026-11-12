// The sharing state machine for "My words": off by default; when on, the words live in
// Firestore so a helper on another device can add to them, and they still work offline.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { SavedWord } from '../core/guess';
// The sign-in and database code is loaded only when sharing is actually used, so people who
// never share do not download it.
const sync = () => import('../core/sync');
export const INVITE_MINUTES = 15;
import type { Saved } from './store';

export interface Sharing {
  /** Cloud set up, online and not in private mode. */
  available: boolean;
  on: boolean;
  name: string;
  helpers: string[];
  invite: { code: string; expires: number } | null;
  helping: { owner: string; name: string } | null;
  theirWords: SavedWord[];
  busy: boolean;
  error: string | null;
  turnOn: () => Promise<void>;
  turnOff: () => void;
  setName: (name: string) => void;
  makeInvite: () => Promise<void>;
  removeHelper: (id: string) => void;
  join: (code: string) => Promise<boolean>;
  leave: () => void;
  /** Add or remove one of the owner's own words (local, and in the cloud when sharing is on). */
  addWord: (w: SavedWord) => void;
  removeWord: (id: string) => void;
  /** Add or remove a word for the person being helped. */
  addTheirs: (w: SavedWord) => void;
  removeTheirs: (id: string) => void;
}

const friendly = (e: unknown) => {
  if ((e as Error)?.name === 'InviteError') return (e as Error).message;
  const msg = String((e as Error)?.message ?? e);
  if (/permission|insufficient/i.test(msg)) return 'That was not allowed. The code may have run out, or you may have been removed as a helper.';
  if (/offline|unavailable|network/i.test(msg)) return 'No connection right now. Try again when you are online.';
  return 'That did not work. Please try again.';
};

export function useSharing(s: Saved, set: (f: (s: Saved) => Saved) => void, available: boolean): Sharing {
  const [uid, setUid] = useState<string | null>(null);
  const [helpers, setHelpers] = useState<string[]>([]);
  const [invite, setInvite] = useState<{ code: string; expires: number } | null>(null);
  const [theirWords, setTheirWords] = useState<SavedWord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { on, name, helping } = s.share;
  const nameRef = useRef(name);
  nameRef.current = name;

  // Owner side: keep the local list equal to the cloud list while sharing is on.
  useEffect(() => {
    if (!on || !available) return;
    let stopWords = () => {}, stopHelpers = () => {}, live = true;
    sync().then(async (m) => {
      const id = await m.signIn();
      if (!live) return;
      setUid(id);
      stopWords = m.watchWords(id, (words) => set((x) => ({ ...x, words })), (e) => setError(friendly(e)));
      stopHelpers = m.watchHelpers(id, setHelpers);
    }).catch((e) => setError(friendly(e)));
    return () => { live = false; stopWords(); stopHelpers(); };
  }, [on, available]);

  // Helper side: watch the other person's words.
  useEffect(() => {
    if (!helping || !available) { setTheirWords([]); return; }
    let stop = () => {}, live = true;
    sync().then(async (m) => {
      await m.signIn();
      if (!live) return;
      stop = m.watchWords(helping.owner, setTheirWords, () => {
        // Access was taken away (the owner removed this helper).
        set((x) => ({ ...x, share: { ...x.share, helping: null } }));
        setError('You are no longer a helper for this person.');
      });
    }).catch((e) => setError(friendly(e)));
    return () => { live = false; stop(); };
  }, [helping?.owner, available]);

  // An invite is dropped when it runs out, and cancelled once a helper has joined with it.
  useEffect(() => {
    if (!invite) return;
    const t = setTimeout(() => setInvite(null), Math.max(0, invite.expires - Date.now()));
    return () => clearTimeout(t);
  }, [invite]);
  const helperCount = useRef(0);
  useEffect(() => {
    if (invite && helpers.length > helperCount.current) { sync().then((m) => m.cancelInvite(invite.code)).catch(() => undefined); setInvite(null); }
    helperCount.current = helpers.length;
  }, [helpers.length]);

  const turnOn = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const m = await sync();
      const id = await m.saveProfile(nameRef.current);
      // First time: copy the words already on this device up to the cloud.
      await Promise.all(s.words.map((w) => m.putWord(id, w)));
      set((x) => ({ ...x, share: { ...x.share, on: true } }));
    } catch (e) { setError(friendly(e)); } finally { setBusy(false); }
  }, [s.words]);

  const turnOff = useCallback(() => { setInvite(null); set((x) => ({ ...x, share: { ...x.share, on: false } })); }, []);

  const setName = useCallback((n: string) => {
    set((x) => ({ ...x, share: { ...x.share, name: n.slice(0, 40) } }));
  }, []);

  const makeInvite = useCallback(async () => {
    setBusy(true); setError(null);
    try { const m = await sync(); await m.saveProfile(nameRef.current); setInvite(await m.createInvite(nameRef.current)); }
    catch (e) { setError(friendly(e)); } finally { setBusy(false); }
  }, []);

  const removeHelper = useCallback((id: string) => { if (uid) sync().then((m) => m.removeHelper(uid, id)).catch((e) => setError(friendly(e))); }, [uid]);

  const join = useCallback(async (code: string) => {
    setBusy(true); setError(null);
    try {
      const who = await (await sync()).joinAsHelper(code);
      set((x) => ({ ...x, share: { ...x.share, helping: who } }));
      return true;
    } catch (e) { setError(friendly(e)); return false; } finally { setBusy(false); }
  }, []);

  const leave = useCallback(() => {
    const h = s.share.helping;
    set((x) => ({ ...x, share: { ...x.share, helping: null } }));
    if (h) sync().then(async (m) => m.removeHelper(h.owner, await m.signIn())).catch(() => undefined);
  }, [s.share.helping]);

  const addWord = useCallback((w: SavedWord) => {
    set((x) => ({ ...x, words: [w, ...x.words.filter((y) => y.id !== w.id && y.word.toLowerCase() !== w.word.toLowerCase())] }));
    if (on && available && uid) sync().then((m) => m.putWord(uid, w)).catch((e) => setError(friendly(e)));
  }, [on, available, uid]);

  const removeWord = useCallback((id: string) => {
    set((x) => ({ ...x, words: x.words.filter((y) => y.id !== id) }));
    if (on && available && uid) sync().then((m) => m.removeWord(uid, id)).catch((e) => setError(friendly(e)));
  }, [on, available, uid]);

  const addTheirs = useCallback((w: SavedWord) => { if (helping) sync().then((m) => m.putWord(helping.owner, w)).catch((e) => setError(friendly(e))); }, [helping?.owner]);
  const removeTheirs = useCallback((id: string) => { if (helping) sync().then((m) => m.removeWord(helping.owner, id)).catch((e) => setError(friendly(e))); }, [helping?.owner]);

  return { available, on, name, helpers, invite, helping, theirWords, busy, error, turnOn, turnOff, setName, makeInvite, removeHelper, join, leave, addWord, removeWord, addTheirs, removeTheirs };
}
