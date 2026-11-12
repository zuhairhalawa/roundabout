import { describe, expect, it } from 'vitest';
import { cluesFromChips, fill, HINTS, isCloudFirstGroup, PACK, rowsFor } from '../src/core/pack';
import { applySaved, firstEmoji, matchSaved, mergeGuesses, normaliseWord, parseGuesses, parsePartialGuesses, wordKey, type SavedWord } from '../src/core/guess';
import { pictureFor, setPictures } from '../src/core/pictures';
import { route, type Situation } from '../src/core/route';

describe('prompt pack', () => {
  it('fills placeholders and leaves unknown ones', () => {
    expect(fill('Clues: {clues} ({count})', { clues: 'sharp, kitchen', count: 6 })).toBe('Clues: sharp, kitchen (6)');
    expect(fill('{a} {b}', { a: 'x' })).toBe('x {b}');
  });

  it('has a system prompt and schema for every task', () => {
    expect(PACK.find.system).toContain('{count}');
    expect(PACK.schemas.words.properties.words.type).toBe('array');
    expect(PACK.schemas.words.properties.words.items.type).toBe('string');
    expect(PACK.sentences.count).toBe(3);
    expect(PACK.cue.user).toContain('{word}');
  });

  it('every hint chip has a label, an emoji and a clue, with unique ids per row', () => {
    const rows = [{ id: 'group', chips: HINTS.group.chips }, ...Object.values(HINTS.rows).flat()];
    expect(rows.length).toBeGreaterThan(12);
    for (const row of rows) {
      const ids = row.chips.map((c) => c.id);
      expect(new Set(ids).size, `duplicate ids in ${row.id}`).toBe(ids.length);
      for (const c of row.chips) {
        expect(c.label.length).toBeGreaterThan(1);
        expect(c.clue.length).toBeGreaterThan(3);
        expect(firstEmoji(c.emoji) || c.emoji, `${row.id}.${c.id}`).toBeTruthy();
      }
    }
    // every group has follow-up rows
    for (const g of HINTS.group.chips) expect(rowsFor(g.id).length, g.id).toBeGreaterThan(0);
  });

  it('turns tapped chips into a clue line', () => {
    expect(cluesFromChips('thing', ['where.kitchen', 'use.cut', 'look.sharp']))
      .toBe('it is an object; you find it in the kitchen; you use it to cut; it is sharp');
    expect(cluesFromChips('person', [])).toBe('it is a person');
    expect(cluesFromChips(null, ['where.kitchen'])).toBe('');
  });
});

describe('guesses', () => {
  it('finds the first emoji as a whole grapheme', () => {
    expect(firstEmoji('🔑 key')).toBe('🔑');
    expect(firstEmoji('flag 🇦🇪!')).toBe('🇦🇪');
    expect(firstEmoji('👨‍👩‍👧 family')).toBe('👨‍👩‍👧');
    expect(firstEmoji('no emoji')).toBe('');
  });

  it('cleans words', () => {
    expect(normaliseWord('  "The Key." ')).toBe('Key');
    expect(normaliseWord('1. a washing machine')).toBe('washing machine');
    expect(normaliseWord('🔑 key')).toBe('key');
    expect(wordKey('Flip-Flops')).toBe(wordKey('flip flops'));
  });

  it('parses the schema shape, drops repeats and excluded words, and limits the count', () => {
    const text = JSON.stringify({ guesses: [
      { word: 'Key', emoji: '🔑' }, { word: 'key', emoji: '🗝️' }, { word: 'Lock', emoji: '🔒 lock' },
      { word: 'a door handle', emoji: '' }, { word: '', emoji: '❓' }, { word: 'Padlock', emoji: '🔐' },
    ] });
    const g = parseGuesses(text, 'device', { limit: 3, exclude: ['lock'] });
    expect(g).toEqual([
      { word: 'key', emoji: '🔑', source: 'device' },
      { word: 'door handle', emoji: '', source: 'device' },
      { word: 'padlock', emoji: '🔐', source: 'device' },
    ]);
  });

  it('parses the short shape and takes pictures from the look-up table', () => {
    setPictures({ key: '🔑', clock: '🕰️', sock: '🧦', 'alarm clock': '⏰', gear: '⚙️', lion: '🦁' });
    const g = parseGuesses('{"words": ["key", "clock", "alarm clock", "socks", "gizmo"]}', 'device', { limit: 6, picture: pictureFor });
    expect(g.map((x) => `${x.word}${x.emoji}`)).toEqual(['key🔑', 'clock🕰️', 'alarm clock⏰', 'socks🧦', 'gizmo']);
    expect(pictureFor('nothing here')).toBe('');
    // A phrase never borrows the picture of its last word: that would mislead.
    expect(pictureFor('rain gear')).toBe('');
    expect(pictureFor('sea lion')).toBe('');
    expect(pictureFor('Alarm Clocks')).toBe('⏰');
  });

  it('shows the words that are complete while the reply is still arriving', () => {
    const opts = { limit: 6 };
    expect(parsePartialGuesses('{"wor', 'device', opts)).toEqual([]);
    expect(parsePartialGuesses('{"words": ["ke', 'device', opts)).toEqual([]);
    expect(parsePartialGuesses('{"words": ["key"', 'device', opts)).toEqual([]);               // not known to be complete yet
    expect(parsePartialGuesses('{"words": ["key", "lo', 'device', opts).map((g) => g.word)).toEqual(['key']);
    expect(parsePartialGuesses('{"words": ["key", "door \\"lock\\"", "latch"]}', 'cloud', opts).map((g) => g.word)).toEqual(['key', 'door "lock', 'latch']);
    expect(parsePartialGuesses('{"words": ["key", "key", "lock"', 'device', opts).map((g) => g.word)).toEqual(['key']);
  });

  it('copes with a model that ignores the schema', () => {
    expect(parseGuesses('```json\n["umbrella", "raincoat"]\n```', 'cloud', { limit: 6 }).map((g) => g.word)).toEqual(['umbrella', 'raincoat']);
    expect(parseGuesses('umbrella, raincoat\nhood', 'cloud', { limit: 6 }).map((g) => g.word)).toEqual(['umbrella', 'raincoat', 'hood']);
    expect(parseGuesses('', 'cloud', { limit: 6 })).toEqual([]);
  });

  it('keeps names capitalised and drops over-long answers', () => {
    const text = JSON.stringify({ guesses: [{ word: 'Kate Winslet', emoji: '🎬' }, { word: 'actress', emoji: '🎭' }, { word: 'this is a very long sentence and not a word at all', emoji: '' }] });
    expect(parseGuesses(text, 'cloud', { limit: 6 }).map((g) => g.word)).toEqual(['Kate Winslet', 'actress']);
  });

  it('adds cloud guesses after what is already on screen', () => {
    const shown = parseGuesses('["key","lock"]', 'device', { limit: 6 });
    const more = parseGuesses('["Lock","latch","bolt"]', 'cloud', { limit: 6 });
    const merged = mergeGuesses(shown, more, 4);
    expect(merged.map((g) => `${g.word}:${g.source}`)).toEqual(['key:device', 'lock:device', 'latch:cloud', 'bolt:cloud']);
  });

  const saved: SavedWord[] = [
    { id: '1', word: 'Omar', emoji: '👨', note: "my daughter's husband" },
    { id: '2', word: 'Layla', emoji: '👧', note: 'granddaughter' },
    { id: '3', word: 'Corniche', emoji: '🌊', note: 'where I walk by the sea' },
  ];

  it('matches saved words from their notes without any model', () => {
    expect(matchSaved('daughter husband', saved).map((g) => g.word)).toEqual(['Omar']);
    expect(matchSaved('walk sea', saved)[0]).toEqual({ word: 'Corniche', emoji: '🌊', source: 'saved' });
    expect(matchSaved('sharp, cuts bread', saved)).toEqual([]);
    expect(matchSaved('', saved)).toEqual([]);
  });

  it('shows a guessed saved word the way it was saved', () => {
    const g = applySaved([{ word: 'omar', emoji: '🙂', source: 'device' }, { word: 'son', emoji: '👦', source: 'device' }], saved);
    expect(g[0]).toEqual({ word: 'Omar', emoji: '👨', source: 'device' });
    expect(g[1].word).toBe('son');
  });
});

describe('routing', () => {
  const base: Situation = { device: 'ready', online: true, cloud: true, privateOnly: false };

  it('answers short jobs on the device first when the model is ready', () => {
    for (const task of ['find', 'image', 'sentences', 'cue'] as const) {
      const r = route(task, base);
      expect(r.mode).toBe('prefer_on_device');
      expect(r.canAskCloud).toBe(true);
    }
  });

  it('asks the cloud first for actions and feelings, where the on-device model is weak, but only when the cloud can be used', () => {
    expect(route('hard', base)).toMatchObject({ mode: 'prefer_in_cloud', canAskCloud: false });
    expect(route('hard', { ...base, online: false }).mode).toBe('prefer_on_device');
    expect(route('hard', { ...base, cloud: false }).mode).toBe('prefer_on_device');
    expect(route('hard', { ...base, privateOnly: true }).mode).toBe('only_on_device');
    expect(route('hard', { ...base, device: 'none' }).mode).toBe('prefer_on_device');
    expect(route('hard', { ...base, device: 'loading' }).mode).toBe('prefer_in_cloud');
  });

  it('marks the hint groups that go to the cloud first', () => {
    expect(isCloudFirstGroup('action')).toBe(true);
    expect(isCloudFirstGroup('feeling')).toBe(true);
    expect(isCloudFirstGroup('thing')).toBe(false);
    expect(isCloudFirstGroup(null)).toBe(false);
  });

  it('uses the cloud first while the on-device model is still loading, and waits for it when offline', () => {
    expect(route('find', { ...base, device: 'loading' }).mode).toBe('prefer_in_cloud');
    expect(route('find', { ...base, device: 'loading', online: false }).mode).toBe('only_on_device');
  });

  it('falls back to the cloud on a device with no model, and says so when there is nothing to use', () => {
    expect(route('find', { ...base, device: 'none' }).mode).toBe('prefer_on_device');
    const stuck = route('find', { ...base, device: 'none', online: false });
    expect(stuck.mode).toBeNull();
    expect(stuck.why).toMatch(/offline/);
  });

  it('keeps working on the device when the cloud quota is used up or the network is gone', () => {
    expect(route('find', { ...base, cloud: false })).toMatchObject({ mode: 'prefer_on_device', canAskCloud: false });
    expect(route('find', { ...base, online: false })).toMatchObject({ mode: 'prefer_on_device', canAskCloud: false });
  });

  it('never spends cloud requests on live guesses', () => {
    expect(route('live', base).mode).toBe('only_on_device');
    expect(route('live', { ...base, device: 'none' }).mode).toBeNull();
    expect(route('live', { ...base, device: 'loading' }).mode).toBeNull();
  });

  it('sends second opinions, speech and audio to the cloud only', () => {
    for (const task of ['more', 'listen', 'voice'] as const) {
      expect(route(task, base).mode).toBe('only_in_cloud');
      expect(route(task, { ...base, online: false }).mode).toBeNull();
      expect(route(task, { ...base, cloud: false }).mode).toBeNull();
    }
  });

  it('prefers the cloud for long messages and falls back to the device', () => {
    expect(route('long', base).mode).toBe('prefer_in_cloud');
    expect(route('long', { ...base, online: false }).mode).toBe('only_on_device');
    expect(route('long', { ...base, online: false, device: 'none' }).mode).toBeNull();
  });

  it('private mode never leaves the device', () => {
    const p = { ...base, privateOnly: true };
    for (const task of ['find', 'image', 'sentences', 'cue', 'live', 'long'] as const) expect(route(task, p).mode).toBe('only_on_device');
    for (const task of ['more', 'listen', 'voice'] as const) expect(route(task, p).mode).toBeNull();
    expect(route('find', { ...p, device: 'none' }).mode).toBeNull();
    expect(route('find', p).canAskCloud).toBe(false);
  });
});

import { applyPromptOverrides, applyRemote, REMOTE_DEFAULTS } from '../src/core/remote';
import { settings } from '../src/core/ai';

describe('remote settings', () => {
  it('applies valid values and reports what changed', () => {
    const changed = applyRemote({ cloud_model: 'gemini-3.8-flash', guess_count: '5', natural_voice: 'false' });
    expect(changed.sort()).toEqual(['cloud_model', 'guess_count', 'natural_voice']);
    expect(settings.cloudModel).toBe('gemini-3.8-flash');
    expect(settings.guessCount).toBe(5);
    expect(settings.naturalVoice).toBe(false);
    applyRemote({ cloud_model: REMOTE_DEFAULTS.cloud_model, guess_count: '6', natural_voice: 'true' });
  });

  it('ignores values that would break the app', () => {
    const before = { ...settings };
    const changed = applyRemote({ cloud_model: 'not a model!', cloud_backup_models: 'gemini-3.6-flash,gpt-4', cloud_hedge_ms: '50', guess_count: '99', device_timeout_ms: 'soon', cloud_patience_ms: '-5', cloud_thinking: 'EXTREME', limited_use_tokens: 'maybe' });
    expect(changed).toEqual([]);
    expect(settings).toEqual(before);
  });

  it('lets the second cloud model and asking again be switched off', () => {
    expect(settings.cloudBackupModels).toBe('gemini-3.1-flash-lite,gemini-3.6-flash');
    expect(settings.cloudHedgeMs).toBe(1500);
    expect(applyRemote({ cloud_backup_models: '', cloud_hedge_ms: '0' }).sort()).toEqual(['cloud_backup_models', 'cloud_hedge_ms']);
    expect(settings.cloudBackupModels).toBe('');
    expect(settings.cloudHedgeMs).toBe(0);
    expect(applyRemote({ cloud_backup_models: ' gemini-3.6-flash , gemini-3.1-flash-lite ' })).toEqual(['cloud_backup_models']);
    expect(settings.cloudBackupModels).toBe('gemini-3.6-flash,gemini-3.1-flash-lite');
    applyRemote({ cloud_backup_models: REMOTE_DEFAULTS.cloud_backup_models, cloud_hedge_ms: String(REMOTE_DEFAULTS.cloud_hedge_ms) });
    expect(settings.cloudBackupModels).toBe('gemini-3.1-flash-lite,gemini-3.6-flash');
    expect(settings.cloudHedgeMs).toBe(1500);
  });

  it('replaces prompt text by path, but never the schemas', () => {
    const original = PACK.cue.user;
    expect(applyPromptOverrides(JSON.stringify({ 'cue.user': 'Word: {word}', 'schemas.cue': 'x', 'nope.missing': 'y' }))).toBe(true);
    expect(PACK.cue.user).toBe('Word: {word}');
    expect(typeof PACK.schemas.cue).toBe('object');
    applyPromptOverrides(JSON.stringify({ 'cue.user': original }));
    expect(applyPromptOverrides('not json')).toBe(false);
    expect(applyPromptOverrides('{}')).toBe(false);
  });
});

import { attemptOrder, hedge } from '../src/core/hedge';

describe('asking again when an answer is slow to start', () => {
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  /** An attempt that starts answering after `startMs`, then finishes 5 ms later (or fails instead of starting). */
  const attempt = (name: string, startMs: number, started: () => boolean, shown: string[], fail = false) =>
    wait(startMs).then(async () => {
      if (fail) throw new Error(`${name} failed`);
      if (started()) shown.push(name);
      await wait(5);
      if (started()) shown.push(name);
      return name;
    });

  it('a quick answer is asked for once', async () => {
    let begun = 0;
    const r = await hedge((i, started) => { begun++; return attempt(`a${i}`, 5, started, []); }, 40, 3);
    expect(r).toEqual({ value: 'a0', attempt: 0, attempts: 1 });
    await wait(100);
    expect(begun).toBe(1);
  });

  it('a slow answer is asked for again, and the attempt that starts first is the only one shown', async () => {
    const shown: string[] = [];
    const r = await hedge((i, started) => attempt(`a${i}`, i === 0 ? 300 : 5, started, shown), 40, 3);
    expect(r).toEqual({ value: 'a1', attempt: 1, attempts: 2 });
    await wait(320); // the first attempt arrives late: nothing of it is shown
    expect(shown).toEqual(['a1', 'a1']);
  });

  it('asks a third time if the second is slow too, and never more than the limit', async () => {
    let begun = 0;
    const r = await hedge((i, started) => { begun++; return attempt(`a${i}`, i < 2 ? 400 : 5, started, []); }, 30, 3);
    expect(r).toEqual({ value: 'a2', attempt: 2, attempts: 3 });
    const slow = await hedge((i, started) => attempt(`b${i}`, 150, started, []), 20, 3);
    expect(slow).toEqual({ value: 'b0', attempt: 0, attempts: 3 });
    expect(begun).toBe(3);
  });

  it('an attempt that fails is replaced at once, without waiting', async () => {
    const t0 = Date.now();
    const r = await hedge((i, started) => attempt(`a${i}`, 5, started, [], i === 0), 2000, 3);
    expect(r).toEqual({ value: 'a1', attempt: 1, attempts: 2 });
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('fails with the first error only when every attempt has failed', async () => {
    await expect(hedge((i, started) => attempt(`a${i}`, 5, started, [], true), 20, 3)).rejects.toThrow('a0 failed');
  });

  it('if the attempt being shown fails part-way, another takes its place', async () => {
    const shown: string[] = [];
    const r = await hedge((i, started) => (i === 0
      ? wait(50).then(async () => { if (started()) shown.push('a0'); await wait(60); throw new Error('a0 broke'); })
      : attempt(`a${i}`, 40, started, shown)), 30, 3);
    expect(r.value).toBe('a1');
    expect(shown).toEqual(['a0']); // the second attempt's pieces were held back while the first was showing
  });

  it('takes turns between the cloud models, skips one that is resting, and can start with the quick one', () => {
    expect(attemptOrder('main', ['b1', 'b2'])).toEqual(['main', 'b1', 'b2']);
    expect(attemptOrder('main', [''])).toEqual(['main']);
    expect(attemptOrder('main', ['b1', 'main', 'b1'])).toEqual(['main', 'b1']);
    expect(attemptOrder('main', ['b1', 'b2'], (m) => m === 'b1')).toEqual(['main', 'b2']);
    expect(attemptOrder('main', ['b1', 'b2'], (m) => m === 'main')).toEqual(['b1', 'b2']);
    expect(attemptOrder('main', ['b1'], () => true)).toEqual(['main']);
    expect(attemptOrder('main', ['b1', 'b2'], () => false, 'b2')).toEqual(['b2', 'main', 'b1']);
    expect(attemptOrder('main', ['b1', 'b2'], (m) => m === 'b2', 'b2')).toEqual(['main', 'b1']);
  });

  it('with timed repeats off, a slow attempt is not asked again, but a failed one is still replaced', async () => {
    let begun = 0;
    const r = await hedge((i, started) => { begun++; return attempt(`a${i}`, 80, started, []); }, 0, 3);
    expect(r).toEqual({ value: 'a0', attempt: 0, attempts: 1 });
    expect(begun).toBe(1);
    expect(await hedge((i, started) => attempt(`b${i}`, 5, started, [], i === 0), 0, 2)).toEqual({ value: 'b1', attempt: 1, attempts: 2 });
    await expect(hedge((i, started) => attempt(`c${i}`, 5, started, [], true), 0, 1)).rejects.toThrow('c0 failed');
  });
});
