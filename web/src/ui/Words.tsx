import { useState } from 'preact/hooks';
import { firstEmoji, type SavedWord } from '../core/guess';
import { speak } from '../core/speech';
import { newId } from './store';

const PICS = ['🧑', '👩', '👨', '👧', '👦', '👶', '🧓', '🐶', '🐱', '🏠', '📍', '🍽️', '⚽', '🎵', '💊', '⭐'];

/** Names and words that matter to this person. They are offered first when a clue matches the note. */
export function Words({ words, onChange }: { words: SavedWord[]; onChange: (w: SavedWord[]) => void }) {
  const [word, setWord] = useState('');
  const [note, setNote] = useState('');
  const [pic, setPic] = useState('🧑');

  function add(e: Event) {
    e.preventDefault();
    const w = word.trim();
    if (!w) return;
    onChange([{ id: newId(), word: w, emoji: firstEmoji(pic) || '⭐', note: note.trim() }, ...words.filter((x) => x.word.toLowerCase() !== w.toLowerCase())]);
    setWord(''); setNote('');
  }

  return (
    <section class="words" aria-labelledby="words-h">
      <h1 id="words-h">My words</h1>
      <p class="lead">Names and words that matter to you. A helper can add them for you.</p>

      <form class="panel addword" onSubmit={add}>
        <label for="w-word">The word or name</label>
        <input id="w-word" class="kw" value={word} placeholder="Layla" onInput={(e) => setWord((e.target as HTMLInputElement).value)} />
        <label for="w-note">Who or what is it?</label>
        <input id="w-note" class="kw" value={note} placeholder="my granddaughter" onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
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

      {words.length === 0 ? (
        <p class="note">Nothing saved yet. Add a name above, with a note like "my granddaughter".</p>
      ) : (
        <ul class="tiles" aria-label="Your saved words">
          {words.map((w) => (
            <li key={w.id}>
              <div class="sign sign-saved sign-row">
                <button class="sign-main" onClick={() => speak(w.word)} aria-label={`${w.word}. Tap to hear it.`}>
                  <span class="sign-pic" aria-hidden="true">{w.emoji}</span>
                  <span class="sign-word">{w.word}</span>
                  {w.note && <span class="sign-note">{w.note}</span>}
                </button>
                <button class="sign-remove" onClick={() => onChange(words.filter((x) => x.id !== w.id))} aria-label={`Remove ${w.word}`}>×</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
