## Inspiration

Aphasia is a language disorder, most often caused by a stroke. Studies put it at 18–38% of stroke survivors, and estimates for the United States run from one to two and a half million people. Intelligence is intact. The most common symptom is *anomia*: you know exactly what you mean, and the word will not come.

Speech therapists teach a way round. Talk around the word: say what it is for, where it lives, what it looks like. Or draw it. That works when the listener is patient and good at guessing. We wanted that listener to fit in a pocket.

It also has to be there when it is needed, and that is the reason this is a hybrid app. **A voice that needs Wi-Fi is not a voice.** Words get lost on a hospital ward, in a car park, in a shop queue. And what a person is struggling to say is private.

> When the direct road to a word is closed, take the roundabout.

## What it does

**Find a word, four ways**

- *Describe it.* Any words, in any order. "sharp, cuts bread, kitchen" gives *knife*.
- *Tap hints.* One question at a time: what kind of thing, where you find it, what it is for. This follows Semantic Feature Analysis, a standard therapy technique for anomia.
- *Draw it.* Guesses appear while you draw.
- *Show a photo.*

The answer is a set of big word tiles with pictures. Tap one and it is spoken. Tiles are coloured like road signs so you always know where an answer came from: **green** was found on this device, **blue** came from the cloud, **brown** is one of your own saved words.

**Say a sentence.** A few key words ("doctor, Tuesday, change") become three full sentences to choose from, plain, polite or firm, spoken in a natural voice.

**Practice.** Naming practice that gives hints in the order a therapist does: what it means, a sentence to finish, the first letter, and only then the word.

**My words.** Names and words that matter. "my granddaughter" finds *Layla* at once, with no model involved. A family member can add names from their own phone with an 8-character code that works for 15 minutes.

**Private mode.** One switch, and nothing is ever sent to the cloud.

## How it uses hybrid inference

Every model call goes through **Firebase AI Logic**. One small function picks an inference mode for each job, the SDK does the switching, and the app shows which side answered (`inferenceSource`).

| Job | Mode | Why |
|---|---|---|
| Find a word, name a drawing or photo, build a sentence, practice hints | `PREFER_ON_DEVICE` | Short jobs. The device answers; the cloud covers devices with no on-device model. |
| Guesses while typing, tapping hints or drawing | `ONLY_ON_DEVICE` | Many small requests. On the device they are free and private, so they never go to the cloud. |
| The same jobs while the on-device model is still loading | `PREFER_IN_CLOUD` | Nobody should wait for a model to load. The SDK falls back to the device if the cloud fails. |
| The person tapped "something you do" or "a feeling" | `PREFER_IN_CLOUD` | Measured: the small model finds objects and places well, actions and feelings poorly. So these go to the cloud first, and to the device when the cloud cannot be reached. |
| A clue of three words or fewer | device first, then `ONLY_IN_CLOUD` | Very short clues are also hard for a small model, so the cloud adds its ideas as blue tiles beside the green ones. |
| "None of these" | `ONLY_IN_CLOUD` | The bigger model looks again, told what was already offered. |
| Private mode | `ONLY_ON_DEVICE` | Nothing leaves the device. |

On top of the SDK's own fallback the app adds four things. A slow device is covered by the cloud: if an on-device call fails or does not start answering in time, the same request goes to the cloud. A slow cloud is covered by the device: when the cloud is asked first and has not started answering after 1.5 seconds, the on-device model answers meanwhile, and the cloud's words are added in blue when they arrive. A slow cloud model is covered by another cloud model: a cloud request that has not started answering after 1.5 seconds is also sent to the next cloud model on a short list, up to four requests, and the first to start answering is used. And a cloud model that says its quota is used up is rested until it can answer again, while the other models and the device carry on.

One prompt pack (`shared/prompts.json`) holds every prompt and JSON schema. The same schema goes to Gemini Nano as `responseConstraint` and to the cloud model as `responseSchema`, so both sides return the same shape and can be compared like for like.

## How we built it

- **Firebase AI Logic**: hybrid inference in all four modes, structured output, streaming, image input, and text-to-speech for the natural voice.
- **App Check** (reCAPTCHA Enterprise), enforced for AI Logic and Firestore. A request without a token gets a 401.
- **Remote Config**: cloud model names (the main one and the backups), number of guesses, the time limits for a slow device and a slow cloud, and even prompt text can change without a release. Every value is checked before use.
- **Anonymous Authentication + Cloud Firestore** for sharing saved words with a helper, with security rules that check every write. This code is only downloaded when sharing is turned on.
- **Firebase Hosting**, plus a small service worker so the app itself opens offline.
- Web app: TypeScript, Preact and Vite. The Firebase project is on the free Spark plan with no billing account.
- Android app: Kotlin and Jetpack Compose, with Firebase AI Logic hybrid inference through `OnDeviceConfig` in all four modes and one `@Generable` answer shape for both sides. The routing rule and the covers for a slow side are the same as on the web, and the app reads the same prompt pack, hint chips and picture table from the repository's `shared/` folder. It is built and unit-tested in GitHub Actions (38 tests) and run on an emulator there. On the emulator it finds a word through the cloud with App Check enforced (11 of 11 checks). **To be plain about Android:** every answer we have seen on Android came from the cloud, on an emulator. The on-device path (Gemini Nano through the Prompt API from ML Kit) is built, and its routing and covers are unit-tested with a stand-in model, but it has not been run on a real phone, because an emulator has no on-device model and we had no supported phone to test on.

**Making the device fast enough for a conversation.** Our first version asked the model for six words, each with a picture, as JSON objects. On the device that took about four seconds, slower than the cloud. Three changes brought the first word to under a second: ask only for `{"words": [...]}`; look pictures up in a table of about 2,500 everyday words instead of generating them; and stream, so each tile appears as its word arrives.

## How well it works

We measured it on two test sets whose clues were written by someone who had not seen the prompts: the 175 nouns of the Philadelphia Naming Test, a standard naming test in aphasia research, and 80 everyday words that are not simple objects. Each word has a clear clue, a broken and halting one, and one of two to four key words. The test runs the app's own code, and the on-device run is in private mode so the cloud can never answer for it.

| Test set | Side | Tries | Right word first | In the first three | Among the six tiles | First tile after |
|---|---|---|---|---|---|---|
| 175 naming-test nouns | Device (Gemini Nano) | 525 | 89.5% | 95.6% | 96.0% | 0.9 s |
| 175 naming-test nouns | Cloud | 175 | 99.4% | 100% | 100% | 1.1 s |
| 80 everyday words | Device (Gemini Nano) | 240 | 57.9% | 69.6% | 74.6% | 0.9 s |
| 80 everyday words | Cloud | 80 | 82.5% | 92.5% | 95.0% | 1.8 s |

The second set showed us where the small model stops. Among the six tiles, the device found places 100% of the time and people 90%, but actions only 57% and feelings and times 52%. The cloud scored 90% or more on all four.

**That measurement became a routing rule.** For things and places the device answers first: nearly as accurate as the cloud, quicker to the first tile, free, private and offline. When the person taps "something you do" or "a feeling", the cloud answers first.

The cloud rows are the main cloud model. The backup cloud model, which answers when the main one is slow or out of quota, was measured on the same words: right word first in 98.9% of 175 tries on the nouns, and among the six tiles in 91.3% of 80 tries on the everyday words.

Every number, every miss and the scoring rule are in `docs/ACCURACY.md` in the repository, generated from the raw result files.

**End-to-end tests against the live site**

- Real Chrome with Gemini Nano, 18 of 18 checks: the cloud answers while the on-device model loads; a full clue is answered on the device with no model request leaving the machine; guesses appear while typing; the cloud adds ideas for a short clue; private mode sends nothing; an action goes to the cloud first, and when the cloud's reply is late the device answers and the cloud's words are added afterwards; a drawing is named on the device; and after a reload with the network off the app opens and finds *umbrella*.
- A browser with no on-device model, 21 of 21 checks: every way of finding a word, sentences, the natural voice, saved words, a slow cloud model covered by a second request, Remote Config, and a check that every model request goes to Firebase AI Logic.
- Two browsers as two people, 10 of 10: a helper joins with a code, adds a name, and it appears on the other device.
- Security rules, 45 of 45 operations by three real anonymous users.

## Challenges we ran into

- **The device was slower than the cloud.** See above. The fix was to ask the small model for less, not to prompt it harder.
- **On-device calls cancelled each other.** The SDK keeps one on-device session per model and ends the old one when a new call starts, so guesses-while-typing kept cutting off the main request. We run on-device calls one at a time and skip the stale ones.
- **Then that queue made the cloud wait.** Our end-to-end test on real Chrome caught it: while the on-device model was loading (several minutes on a cold start), cloud-first requests were stuck behind it. Cloud-first calls now skip the queue.
- **A quick tap lost to the type-ahead.** The same test caught a second one: pressing "Find the word" within a moment of the last keystroke was overridden by the guess-while-typing, which also skipped the cloud's help. The button now wins, and a finished type-ahead answer is reused instead of asked for twice.
- **The free cloud had a bad evening.** On the evening of our test day the cloud model reported "high demand" and held most requests for 8 seconds or more, the longest for 43 seconds. A second cloud model was answering the same request in under a second. On a device with an on-device model the app was already covered. For every other device we added a second line of cover: a request that is slow to start also goes to another cloud model, and the first answer wins. Each free model also has its own quota, and the same day showed why that matters: our testing used up the main model's 500 requests a day, and the live site carried on with the backup model.
- **A button that did nothing.** While recording the demo, a press on "Find the word" was lost: the button was switched off for the second or so that the type-ahead guess was running, and for a short clue that also lost the cloud's extra words. The button now stays live, and a guess that is already on its way becomes the pressed answer instead of being asked for twice.
- **Replay protection costs time.** One-time-use App Check tokens added about half a second to every cloud request. In a conversation that is a lot, so they are off by default and can be switched on from Remote Config.
- **Short clues.** Three key words are hard for a small model. Rather than hide that, the app asks the cloud to add ideas and shows them in a different colour.
- **Pictures that mislead.** A looked-up picture must never point at the wrong word (*lock* showing a key). We only match on an emoji's official name and its first two keywords, and leave the tile without a picture otherwise.

## Accomplishments that we're proud of

- With an on-device model, it finds a word with the network switched off, after a reload.
- You can see the hybrid design: green and blue tiles side by side for a hard clue.
- Every claim on this page comes from a test that runs against the live site.

## What we learned

- For a small on-device model, output length is the speed limit. Fewer output tokens beat every other optimisation we tried.
- Routing by job is better than a single global "prefer device" switch. Live guesses, private mode and second opinions each want a different mode.
- Measure before you route. We expected short clues to be the device's weak spot. The test showed a bigger one that we had not guessed: actions and feelings.
- The cloud is not always the fast side. On the free tier, replies that took about a second in the morning were held for 8 seconds or more on the evening of the same day, while the on-device model stayed at 1.5 seconds. So each side has to be able to cover for the other, and one cloud model has to be able to cover for another.
- An on-device model's first prompt after a cold start can take minutes. The cloud has to cover that gap, or the first impression is a spinner.

## What's next for Roundabout

- Trials with people who have aphasia and with speech and language therapists. This is the step that matters most, and it has not happened yet.
- Run the Android on-device path on a real phone with Gemini Nano, and bring drawing, photos, sentences, practice and saved words to the Android app.
- Spoken clues, using the cloud model's audio input.
- The therapist's view: which words are hard this week.

## Limits, stated plainly

- Roundabout has not yet been tested with people who have aphasia. It is built from published therapy techniques and aphasia-friendly design guidance, not from clinical trials.
- It is a communication aid, not a medical device, and it does not replace speech and language therapy.
- Similar tools exist: naming-therapy apps, and at least one app that suggests words from sketches. We do not claim to be first. Roundabout's contribution is finding a word from a loose description or tapped hints, working offline on the device, and using the cloud where the device cannot.
- On-device answers on the web need Chrome on a desktop computer that can run Gemini Nano. Everywhere else it works through the cloud.
- English only.
- On Android, on-device answers are untested on real hardware. The Android app has been run only on an emulator, where it answers through the cloud. Drawing, photos, sentences, practice and saved words are in the web app only.
- The cloud side runs on the free tier, which has limits per project. On 12 November the service stated them in its replies: 500 requests a day for the main cloud model, and 15 requests a minute for the first backup model. When one model's quota is used up the app moves to the next, and a device with an on-device model keeps working with no cloud at all. A public launch would need a paid plan.
