// Where should this request run? One pure function decides, so the rule can be read, tested
// and shown to the person. The answer is a Firebase AI Logic inference mode: the SDK then does
// the actual switching and reports which side answered.

export type Mode = 'only_on_device' | 'prefer_on_device' | 'prefer_in_cloud' | 'only_in_cloud';

export type Task =
  | 'find'       // clues -> word
  | 'hard'       // clues -> word, for a kind of word the on-device model is weak at (actions, feelings)
  | 'live'       // guesses while typing, tapping or drawing: many small requests
  | 'image'      // drawing or photo -> word
  | 'sentences'  // key words -> sentences
  | 'cue'        // practice hints for a word
  | 'more'       // "none of these": a second opinion
  | 'listen'     // a spoken description (audio)
  | 'long'       // a longer message, e.g. an email
  | 'voice';     // natural speech

/** ready: on-device model loaded. loading: present or downloading, not usable yet. none: this browser has no on-device model. */
export type DeviceState = 'ready' | 'loading' | 'none';

export interface Situation {
  device: DeviceState;
  online: boolean;
  /** Cloud set up, and not paused after a "quota used up" reply. */
  cloud: boolean;
  /** The person chose "never use the cloud". */
  privateOnly: boolean;
}

export interface Route {
  /** null = cannot be done right now; `why` says what to tell the person. */
  mode: Mode | null;
  why: string;
  /** A cloud second opinion is possible after this answer. */
  canAskCloud: boolean;
}

const CLOUD_ONLY: Task[] = ['more', 'listen', 'voice'];

export function route(task: Task, s: Situation): Route {
  const cloudUp = s.online && s.cloud && !s.privateOnly;
  const no = (why: string): Route => ({ mode: null, why, canAskCloud: false });

  if (CLOUD_ONLY.includes(task)) {
    if (s.privateOnly) return no('Private mode is on, so nothing is sent to the cloud.');
    if (!s.online) return no('This needs the internet, and you are offline.');
    if (!s.cloud) return no('The cloud is resting for now. Try again in a minute.');
    return { mode: 'only_in_cloud', why: 'This job needs the bigger cloud model.', canAskCloud: false };
  }

  if (task === 'live') {
    // Never spend cloud requests on every keystroke or pen stroke.
    if (s.device === 'ready') return { mode: 'only_on_device', why: 'Live guesses run on this device, free and private.', canAskCloud: cloudUp };
    return no('Live guesses need the on-device model.');
  }

  if (s.privateOnly) {
    if (s.device === 'none') return no('Private mode needs the on-device model, and this device does not have one.');
    return { mode: 'only_on_device', why: 'Private mode: this stays on your device.', canAskCloud: false };
  }

  if (task === 'long') {
    if (cloudUp) return { mode: 'prefer_in_cloud', why: 'Long messages go to the bigger cloud model.', canAskCloud: false };
    if (s.device !== 'none') return { mode: 'only_on_device', why: 'No cloud right now, so this device writes it.', canAskCloud: false };
    return no('This needs the internet or an on-device model.');
  }

  // find, hard, image, sentences, cue: short jobs the on-device model can do.
  if (s.device === 'ready') {
    // Measured: the small model finds objects and places well, actions and feelings poorly.
    if (task === 'hard' && cloudUp) return { mode: 'prefer_in_cloud', why: 'Actions and feelings are hard for the small on-device model, so the cloud answers first.', canAskCloud: false };
    return { mode: 'prefer_on_device', why: 'Answered on this device first.', canAskCloud: cloudUp };
  }
  if (s.device === 'loading') {
    if (cloudUp) return { mode: 'prefer_in_cloud', why: 'The on-device model is still getting ready, so the cloud answers for now.', canAskCloud: false };
    return { mode: 'only_on_device', why: 'Waiting for the on-device model to get ready.', canAskCloud: false };
  }
  if (cloudUp) return { mode: 'prefer_on_device', why: 'This device has no on-device model, so the cloud answers.', canAskCloud: false };
  if (!s.online) return no('You are offline and this device has no on-device model.');
  return no('The cloud is resting for now. Try again in a minute.');
}
