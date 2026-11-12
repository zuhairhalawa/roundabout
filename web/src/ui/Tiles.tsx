import type { Guess } from '../core/guess';
import type { Side } from '../core/find';
import { IconCloud, IconDevice, IconStar } from './icons';

const SOURCE_LABEL = { device: 'from this device', cloud: 'from the cloud', saved: 'one of your words' } as const;

/** Word tiles, drawn as signs. Green: found on this device. Blue: from the cloud. Brown: one of your saved words. */
export function Tiles({ guesses, chosen, onChoose }: { guesses: Guess[]; chosen: string | null; onChoose: (g: Guess) => void }) {
  return (
    <ul class="tiles" aria-label="Words to choose from">
      {guesses.map((g, i) => (
        <li key={`${g.word}-${g.source}`} style={{ '--i': i } as never}>
          <button class={`sign sign-${g.source} ${chosen === g.word ? 'sign-chosen' : ''}`} onClick={() => onChoose(g)} aria-pressed={chosen === g.word} aria-label={`${g.word}, ${SOURCE_LABEL[g.source]}. Tap to hear it.`}>
            <span class="sign-pic" aria-hidden="true">{g.emoji || '·'}</span>
            <span class="sign-word">{g.word}</span>
            <span class="sign-src" aria-hidden="true">{g.source === 'device' ? <IconDevice size={16} /> : g.source === 'cloud' ? <IconCloud size={16} /> : <IconStar size={16} />}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The cloud's part in an answer that this device gave. null = the cloud was not asked at all. */
export type CloudPart = 'asking' | 'short' | 'slow' | 'none' | 'failed' | null;

const CLOUD_PART: Record<Exclude<CloudPart, null>, string> = {
  asking: 'The cloud was asked too. Its words will be added in blue.',
  short: 'The clue was short, so the cloud added the blue ones.',
  slow: 'The cloud was slow, and added the blue ones when it answered.',
  none: 'The cloud was asked too, and had nothing to add.',
  failed: 'The cloud was asked too, but did not answer.',
};

/** One plain line saying where the answer came from. */
export function SourceLine({ side, ms, why, cloud = null, onWhy }: { side: Side | null; ms: number; why: string; cloud?: CloudPart; onWhy: () => void }) {
  if (!side) return null;
  const secs = (ms / 1000).toFixed(1);
  return (
    <p class={`source source-${side}`}>
      {side === 'device' ? <IconDevice /> : <IconCloud />}
      <span>{side === 'device' ? `Found on this device in ${secs} s. ${cloud ? CLOUD_PART[cloud] : 'Nothing was sent.'}` : `Found in the cloud in ${secs} s.`}</span>
      <button class="textlink" onClick={onWhy} title={why}>Why?</button>
    </p>
  );
}
