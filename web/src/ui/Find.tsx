import { useEffect, useRef, useState } from 'preact/hooks';
import { StaleError } from '../core/ai';
import { fillPictures, findWord, isQuotaError, moreFromCloud, nameImage, type Answer } from '../core/find';
import type { Guess, SavedWord } from '../core/guess';
import { cluesFromChips, HINTS, isCloudFirstGroup, rowsFor, type Chip } from '../core/pack';
import type { Situation } from '../core/route';
import { speak } from '../core/speech';
import { DrawPad, photoToJpeg } from './Draw';
import { IconCloud, IconDescribe, IconDevice, IconDraw, IconHints, IconPhoto, IconPlus, IconSpeak, IconStar, Ring } from './icons';
import { SourceLine, Tiles, type CloudPart } from './Tiles';

type Way = 'describe' | 'hints' | 'draw' | 'photo';

const WAYS: Array<{ id: Way; label: string; icon: typeof IconDescribe }> = [
  { id: 'describe', label: 'Describe it', icon: IconDescribe },
  { id: 'hints', label: 'Tap hints', icon: IconHints },
  { id: 'draw', label: 'Draw it', icon: IconDraw },
  { id: 'photo', label: 'Show a photo', icon: IconPhoto },
];

const EXAMPLES = ['sharp, cuts bread, kitchen', 'the man who fixes teeth', 'thing for the rain, over your head'];

/** Very short clues are the hard case for a small on-device model, so the cloud is asked to add ideas. */
const isShort = (clues: string) => clues.split(/[\s,;]+/).filter(Boolean).length <= 3;

interface Props {
  saved: SavedWord[];
  situation: Situation;
  strip: string[];
  onUse: (word: string) => void;
  onSave: (g: Guess) => void;
  onWhy: () => void;
  onGoSay: () => void;
}

export function Find({ saved, situation, strip, onUse, onSave, onWhy, onGoSay }: Props) {
  const [way, setWay] = useState<Way>('describe');
  const [text, setText] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [sketch, setSketch] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState<'find' | 'more' | null>(null);
  // A type-ahead guess is on its way and "Find the word" has not been pressed for it. The button
  // stays usable meanwhile: pressing it must never do nothing.
  const [guessing, setGuessing] = useState(false);
  const liveRun = useRef<{ clues: string; id: number } | null>(null);
  const [partial, setPartial] = useState(false); // words are still arriving
  const [cloudPart, setCloudPart] = useState<CloudPart>(null); // what the cloud did for an answer this device gave
  const [note, setNote] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false); // the answer is taking longer than usual
  const [chosen, setChosen] = useState<string | null>(null);
  const seq = useRef(0);
  const asked = useRef<string | null>(null);                              // the clues "Find the word" was last pressed for
  const shown = useRef<{ clues: string; answer: Answer } | null>(null);   // a finished on-device answer, and the clues it is for
  const sit = useRef(situation);
  sit.current = situation;
  const savedRef = useRef(saved);
  savedRef.current = saved;

  const clues = way === 'describe' ? text.trim() : way === 'hints' ? cluesFromChips(group, picked) : '';
  const picture = way === 'draw' ? sketch : way === 'photo' ? photo : null;
  const hasInput = way === 'describe' || way === 'hints' ? clues.length > 0 : Boolean(picture);

  function reset() { seq.current++; asked.current = null; shown.current = null; setAnswer(null); setChosen(null); setNote(null); setBusy(null); setPartial(false); setCloudPart(null); setWaiting(false); }

  async function run(live: boolean) {
    if (!hasInput) return;
    const hard = way === 'hints' && isCloudFirstGroup(group);
    if (live && !picture) {
      // "Find the word" was pressed for exactly these clues: a type-ahead guess that fires a
      // moment later must not replace that answer (it would also skip the cloud's help).
      if (asked.current === clues) return;
      asked.current = null;
    } else if (!live) {
      asked.current = picture ? null : clues;
      // Pressed while a type-ahead guess for these very clues is on its way: the same model is
      // not asked the same thing twice. That answer counts as the pressed one when it arrives,
      // so it gets its pictures and, for a short clue, the cloud's help.
      if (!picture && !hard && liveRun.current?.clues === clues && liveRun.current.id === seq.current) { setGuessing(false); return; }
    }
    const id = ++seq.current;
    const stale = () => id !== seq.current;
    liveRun.current = live && !picture ? { clues, id } : null;
    setGuessing(live);
    setBusy('find');
    setNote(null);
    setCloudPart(null);
    setWaiting(false);
    // A busy cloud can take many seconds. Say so, rather than leave a silent spinner.
    const slowTimer = setTimeout(() => { if (!stale()) setWaiting(true); }, 4000);
    try {
      const opts = {
        saved: savedRef.current, situation: sit.current, live, stale,
        hard,
        // Tiles appear one by one as the words stream in.
        onPartial: (guesses: Guess[], side: Answer['side']) => {
          if (stale() || !guesses.length) return;
          setPartial(true);
          setChosen(null);
          setAnswer({ guesses, side, ms: 0, firstMs: 0, mode: null, why: '', canAskCloud: false });
        },
      };
      // A type-ahead guess already answered these exact clues on this device: keep its tiles
      // instead of asking the same model the same thing again.
      const kept = !live && !picture && shown.current?.clues === clues ? shown.current.answer : null;
      const a = kept ?? (picture
        ? await nameImage({ data: picture, mimeType: way === 'draw' ? 'image/png' : 'image/jpeg', kind: way === 'draw' ? 'sketch' : 'photo' }, opts)
        : await findWord(clues, opts));
      if (stale()) return;
      // True for a pressed answer, and for a type-ahead guess that was pressed while on its way.
      const pressed = !live || (!picture && asked.current === clues);
      if (live && a.blocked) {
        // Live guesses are a bonus: say nothing when they cannot run. If the button was pressed
        // meanwhile, look the word up the ordinary way.
        if (pressed) { liveRun.current = null; void run(false); }
        return;
      }
      setPartial(false);
      setAnswer(a);
      shown.current = !picture && a.side === 'device' && a.guesses.length && !a.later ? { clues, answer: a } : null;
      // Words the picture table does not know get a picture from one short follow-up request.
      const pictures = (gs: Guess[]) => {
        if (!pressed || !gs.some((g) => !g.emoji)) return;
        fillPictures(gs, sit.current).then((filled) => { if (!stale()) setAnswer((cur) => (cur ? { ...cur, guesses: cur.guesses.map((g) => (g.emoji ? g : filled.find((x) => x.word === g.word) ?? g)) } : cur)); });
      };
      // The cloud's words join the tiles already on screen (which may have gained pictures meanwhile).
      const addFromCloud = (all: Guess[], part: CloudPart, why: string) => {
        setAnswer((cur) => {
          if (!cur) return cur;
          const have = new Set(cur.guesses.map((g) => g.word));
          return { ...cur, later: undefined, canAskCloud: false, why, guesses: [...cur.guesses, ...all.filter((g) => !have.has(g.word))] };
        });
        setCloudPart(part);
        shown.current = null;
        pictures(all);
      };
      pictures(a.guesses);
      // The cloud was slow, so this device answered first: the cloud's words are added when they arrive.
      if (a.later) {
        setBusy('more');
        setCloudPart('asking');
        a.later
          .then((all) => {
            if (stale()) return;
            if (all && all.length > a.guesses.length) addFromCloud(all, 'slow', 'The cloud was slow to answer, so this device answered first. The cloud then added its ideas.');
            else setCloudPart(all ? 'none' : 'failed');
          })
          .finally(() => { if (!stale()) setBusy(null); });
        return;
      }
      // A short clue answered on the device: the cloud adds its ideas without being asked.
      if (pressed && !picture && a.side === 'device' && a.canAskCloud && isShort(clues)) {
        setBusy('more');
        setCloudPart('asking');
        moreFromCloud(clues, a.guesses, { saved: savedRef.current, situation: sit.current })
          .then((m) => {
            if (stale()) return;
            if (m.blocked) setCloudPart(null); // the cloud could not be asked after all, so nothing was sent
            else if (m.guesses.length > a.guesses.length) addFromCloud(m.guesses, 'short', 'The clue was short, which is hard for the small on-device model, so the cloud added ideas.');
            else setCloudPart('none');
          })
          .catch(() => { if (!stale()) setCloudPart('failed'); })
          .finally(() => { if (!stale()) setBusy(null); });
      }
    } catch (e) {
      if (e instanceof StaleError || stale()) return;
      if (!live || (!picture && asked.current === clues)) setNote(friendly(e));
    } finally {
      clearTimeout(slowTimer);
      if (liveRun.current?.id === id) liveRun.current = null;
      if (!stale()) { setBusy((cur) => (cur === 'find' ? null : cur)); setPartial(false); setWaiting(false); setGuessing(false); }
    }
  }

  async function more() {
    if (!answer) return;
    const id = ++seq.current;
    setBusy('more');
    setNote(null);
    try {
      const opts = { saved: savedRef.current, situation: sit.current };
      const shown = answer.guesses;
      const a = picture
        ? await nameImage({ data: picture, mimeType: way === 'draw' ? 'image/png' : 'image/jpeg', kind: way === 'draw' ? 'sketch' : 'photo' }, { ...opts, exclude: shown.map((g) => g.word) })
        : await moreFromCloud(clues, shown, opts);
      if (id !== seq.current) return;
      if (a.blocked) { setNote(a.blocked); return; }
      const merged = picture ? [...shown, ...a.guesses] : a.guesses;
      if (merged.length === shown.length) setNote('No new ideas. Try one more clue, or another way.');
      setAnswer({ ...answer, guesses: merged, canAskCloud: false });
    } catch (e) {
      if (id === seq.current) setNote(friendly(e));
    } finally {
      if (id === seq.current) setBusy(null);
    }
  }

  // An example clue was tapped: look it up at once, as if "Find the word" had been pressed.
  const goNow = useRef(false);
  useEffect(() => {
    if (!goNow.current) return;
    goNow.current = false;
    if (way === 'describe' && text.trim()) run(false);
  }, [text]);

  // Live guesses: while typing (on-device only), and after each hint tap or pen stroke.
  useEffect(() => {
    if (way !== 'describe') return;
    if (text.trim().length < 5 || sit.current.device !== 'ready') return;
    const t = setTimeout(() => run(true), 700);
    return () => clearTimeout(t);
  }, [text, way]);

  useEffect(() => {
    if (way !== 'hints') return;
    if (!group) { reset(); return; }
    const t = setTimeout(() => run(false), 450);
    return () => clearTimeout(t);
  }, [group, picked, way]);

  useEffect(() => {
    if (way !== 'draw') return;
    if (!sketch) { reset(); return; }
    if (sit.current.device === 'ready') run(true);
  }, [sketch, way]);

  useEffect(() => { if (way === 'photo' && photo) run(false); }, [photo, way]);

  function choose(g: Guess) { setChosen(g.word); speak(g.word); }

  function toggle(rowId: string, chip: Chip) {
    const key = `${rowId}.${chip.id}`;
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
  }

  const chosenGuess = answer?.guesses.find((g) => g.word === chosen) ?? null;
  const alreadySaved = chosenGuess ? saved.some((w) => w.word.toLowerCase() === chosenGuess.word.toLowerCase()) : false;

  return (
    <section class="find" aria-labelledby="find-h">
      <h1 id="find-h">What is it like?</h1>

      <div class="find-grid">
      <div class="find-in">
      <div class="ways" role="tablist" aria-label="Ways to find the word">
        {WAYS.map((w) => (
          <button role="tab" aria-selected={way === w.id} class={`way ${way === w.id ? 'way-on' : ''}`} onClick={() => { setWay(w.id); reset(); }}>
            <w.icon size={30} /><span>{w.label}</span>
          </button>
        ))}
      </div>

      {way === 'describe' && (
        <div class="panel">
          <label class="sr" for="clues">Say anything about it: what it does, where it is, what it looks like</label>
          <textarea id="clues" class="clues" rows={2} value={text} placeholder="sharp… cuts bread… in the kitchen"
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(false); } }} />
          <p class="tip">Any words will do. Spelling does not matter.</p>
          {!text && (
            <div class="examples">
              <span>Try one:</span>
              {EXAMPLES.map((ex) => <button class="example" onClick={() => { goNow.current = true; setText(ex); }}>{ex}</button>)}
            </div>
          )}
        </div>
      )}

      {way === 'hints' && (
        <HintSteps group={group} picked={picked}
          onGroup={(id) => { setGroup(id); setPicked([]); }}
          onToggle={toggle} />
      )}

      {way === 'draw' && (
        <div class="panel">
          <DrawPad onChange={setSketch} />
          <p class="tip">A rough drawing is fine.</p>
        </div>
      )}

      {way === 'photo' && (
        <div class="panel">
          <label class="btn btn-quiet photo-pick">
            <IconPhoto /> {photo ? 'Choose another photo' : 'Take or choose a photo'}
            <input type="file" accept="image/*" capture="environment" class="sr" onChange={async (e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (!f) return;
              try { reset(); setPhoto(await photoToJpeg(f)); } catch { setNote('That photo could not be opened. Try another one.'); }
            }} />
          </label>
          {photo && <img class="photo-preview" src={`data:image/jpeg;base64,${photo}`} alt="The photo you chose" />}
        </div>
      )}

      <div class="go-row">
        <button class="btn btn-go" disabled={!hasInput || (busy === 'find' && !guessing)} onClick={() => run(false)}>
          {busy === 'find' ? <Ring size={26} spin /> : null}
          <span>{busy === 'find' ? 'Looking…' : 'Find the word'}</span>
        </button>
      </div>

      </div>

      <div class="results" aria-live="polite">
        {note && <p class="note" role="status">{note}</p>}
        {answer?.blocked && !answer.guesses.length && <p class="note" role="status">{answer.blocked}</p>}
        {/* Offline or in private mode, while the on-device model is still loading: say why it is slow. */}
        {busy === 'find' && !answer && situation.device === 'loading' && (situation.privateOnly || !situation.online || !situation.cloud) && (
          <p class="note" role="status">This device is still getting ready. The words will appear as soon as it is.</p>
        )}

        {answer && answer.guesses.length > 0 && (
          <>
            <Tiles guesses={answer.guesses} chosen={chosen} onChoose={choose} />
            {!partial && <SourceLine side={answer.side} ms={answer.ms} why={answer.why} cloud={cloudPart} onWhy={onWhy} />}

            {chosenGuess ? (
              <div class="chosen">
                <button class="btn btn-quiet" onClick={() => speak(chosenGuess.word, { slow: true })}><IconSpeak /> Say it slowly</button>
                <button class="btn btn-quiet" onClick={() => onUse(chosenGuess.word)}><IconPlus /> Use in a sentence</button>
                <button class="btn btn-quiet" disabled={alreadySaved} onClick={() => onSave(chosenGuess)}><IconStar size={22} /> {alreadySaved ? 'Saved' : 'Save to my words'}</button>
              </div>
            ) : partial ? null : (
              <div class="chosen">
                <button class="btn btn-quiet" disabled={busy === 'more'} onClick={more}>
                  {busy === 'more' ? <Ring size={22} spin /> : null} None of these
                </button>
              </div>
            )}
          </>
        )}

        {answer && !answer.blocked && answer.guesses.length === 0 && <p class="note" role="status">No ideas yet. Add one more clue.</p>}

        {busy === 'find' && waiting && !partial && situation.device !== 'loading' && (
          <p class="note" role="status">This is taking longer than usual. Still looking…</p>
        )}

        {/* Wide screens only: before the first answer, the empty side explains the sign colours. */}
        {!answer && !note && (
          <div class="waiting">
            <p class="waiting-title">Words will appear here</p>
            <ul class="legend">
              <li><span class="swatch swatch-device"><IconDevice size={18} /></span> Green: found on this device</li>
              <li><span class="swatch swatch-cloud"><IconCloud size={18} /></span> Blue: from the cloud</li>
              <li><span class="swatch swatch-saved"><IconStar size={18} /></span> Brown: one of your saved words</li>
            </ul>
          </div>
        )}
      </div>

      </div>

      {strip.length > 0 && (
        <div class="stripbar">
          <span>In your sentence: <b>{strip.join(' · ')}</b></span>
          <button class="btn btn-quiet" onClick={onGoSay}>Make a sentence</button>
        </div>
      )}
    </section>
  );
}

/**
 * Tap-to-describe, one question at a time (Semantic Feature Analysis: what group is it in,
 * where is it found, what is it for, what is it like). The clues picked so far stay on top.
 */
function HintSteps({ group, picked, onGroup, onToggle }: { group: string | null; picked: string[]; onGroup: (id: string | null) => void; onToggle: (rowId: string, chip: Chip) => void }) {
  const rows = rowsFor(group);
  const [step, setStep] = useState(0);
  const groupChip = (HINTS.group.chips as Chip[]).find((c) => c.id === group) ?? null;
  const row = rows[Math.min(step, rows.length - 1)];
  const pickedChips = rows.flatMap((r) => r.chips.filter((c) => picked.includes(`${r.id}.${c.id}`)).map((c) => ({ r, c })));

  if (!groupChip) {
    return (
      <div class="panel">
        <ChipRow ask={HINTS.group.ask} chips={HINTS.group.chips} isOn={() => false} onTap={(c) => { onGroup(c.id); setStep(0); }} />
      </div>
    );
  }
  return (
    <div class="panel">
      <div class="clueline" aria-label="Your clues so far">
        <button class="chip chip-on" onClick={() => onGroup(null)} aria-label={`${groupChip.label}. Tap to change.`}>
          <span class="chip-pic" aria-hidden="true">{groupChip.emoji}</span><span>{groupChip.label}</span><span class="chip-x" aria-hidden="true">×</span>
        </button>
        {pickedChips.map(({ r, c }) => (
          <button key={`${r.id}.${c.id}`} class="chip chip-on" onClick={() => onToggle(r.id, c)} aria-label={`${c.label}. Tap to remove.`}>
            <span class="chip-pic" aria-hidden="true">{c.emoji}</span><span>{c.label}</span><span class="chip-x" aria-hidden="true">×</span>
          </button>
        ))}
      </div>
      {row && (
        <>
          <ChipRow ask={row.ask} chips={row.chips} isOn={(c) => picked.includes(`${row.id}.${c.id}`)} onTap={(c) => onToggle(row.id, c)} />
          {rows.length > 1 && (
            <div class="stepnav">
              <button class="btn btn-quiet" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
              <span class="stepcount">{Math.min(step, rows.length - 1) + 1} of {rows.length}</span>
              <button class="btn btn-quiet" disabled={step >= rows.length - 1} onClick={() => setStep(step + 1)}>Another clue</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ChipRow({ ask, chips, isOn, onTap }: { ask: string; chips: Chip[]; isOn: (c: Chip) => boolean; onTap: (c: Chip) => void }) {
  return (
    <fieldset class="chiprow">
      <legend>{ask}</legend>
      <div class="chips">
        {chips.map((c) => (
          <button key={c.id} class={`chip ${isOn(c) ? 'chip-on' : ''}`} aria-pressed={isOn(c)} onClick={() => onTap(c)}>
            <span class="chip-pic" aria-hidden="true">{c.emoji}</span><span>{c.label}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function friendly(e: unknown): string {
  if (isQuotaError(e)) return 'The cloud is resting for a minute. Try again soon.';
  const msg = String((e as Error)?.message ?? e);
  if (/on-device model is not available|LanguageModel API not available/i.test(msg)) return 'This needs the on-device model, and it is not ready on this device.';
  if (/fetch|network|Failed to fetch/i.test(msg)) return 'No connection right now. Check the internet and try again.';
  if (/app.?check|401|403/i.test(msg)) return 'The cloud did not accept the request. Reload the page and try again.';
  return 'That did not work. Please try again.';
}
