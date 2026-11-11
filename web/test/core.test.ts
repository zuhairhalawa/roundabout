import { describe, expect, it } from 'vitest';
import { cluesFromChips, fill, HINTS, PACK, rowsFor } from '../src/core/pack';
import { applySaved, firstEmoji, matchSaved, mergeGuesses, normaliseWord, parseGuesses, wordKey, type SavedWord } from '../src/core/guess';
import { route, type Situation } from '../src/core/route';

describe('prompt pack', () => {
  it('fills placeholders and leaves unknown ones', () => {
    expect(fill('Clues: {clues} ({count})', { clues: 'sharp, kitchen', count: 6 })).toBe('Clues: sharp, kitchen (6)');
    expect(fill('{a} {b}', { a: 'x' })).toBe('x {b}');
  });

  it('has a system prompt and schema for every task', () => {
    expect(PACK.find.system).toContain('{count}');
    expect(PACK.schemas.guesses.properties.guesses.type).toBe('array');
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
