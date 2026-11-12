import { useState } from 'preact/hooks';
import { firstEmoji, type SavedWord } from '../core/guess';
import { speak } from '../core/speech';
import { Ring } from './icons';
import { INVITE_MINUTES, type Sharing } from './sharing';
import { newId } from './store';

const PICS = ['🧑', '👩', '👨', '👧', '👦', '👶', '🧓', '🐶', '🐱', '🏠', '📍', '🍽️', '⚽', '🎵', '💊', '⭐'];

/**
 * Names and words that matter to this person. They are offered first when a clue matches the
 * note. With sharing on, a helper on another device can add to the list.
 */
export function Words({ words, sharing }: { words: SavedWord[]; sharing: Sharing }) {
  const helping = sharing.helping;
  const list = helping ? sharing.theirWords : words;
  const whose = helping ? helping.name || 'the person you are helping' : null;

  return (
    <section class="words" aria-labelledby="words-h">
      <h1 id="words-h">{helping ? `Words for ${whose}` : 'My words'}</h1>
      {helping ? (
        <div class="stripbar helping-bar">
          <span>You are adding words for <b>{whose}</b>. They appear on their device straight away.</span>
          <button class="btn btn-quiet" onClick={sharing.leave}>Stop helping</button>
        </div>
      ) : (
        <p class="lead">Names and words that matter to you. A helper can add them for you.</p>
      )}

      <AddWord onAdd={(w) => (helping ? sharing.addTheirs(w) : sharing.addWord(w))} />

      {sharing.error && <p class="note" role="alert">{sharing.error}</p>}

      {list.length === 0 ? (
        <p class="note">Nothing saved yet. Add a name above, with a note like "my granddaughter".</p>
      ) : (
        <ul class="tiles" aria-label={helping ? 'Their saved words' : 'Your saved words'}>
          {list.map((w) => (
            <li key={w.id}>
              <div class="sign sign-saved sign-row">
                <button class="sign-main" onClick={() => speak(w.word)} aria-label={`${w.word}. Tap to hear it.`}>
                  <span class="sign-pic" aria-hidden="true">{w.emoji}</span>
                  <span class="sign-word">{w.word}</span>
                  {w.note && <span class="sign-note">{w.note}</span>}
                </button>
                <button class="sign-remove" onClick={() => (helping ? sharing.removeTheirs(w.id) : sharing.removeWord(w.id))} aria-label={`Remove ${w.word}`}>×</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!helping && <ShareCard sharing={sharing} />}
      {!helping && <JoinCard sharing={sharing} />}
    </section>
  );
}

function AddWord({ onAdd }: { onAdd: (w: SavedWord) => void }) {
  const [word, setWord] = useState('');
  const [note, setNote] = useState('');
  const [pic, setPic] = useState('🧑');

  function add(e: Event) {
    e.preventDefault();
    const w = word.trim();
    if (!w) return;
    onAdd({ id: newId(), word: w.slice(0, 40), emoji: firstEmoji(pic) || '⭐', note: note.trim().slice(0, 80) });
    setWord(''); setNote('');
  }

  return (
    <form class="panel addword" onSubmit={add}>
      <label for="w-word">The word or name</label>
      <input id="w-word" class="kw" value={word} maxLength={40} placeholder="Layla" onInput={(e) => setWord((e.target as HTMLInputElement).value)} />
      <label for="w-note">Who or what is it?</label>
      <input id="w-note" class="kw" value={note} maxLength={80} placeholder="my granddaughter" onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
      <fieldset class="pics">
        <legend>Picture</legend>
        {PICS.map((p) => (
          <label class={`pic ${pic === p ? 'pic-on' : ''}`}>
            <input type="radio" name="pic" class="sr" checked={pic === p} onChange={() => setPic(p)} /><span aria-hidden="true">{p}</span>
          </label>
        ))}
      </fieldset>
      <button class="btn btn-go" type="submit" disabled={!word.trim()}>Save this word</button>
    </form>
  );
}

const spaced = (code: string) => code.replace(/(.{4})(?=.)/g, '$1 ');

/** Owner side: turn sharing on, invite a helper with a short code, see and remove helpers. */
function ShareCard({ sharing }: { sharing: Sharing }) {
  const { on, available, busy, invite, helpers } = sharing;
  return (
    <div class="card share-card">
      <h2>Let a helper add words</h2>
      {!on ? (
        <>
          <p>A family member can add names and words for you from their own phone or computer. Your words are then also kept in the cloud, so both of you see the same list.</p>
          <button class="btn btn-quiet" disabled={!available || busy} onClick={sharing.turnOn}>{busy ? <Ring size={22} spin /> : null} Turn on sharing</button>
          {!available && <p class="fine">Sharing needs the internet, and Private mode switched off.</p>}
        </>
      ) : (
        <>
          <label for="share-name">Your name, so your helper knows whose words these are</label>
          <input id="share-name" class="kw" value={sharing.name} maxLength={40} placeholder="Sam" onInput={(e) => sharing.setName((e.target as HTMLInputElement).value)} />
          {invite ? (
            <div class="invite" aria-live="polite">
              <span class="invite-label">Give this code to your helper</span>
              <span class="invite-code">{spaced(invite.code)}</span>
              <span class="fine">It works for {INVITE_MINUTES} minutes, for one helper.</span>
            </div>
          ) : (
            <button class="btn btn-quiet" disabled={!available || busy} onClick={sharing.makeInvite}>{busy ? <Ring size={22} spin /> : null} Invite a helper</button>
          )}
          {helpers.length > 0 && (
            <ul class="helpers">
              {helpers.map((h, i) => (
                <li key={h}><span>Helper {i + 1} can add and change your words.</span><button class="textlink" onClick={() => sharing.removeHelper(h)}>Remove</button></li>
              ))}
            </ul>
          )}
          <button class="textlink" onClick={sharing.turnOff}>Turn off sharing</button>
        </>
      )}
    </div>
  );
}

/** Helper side: enter someone's code. */
function JoinCard({ sharing }: { sharing: Sharing }) {
  const [code, setCode] = useState('');
  return (
    <form class="card share-card" onSubmit={async (e) => { e.preventDefault(); if (await sharing.join(code)) setCode(''); }}>
      <h2>Help someone else</h2>
      <label for="join-code">Type the code they gave you</label>
      <div class="addrow">
        <input id="join-code" class="kw code-in" value={code} placeholder="ABCD EFGH" autocomplete="off" autocapitalize="characters" spellcheck={false}
          onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
        <button class="btn btn-quiet" type="submit" disabled={!sharing.available || sharing.busy || code.trim().length < 8}>Join</button>
      </div>
    </form>
  );
}
