// Sharing saved words with a helper, through Firebase Authentication (anonymous sign-in: no
// email, no password) and Cloud Firestore. Sharing is off until the person turns it on; until
// then nothing about their words leaves the device.
//
// Data (see firestore.rules for who may do what):
//   people/{owner}                  { name?, updatedAt }
//   people/{owner}/words/{id}       { word, emoji, note, by, updatedAt }
//   people/{owner}/helpers/{helper} { code, joinedAt }
//   invites/{code}                  { owner, name, expires }
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  collection, deleteDoc, doc, getDoc, initializeFirestore, onSnapshot, persistentLocalCache,
  persistentMultipleTabManager, serverTimestamp, setDoc, Timestamp, type Firestore,
} from 'firebase/firestore';
import { firebaseApp } from './ai';
import type { SavedWord } from './guess';

let db: Firestore | null = null;

function store(): Firestore {
  // The local cache keeps the words readable offline and queues edits until the network is back.
  db ??= initializeFirestore(firebaseApp(), { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  return db;
}

/** Sign in without an account (anonymous). Resolves with this device's user id. */
export async function signIn(): Promise<string> {
  const auth = getAuth(firebaseApp());
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser.uid;
  return (await signInAnonymously(auth)).user.uid;
}

export const currentUid = () => getAuth(firebaseApp()).currentUser?.uid ?? null;

const wordsOf = (owner: string) => collection(store(), 'people', owner, 'words');

/** Live list of an owner's words, newest first. Returns a function that stops listening. */
export function watchWords(owner: string, onWords: (w: SavedWord[]) => void, onError: (e: Error) => void): () => void {
  return onSnapshot(wordsOf(owner), (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, word: String(d.get('word') ?? ''), emoji: String(d.get('emoji') ?? ''), note: String(d.get('note') ?? ''), at: (d.get('updatedAt') as Timestamp | null)?.toMillis() ?? Date.now() }));
    rows.sort((a, b) => b.at - a.at);
    onWords(rows.map(({ id, word, emoji, note }) => ({ id, word, emoji, note })));
  }, onError);
}

export async function putWord(owner: string, w: SavedWord): Promise<void> {
  const uid = await signIn();
  await setDoc(doc(wordsOf(owner), w.id), { word: w.word.slice(0, 40), emoji: w.emoji.slice(0, 16), note: w.note.slice(0, 80), by: uid, updatedAt: serverTimestamp() });
}

export async function removeWord(owner: string, id: string): Promise<void> {
  await deleteDoc(doc(wordsOf(owner), id));
}

/** Create or refresh the owner's profile (the label a helper sees). */
export async function saveProfile(name: string): Promise<string> {
  const uid = await signIn();
  await setDoc(doc(store(), 'people', uid), { name: name.slice(0, 40), updatedAt: serverTimestamp() });
  return uid;
}

// No 0/O or 1/I, so a code is easy to read out and type.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_MINUTES = 15; // keep in step with ui/sharing.ts

export function newCode(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** Make an invite code that lets one helper in. It stops working after INVITE_MINUTES. */
export async function createInvite(name: string): Promise<{ code: string; expires: number }> {
  const uid = await signIn();
  const code = newCode();
  const expires = Date.now() + INVITE_MINUTES * 60_000;
  await setDoc(doc(store(), 'invites', code), { owner: uid, name: name.slice(0, 40), expires: Timestamp.fromMillis(expires) });
  return { code, expires };
}

export async function cancelInvite(code: string): Promise<void> {
  await deleteDoc(doc(store(), 'invites', code));
}

/** Tidy what a person typed: upper case, no spaces or dashes. */
export const cleanCode = (typed: string) => typed.toUpperCase().replace(/[^A-Z0-9]/g, '');

export class InviteError extends Error {
  constructor(message: string) { super(message); this.name = 'InviteError'; }
}

/** Use a code to become a helper. Resolves with whose words these are. */
export async function joinAsHelper(typed: string): Promise<{ owner: string; name: string }> {
  const code = cleanCode(typed);
  if (!/^[A-Z2-9]{8,12}$/.test(code)) throw new InviteError('That code does not look right. It has 8 letters and numbers.');
  const uid = await signIn();
  const snap = await getDoc(doc(store(), 'invites', code));
  if (!snap.exists()) throw new InviteError('No invite has that code. Check it and try again.');
  const owner = String(snap.get('owner'));
  if (owner === uid) throw new InviteError('That is your own code. Give it to your helper.');
  if ((snap.get('expires') as Timestamp).toMillis() < Date.now()) throw new InviteError('That code has run out. Ask for a new one.');
  await setDoc(doc(store(), 'people', owner, 'helpers', uid), { code, joinedAt: serverTimestamp() });
  return { owner, name: String(snap.get('name') ?? '') };
}

/** Live list of helper ids for an owner. */
export function watchHelpers(owner: string, onHelpers: (ids: string[]) => void): () => void {
  return onSnapshot(collection(store(), 'people', owner, 'helpers'), (snap) => onHelpers(snap.docs.map((d) => d.id)), () => onHelpers([]));
}

export async function removeHelper(owner: string, helper: string): Promise<void> {
  await deleteDoc(doc(store(), 'people', owner, 'helpers', helper));
}
