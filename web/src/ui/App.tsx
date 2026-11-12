import { useEffect, useRef, useState } from 'preact/hooks';
import { cloudConfigured, settings } from '../core/ai';
import type { Guess } from '../core/guess';
import { Find } from './Find';
import { IconClose, IconCloud, IconDevice, IconFind, IconGear, IconPractice, IconSay, IconWords, Ring } from './icons';
import { Practice } from './Practice';
import { Say } from './Say';
import { newId, situationOf, useCloudUp, useDevice, useOnline, usePersisted, type Device } from './store';
import { useSharing } from './sharing';
import { Words } from './Words';

type Tab = 'find' | 'say' | 'practice' | 'words';

export function App() {
  const [s, set] = usePersisted();
  const [tab, setTab] = useState<Tab>('find');
  const [sheet, setSheet] = useState<null | 'settings' | 'how'>(null);
  const device = useDevice();
  const online = useOnline();
  const cloud = useCloudUp();
  const situation = situationOf(device.phase, online, cloud, s.privateOnly);
  const sharing = useSharing(s, set, cloudConfigured && online && !s.privateOnly);

  function save(g: Guess) {
    if (s.words.some((w) => w.word.toLowerCase() === g.word.toLowerCase())) return;
    sharing.addWord({ id: newId(), word: g.word, emoji: g.emoji || '⭐', note: '' });
  }

  return (
    <div class="shell">
      <header class="top">
        <a class="brand" href="#" onClick={(e) => { e.preventDefault(); setTab('find'); }}>
          <Ring size={34} /><span>Roundabout</span>
        </a>
        <StatusPill device={device} online={online} cloud={cloud} privateOnly={s.privateOnly} onOpen={() => setSheet('how')} />
        <button class="iconbtn" onClick={() => setSheet('settings')} aria-label="Settings"><IconGear /></button>
      </header>

      <main class="main">
        {tab === 'find' && (
          <Find saved={s.words} situation={situation} strip={s.strip}
            onUse={(w) => set((x) => (x.strip.includes(w) ? x : { ...x, strip: [...x.strip, w] }))}
            onSave={save} onWhy={() => setSheet('how')} onGoSay={() => setTab('say')} />
        )}
        {tab === 'say' && <Say strip={s.strip} situation={situation} naturalVoice={s.naturalVoice && settings.naturalVoice} onStrip={(strip) => set((x) => ({ ...x, strip }))} />}
        {tab === 'practice' && <Practice saved={s.words} situation={situation} tally={s.practice} onTally={(practice) => set((x) => ({ ...x, practice }))} />}
        {tab === 'words' && <Words words={s.words} sharing={sharing} />}
      </main>

      <nav class="tabs" aria-label="Sections">
        {([['find', 'Find a word', IconFind], ['say', 'Say a sentence', IconSay], ['practice', 'Practice', IconPractice], ['words', 'My words', IconWords]] as const).map(([id, label, Icon]) => (
          <button class={`tab ${tab === id ? 'tab-on' : ''}`} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            <Icon /><span>{label}</span>
          </button>
        ))}
      </nav>

      {sheet === 'settings' && (
        <Sheet title="Settings" onClose={() => setSheet(null)}>
          <label class="switch">
            <input type="checkbox" checked={s.privateOnly} onChange={(e) => set((x) => ({ ...x, privateOnly: (e.target as HTMLInputElement).checked }))} />
            <span><b>Private mode</b><br />Never use the cloud. Everything stays on this device.</span>
          </label>
          <label class="switch">
            <input type="checkbox" checked={s.naturalVoice} onChange={(e) => set((x) => ({ ...x, naturalVoice: (e.target as HTMLInputElement).checked }))} />
            <span><b>Natural voice for sentences</b><br />Uses the cloud when it can. Single words always use this device's voice, which is instant.</span>
          </label>
          <DeviceCard device={device} />
          <p class="fine">{s.share.on ? 'Your saved words are kept in this browser and, because sharing is on, in the cloud for your helper.' : 'Your saved words and sentences are kept in this browser only.'}</p>
          <button class="btn btn-quiet" onClick={() => setSheet('how')}>How answers are made</button>
        </Sheet>
      )}

      {sheet === 'how' && (
        <Sheet title="How answers are made" onClose={() => setSheet(null)}>
          <How device={device} online={online} cloud={cloud} privateOnly={s.privateOnly} />
        </Sheet>
      )}
    </div>
  );
}

function statusText(device: Device, online: boolean, cloud: boolean, privateOnly: boolean): { text: string; tone: 'device' | 'cloud' | 'wait' | 'off' } {
  const cloudOk = online && cloud && cloudConfigured && !privateOnly;
  if (device.phase === 'ready') return { text: online ? 'Works on this device' : 'Offline. Still works on this device', tone: 'device' };
  if (device.phase === 'loading') {
    const pct = device.progress !== null ? ` ${Math.round(device.progress * 100)}%` : '';
    return { text: cloudOk ? `Using the cloud while this device gets ready${pct}` : `Getting this device ready${pct}`, tone: 'wait' };
  }
  if (device.phase === 'checking') return { text: 'Checking this device', tone: 'wait' };
  if (cloudOk) return { text: 'Using the cloud', tone: 'cloud' };
  if (!online) return { text: 'Offline. This device has no on-device model', tone: 'off' };
  if (privateOnly) return { text: 'Private mode needs an on-device model', tone: 'off' };
  return { text: 'The cloud is resting for a minute', tone: 'off' };
}

function StatusPill({ device, online, cloud, privateOnly, onOpen }: { device: Device; online: boolean; cloud: boolean; privateOnly: boolean; onOpen: () => void }) {
  const st = statusText(device, online, cloud, privateOnly);
  return (
    <button class={`pill pill-${st.tone}`} onClick={onOpen} aria-label={`${st.text}. Tap to learn how answers are made.`}>
      {st.tone === 'wait' ? <Ring size={18} spin /> : st.tone === 'device' ? <IconDevice /> : <IconCloud />}
      <span role="status">{st.text}</span>
    </button>
  );
}

function DeviceCard({ device }: { device: Device }) {
  const { phase, progress, wake, wakeMs } = device;
  return (
    <div class="card">
      <b>On-device model</b>
      {phase === 'ready' && <p>Ready. Words are found on this device, also offline.{wakeMs ? ` It took ${(wakeMs / 1000).toFixed(0)} s to get ready.` : ''}</p>}
      {phase === 'loading' && <p>Getting ready{progress !== null ? `: ${Math.round(progress * 100)}% downloaded` : '…'} The first time can take a minute or two.</p>}
      {phase === 'offer' && (
        <>
          <p>This device can find words without the internet. That needs a one-time download of about 4 GB.</p>
          <button class="btn btn-quiet" onClick={wake}>Download the on-device model</button>
        </>
      )}
      {phase === 'none' && <p>This browser has no on-device model, so Roundabout uses the cloud. On-device needs Chrome on a recent computer.</p>}
      {phase === 'failed' && <p>The on-device model did not start. Roundabout uses the cloud for now.</p>}
      {phase === 'checking' && <p>Checking…</p>}
    </div>
  );
}

function How({ device, online, cloud, privateOnly }: { device: Device; online: boolean; cloud: boolean; privateOnly: boolean }) {
  const st = statusText(device, online, cloud, privateOnly);
  return (
    <div class="how">
      <p class="how-now"><b>Right now:</b> {st.text}.</p>
      <ol class="how-list">
        <li><span class="dot dot-saved" /><div><b>Your own words come first.</b> If a clue matches a note on one of your saved words, it is offered straight away. No model is used.</div></li>
        <li><span class="dot dot-device" /><div><b>Then this device answers.</b> Gemini Nano runs inside Chrome. It is quick, it works offline, and nothing you type or draw leaves the device.</div></li>
        <li><span class="dot dot-cloud" /><div><b>The cloud helps when it is needed.</b> If this device has no on-device model, if the model is still loading, or if you tap "None of these", {settings.cloudModel} in Google's cloud answers.</div></li>
      </ol>
      <p>Guesses while you type or draw only ever run on the device, so they cost nothing and stay private. In Private mode the cloud is never used.</p>
      <p class="fine">Built with Firebase AI Logic hybrid inference. Tile colours: green from this device, blue from the cloud, brown from your saved words.</p>
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: preact.ComponentChildren }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current!; if (!d.open) d.showModal(); }, []);
  return (
    <dialog ref={ref} class="sheet" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div class="sheet-in">
        <div class="sheet-top">
          <h2>{title}</h2>
          <button class="iconbtn" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
