import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import practice from '../../../shared/practice.json';
import { makeCues, type Cues } from '../core/find';
import type { SavedWord } from '../core/guess';
import type { Situation } from '../core/route';
import { speak } from '../core/speech';
import { IconCloud, IconDevice, IconSpeak, Ring } from './icons';

interface Card { word: string; emoji: string; note: string; own: boolean }

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Up to three of the person's own words come first; the rest are mixed with the starter words. */
function buildDeck(saved: SavedWord[]): Card[] {
  const own = shuffle(saved.map((w): Card => ({ word: w.word, emoji: w.emoji, note: w.note, own: true })));
  const starter = practice.words.map((w): Card => ({ ...w, note: '', own: false }));
  return [...own.slice(0, 3), ...shuffle([...own.slice(3), ...starter])];
}

/**
 * Naming practice with a cueing hierarchy, the way a therapist gives hints: first what it
 * means, then a sentence to finish, then the first letter, and only then the word. Getting
 * there with the smallest hint is the exercise.
 */
export function Practice({ saved, situation, tally, onTally }: { saved: SavedWord[]; situation: Situation; tally: { done: number; noHint: number }; onTally: (t: { done: number; noHint: number }) => void }) {
  const deck = useMemo(() => buildDeck(saved), []);
  const [i, setI] = useState(0);
  const [level, setLevel] = useState(0);
  const [cues, setCues] = useState<Cues | null>(null);
  const [loading, setLoading] = useState(false);
  const sit = useRef(situation);
  sit.current = situation;
  const card = deck[i % deck.length];

  // Fetch the hints as soon as the card shows, so they are ready when asked for.
  useEffect(() => {
    let live = true;
    setLevel(0);
    const firstLetter = card.word[0].toUpperCase();
    if (card.own && card.note) { setCues({ meaning: card.note, sentence: '', firstLetter, side: null, ms: 0 }); return; }
    setCues(null);
    setLoading(true);
    makeCues(card.word, sit.current)
      .then((c) => { if (live) setCues(c); })
      .catch(() => { if (live) setCues({ meaning: '', sentence: '', firstLetter, side: null, ms: 0 }); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [i]);

  const hints: Array<{ label: string; text: string }> = [];
  if (cues?.meaning) hints.push({ label: 'What it is', text: cues.meaning });
  if (cues?.sentence) hints.push({ label: 'Finish the sentence', text: cues.sentence });
  hints.push({ label: 'First letter', text: card.word[0].toUpperCase() });
  const revealed = level > hints.length;

  function next(saidIt: boolean) {
    onTally({ done: tally.done + 1, noHint: tally.noHint + (saidIt && level === 0 ? 1 : 0) });
    setI(i + 1);
  }
  function hint() {
    const nextLevel = level + 1;
    setLevel(nextLevel);
    if (nextLevel > hints.length) speak(card.word);
  }

  return (
    <section class="practice" aria-labelledby="practice-h">
      <h1 id="practice-h">Practice</h1>
      <p class="lead">Say the word out loud. Take a hint only if you need it.</p>

      <div class="panel card-panel">
        <div class="bigpic" role="img" aria-label="Picture of the word to say">{card.emoji}</div>

        <ol class="hints" aria-live="polite">
          {hints.slice(0, Math.min(level, hints.length)).map((h) => (
            <li key={h.label}><span class="hint-label">{h.label}</span><span class="hint-text">{h.text}</span></li>
          ))}
          {revealed && (
            <li class="hint-word">
              <span class="hint-label">The word</span>
              <button class="reveal" onClick={() => speak(card.word, { slow: true })} aria-label={`${card.word}. Tap to hear it slowly.`}><IconSpeak size={28} /> {card.word}</button>
            </li>
          )}
        </ol>

        {cues?.side && level > 0 && !revealed && (
          <p class={`source source-${cues.side}`}>{cues.side === 'device' ? <IconDevice /> : <IconCloud />}<span>{cues.side === 'device' ? 'Hints written on this device.' : 'Hints written in the cloud.'}</span></p>
        )}
      </div>

      <div class="practice-actions">
        {!revealed ? (
          <>
            <button class="btn btn-said" onClick={() => next(true)}>I said it</button>
            <button class="btn btn-go" onClick={hint} disabled={loading && level === 0 && !cues}>
              {loading && !cues ? <Ring size={24} spin /> : null}<span>{level === 0 ? 'Give me a hint' : level >= hints.length ? 'Show me the word' : 'Another hint'}</span>
            </button>
          </>
        ) : (
          <button class="btn btn-go" onClick={() => next(false)}>Next word</button>
        )}
      </div>

      <p class="tally">Words practised: <b>{tally.done}</b>. Said with no hint: <b>{tally.noHint}</b>.</p>
    </section>
  );
}
