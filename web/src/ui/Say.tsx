import { useState } from 'preact/hooks';
import { isQuotaError, makeSentences, type Sentences, type Tone } from '../core/find';
import type { Situation } from '../core/route';
import { speak } from '../core/speech';
import { IconCloud, IconDevice, IconSpeak, Ring } from './icons';

const TONES: Array<{ id: Tone; label: string }> = [
  { id: 'plain', label: 'Plain' },
  { id: 'polite', label: 'Asking politely' },
  { id: 'firm', label: 'Clear and firm' },
];

/** A few key words in, whole sentences out. */
export function Say({ strip, situation, onStrip }: { strip: string[]; situation: Situation; onStrip: (words: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const [tone, setTone] = useState<Tone>('plain');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Sentences | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [said, setSaid] = useState<number | null>(null);

  function add() {
    const words = draft.split(/[,\n]+/).map((w) => w.trim()).filter(Boolean);
    if (!words.length) return;
    onStrip([...strip, ...words.filter((w) => !strip.includes(w))]);
    setDraft('');
  }

  async function make() {
    const words = [...strip, ...draft.split(/[,\n]+/).map((w) => w.trim()).filter(Boolean)];
    if (!words.length) return;
    if (draft.trim()) add();
    setBusy(true); setNote(null); setSaid(null);
    try {
      const r = await makeSentences(words, tone, situation);
      if (r.blocked) setNote(r.blocked);
      else if (!r.sentences.length) setNote('No sentence came back. Try again, or add a word.');
      setResult(r.blocked ? null : r);
    } catch (e) {
      setNote(isQuotaError(e) ? 'The cloud is resting for a minute. Try again soon.' : 'That did not work. Please try again.');
    } finally { setBusy(false); }
  }

  return (
    <section class="say" aria-labelledby="say-h">
      <h1 id="say-h">Say a sentence</h1>
      <p class="lead">Give a few key words. Roundabout builds the sentence.</p>

      <div class="panel">
        {strip.length > 0 && (
          <ul class="strip" aria-label="Your key words">
            {strip.map((w) => (
              <li key={w}><button class="stripword" onClick={() => onStrip(strip.filter((x) => x !== w))} aria-label={`Remove ${w}`}>{w} <span aria-hidden="true">×</span></button></li>
            ))}
          </ul>
        )}
        <label class="sr" for="kw">Add a key word</label>
        <div class="addrow">
          <input id="kw" class="kw" value={draft} placeholder={strip.length ? 'another word' : 'doctor, Tuesday, change'}
            onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <button class="btn btn-quiet" onClick={add} disabled={!draft.trim()}>Add</button>
        </div>

        <fieldset class="tones">
          <legend>How should it sound?</legend>
          {TONES.map((t) => (
            <label class={`tone ${tone === t.id ? 'tone-on' : ''}`}>
              <input type="radio" name="tone" class="sr" checked={tone === t.id} onChange={() => setTone(t.id)} />{t.label}
            </label>
          ))}
        </fieldset>
      </div>

      <div class="go-row">
        <button class="btn btn-go" disabled={busy || (!strip.length && !draft.trim())} onClick={make}>
          {busy ? <Ring size={26} spin /> : null}<span>{busy ? 'Writing…' : 'Make a sentence'}</span>
        </button>
      </div>

      <div class="results" aria-live="polite">
        {note && <p class="note" role="status">{note}</p>}
        {result && result.sentences.length > 0 && (
          <>
            <ul class="sentences">
              {result.sentences.map((s, i) => (
                <li key={s}>
                  <button class={`sentence sentence-${result.side ?? 'device'} ${said === i ? 'sentence-on' : ''}`} onClick={() => { setSaid(i); speak(s); }} aria-label={`${s} Tap to hear it.`}>
                    <IconSpeak size={26} /><span>{s}</span>
                  </button>
                </li>
              ))}
            </ul>
            {result.side && (
              <p class={`source source-${result.side}`}>
                {result.side === 'device' ? <IconDevice /> : <IconCloud />}
                <span>{result.side === 'device' ? `Written on this device in ${(result.ms / 1000).toFixed(1)} s. Nothing was sent.` : `Written in the cloud in ${(result.ms / 1000).toFixed(1)} s.`}</span>
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
