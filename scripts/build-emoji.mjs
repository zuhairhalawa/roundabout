// Builds shared/emoji.json: a plain word -> emoji table, used to put a picture on a word tile
// without asking a model for it. Looking the picture up is instant, works offline, is the same
// on every platform, and keeps the on-device model's answer short (short answers are fast).
// Sources (both MIT): unicode-emoji-json (official emoji names) and emojilib (keywords).
//   node scripts/build-emoji.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(new URL('../web/package.json', import.meta.url));
const names = require('unicode-emoji-json');
const keywords = require('emojilib');

const clean = (s) => s.toLowerCase().replace(/[_-]+/g, ' ').replace(/[^a-z0-9' ]+/g, '').replace(/\s+/g, ' ').trim();
const SKIP_GROUPS = new Set(['Component']);
// People emoji named by gesture or gender make poor pictures for ordinary words.
const SKIP_NAME = /^(?:person|man|woman|men|women|people|boy|girl) |skin tone|: |button$|^(?:keycap|flag)/;

const map = new Map();          // word -> { emoji, score } ; lower score wins
const offer = (word, emoji, score) => {
  const w = clean(word);
  if (!w || w.length < 2 || w.split(' ').length > 3) return;
  const had = map.get(w);
  if (!had || score < had.score) map.set(w, { emoji, score });
};

let order = 0;
for (const [emoji, info] of Object.entries(names)) {
  order++;
  if (SKIP_GROUPS.has(info.group)) continue;
  const name = clean(info.name);
  const flag = info.group === 'Flags';
  if (flag) { offer(name.replace(/^flag /, ''), emoji, 5 + order / 1e5); continue; }   // country name -> flag, low priority
  if (SKIP_NAME.test(info.name)) continue;
  offer(name, emoji, 0 + order / 1e5);                                                  // the official name wins
  // Only the first two keywords: deeper ones are loose associations ("gold" for a key) and
  // would put a misleading picture on a tile. Words with no confident match stay without a
  // picture here and are filled in by one short model request.
  const keys = keywords[emoji] ?? [];
  keys.slice(0, 2).forEach((k, i) => { if (!SKIP_NAME.test(k)) offer(k, emoji, 1 + i + order / 1e5); });
}

// A few everyday words the sources name differently.
const EXTRA = {
  // common phrases whose picture is the same thing (a phrase never borrows its last word's picture)
  'wall clock': '🕰️', 'traffic light': '🚦', 'sea lion': '🦭', parasol: '⛱️', 'dining chair': '🪑', 'kitchen chair': '🪑',
  'wine glass': '🍷', 'mobile phone': '📱', 'cell phone': '📱', 'front door': '🚪', 'door key': '🔑', 'house key': '🔑',
  'reading glasses': '👓', 'kitchen knife': '🔪', 'bread knife': '🔪', 'coffee cup': '☕', 'tea cup': '🍵',
  fridge: '🧊', refrigerator: '🧊', tv: '📺', remote: '📺', 'remote control': '📺', sofa: '🛋️', couch: '🛋️', phone: '📱',
  glasses: '👓', doctor: '🩺', nurse: '🩺', pharmacy: '💊', medicine: '💊', pill: '💊', pills: '💊', prescription: '💊',
  hospital: '🏥', dentist: '🦷', kitchen: '🍳', bathroom: '🛁', bedroom: '🛏️', garden: '🏡', shop: '🏪', supermarket: '🛒',
  money: '💵', bank: '🏦', bus: '🚌', train: '🚆', plane: '✈️', airport: '🛫', taxi: '🚕', car: '🚗', bicycle: '🚲', bike: '🚲',
  son: '👦', daughter: '👧', grandson: '👦', granddaughter: '👧', husband: '👨', wife: '👩', mother: '👩', father: '👨',
  grandmother: '👵', grandfather: '👴', friend: '🤝', neighbour: '🏘️', neighbor: '🏘️', family: '👪', baby: '👶',
  hungry: '🍽️', thirsty: '🥤', tired: '😴', pain: '🤕', happy: '🙂', sad: '🙁', cold: '🥶', hot: '🥵', angry: '😠', worried: '😟',
  yesterday: '⬅️', tomorrow: '➡️', today: '📅', morning: '🌅', evening: '🌆', night: '🌙', appointment: '📅',
  toilet: '🚽', shower: '🚿', towel: '🧻', soap: '🧼', toothbrush: '🪥', comb: '🪮', key: '🔑', keys: '🔑', wallet: '👛',
  knife: '🔪', fork: '🍴', spoon: '🥄', plate: '🍽️', cup: '☕', glass: '🥛', bottle: '🍾', kettle: '🫖', water: '💧',
  bread: '🍞', milk: '🥛', tea: '🍵', coffee: '☕', egg: '🥚', cheese: '🧀', apple: '🍎', banana: '🍌',
  clock: '🕰️', watch: '⌚', tree: '🌳', leaf: '🍃', flower: '🌼', boot: '🥾', shoe: '👞', sock: '🧦', glove: '🧤', hat: '👒',
  belt: '👖', vest: '🦺', map: '🗺️', bridge: '🌉', lamp: '💡', fan: '🪭', table: '🪑', desk: '🖥️', bench: '🪑', bed: '🛏️',
  cake: '🎂', corn: '🌽', pumpkin: '🎃', strawberry: '🍓', celery: '🥬', saw: '🪚', nail: '🔩', ruler: '📏', rake: '🍂',
  hose: '🚿', iron: '👔', pipe: '🚬', can: '🥫', top: '🌀', cross: '✝️', queen: '👸', king: '🤴', bride: '👰', clown: '🤡',
  cowboy: '🤠', pirate: '🏴‍☠️', sailor: '⚓', dinosaur: '🦕', van: '🚐', wagon: '🛒', garage: '🚗', closet: '🚪', pillow: '🛏️',
  necklace: '📿', wig: '💇', beard: '🧔', zipper: '🧥', slippers: '🥿', crutches: '🩼', cane: '🦯', binoculars: '🔭',
  typewriter: '⌨️', chimney: '🏠', fireplace: '🔥', waterfall: '🏞️', pyramid: '🔺', well: '🪣', cannon: '💣', saddle: '🐎',
  whistle: '📣', door: '🚪', window: '🪟', chair: '🪑', book: '📖', pen: '🖊️', bag: '👜', letter: '✉️', stamp: '📮',
  newspaper: '📰', radio: '📻', computer: '💻', camera: '📷', light: '💡', bath: '🛁', mirror: '🪞', brush: '🖌️', broom: '🧹',
  lock: '🔒', padlock: '🔒', box: '📦', bowl: '🥣', pan: '🍳', pot: '🍲', oven: '♨️', sink: '🚰', tap: '🚰', fire: '🔥',
  sun: '☀️', moon: '🌙', star: '⭐', rain: '🌧️', snow: '❄️', wind: '💨', cloud: '☁️', storm: '⛈️', sea: '🌊', beach: '🏖️',
  mountain: '⛰️', river: '🏞️', road: '🛣️', street: '🛣️', house: '🏠', home: '🏠', school: '🏫', church: '⛪', mosque: '🕌',
  office: '🏢', library: '📚', restaurant: '🍽️', cafe: '☕', park: '🌳', gym: '🏋️', station: '🚉', hotel: '🏨',
  dog: '🐕', cat: '🐈', bird: '🐦', fish: '🐟', horse: '🐎', cow: '🐄', sheep: '🐑', pig: '🐖', chicken: '🐔', duck: '🦆',
  hand: '✋', foot: '🦶', leg: '🦵', arm: '💪', eye: '👁️', ear: '👂', nose: '👃', mouth: '👄', tooth: '🦷', heart: '❤️',
  shirt: '👕', trousers: '👖', pants: '👖', dress: '👗', coat: '🧥', jacket: '🧥', scarf: '🧣', tie: '👔', ring: '💍',
  ball: '⚽', football: '🏈', music: '🎵', song: '🎵', film: '🎬', game: '🎲', card: '🃏', gift: '🎁', party: '🎉',
  teacher: '🧑‍🏫', police: '👮', 'police officer': '👮', firefighter: '🧑‍🚒', fireman: '🧑‍🚒', farmer: '🧑‍🌾', cook: '🧑‍🍳', chef: '🧑‍🍳',
  pilot: '🧑‍✈️', driver: '🚌', waiter: '🍽️', barber: '💈', hairdresser: '💇', lawyer: '⚖️', judge: '⚖️', surgeon: '🩺',
  pharmacist: '💊', optician: '👓', plumber: '🔧', mechanic: '🔧', builder: '👷', cashier: '🛒', boss: '💼', carer: '🤝',
  eat: '🍴', drink: '🥤', sleep: '😴', walk: '🚶', run: '🏃', swim: '🏊', read: '📖', write: '✍️', wash: '🧼',
  clean: '🧹', call: '📞', pay: '💳', buy: '🛒', open: '🔓', close: '🔒', cut: '✂️', sit: '🪑', drive: '🚗', fix: '🔧', repair: '🔧',
  remember: '🧠', forget: '🧠', whisper: '🤫', argue: '😠', pour: '🫗', chew: '🦷', swallow: '😮', explain: '💬', choose: '👉',
  weekend: '📅', midnight: '🕛', noon: '🕛', anniversary: '💍', birthday: '🎂', week: '📅', month: '🗓️', year: '🗓️',
  embarrassed: '😳', jealous: '😒', numb: '🥶', dizzy: '😵', sick: '🤒', ill: '🤒', afraid: '😨', lonely: '🚶', bored: '🥱',
  nephew: '👦', niece: '👧', cousin: '👪', uncle: '👨', aunt: '👩', widow: '👩', landlord: '🏠', brother: '👦', sister: '👧',
};
for (const [w, e] of Object.entries(EXTRA)) map.set(w, { emoji: e, score: -1 });

// Plurals of the hand-picked words point at the same picture.
for (const [w, e] of Object.entries(EXTRA)) { const pl = /(?:s|x|ch|sh)$/.test(w) ? `${w}es` : `${w}s`; if (!map.has(pl)) map.set(pl, { emoji: e, score: -1 }); }

const out = Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)).map(([w, v]) => [w, v.emoji]));
writeFileSync(new URL('../shared/emoji.json', import.meta.url), JSON.stringify({ version: 1, about: 'word -> emoji, built by scripts/build-emoji.mjs from unicode-emoji-json and emojilib (MIT)', map: out }));
const probe = ['key', 'umbrella', 'dentist', 'knife', 'clock', 'house', 'pencil', 'scissors', 'ladder', 'prescription', 'remote', 'candle', 'elephant', 'guitar', 'whistle', 'stethoscope'];
console.log(`${Object.keys(out).length} words. ${probe.map((w) => `${w} ${out[w] ?? '—'}`).join('  ')}`);
