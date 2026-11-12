# Roundabout

**A word-finding aid for people with aphasia.** When a word will not come, describe it, tap a few hints, draw it or show a photo. Roundabout offers the word and says it aloud. It answers on the device when it can, and uses the cloud when the device cannot.

Live: https://roundabout-words.web.app
<!-- VIDEO -->

Built for #BuildHybridAI 2026 with **Firebase AI Logic hybrid inference** (Gemini Nano on the device, Gemini in the cloud).

![Roundabout: clues in, word tiles out](docs/screenshots/find.png)

## The problem

Aphasia is a language disorder, most often caused by a stroke. Studies put it at 18–38% of stroke survivors, and estimates for the United States run from one to two and a half million people. Intelligence is intact. The most common symptom is *anomia*: the person knows exactly what they mean, and the word will not come.

Speech therapists teach a way round: **talk around the word** (describe it, say what it is for, where it lives), or draw it. That works when the listener is patient and good at guessing. Roundabout is that listener, in a pocket.

> When the direct road to a word is closed, take the roundabout.

## Why this needs both an on-device model and the cloud

A voice that needs Wi-Fi is not a voice.

| | On the device (Gemini Nano) | In the cloud (Gemini) |
|---|---|---|
| Speed | Answers at the pace of a conversation | A network round trip |
| Offline | Works on a hospital ward, in a car park, outdoors | Needs a connection |
| Privacy | What a person is trying to say never leaves the device | Sent to Google's servers |
| Cost | Free, however many times a day it is used | Free tier, with limits |
| Reach | Only recent, capable devices | Every device with a browser |
| Knowledge | Everyday words | Names, rare words, harder pictures |

So neither side is enough alone. Roundabout uses each for what it is good at, and says which one answered.

## How a request is routed

One function, [`web/src/core/route.ts`](web/src/core/route.ts), picks a Firebase AI Logic inference mode for each job. The SDK then does the switching and reports the side that answered (`inferenceSource`).

| Job | Mode | Why |
|---|---|---|
| Find a word, name a drawing or photo, build a sentence, practice hints | `PREFER_ON_DEVICE` | Short jobs. The device answers; the cloud covers devices with no on-device model. |
| Guesses while typing, tapping hints or drawing | `ONLY_ON_DEVICE` | Many small requests. They cost nothing and stay private, so they never go to the cloud. |
| Same jobs while the on-device model is still loading | `PREFER_IN_CLOUD` | Do not make the person wait for a model to load. The SDK falls back to the device if the cloud fails or its quota runs out. |
| A clue of three words or fewer, answered on the device | then `ONLY_IN_CLOUD` | Very short clues are the hard case for a small model (see the numbers below), so the cloud adds its ideas as blue tiles beside the green ones. |
| "None of these": a second opinion | `ONLY_IN_CLOUD` | The bigger model looks again, told what was already offered. |
| Private mode (a setting) | `ONLY_ON_DEVICE` | Nothing leaves the device, ever. |

On top of the SDK's own fallback, [`web/src/core/find.ts`](web/src/core/find.ts) adds two things the SDK does not do: if an on-device call fails or takes too long, the same request is sent to the cloud; and after a "quota used up" reply the cloud is rested for a minute while the device carries on.

Before any model runs, saved words are matched against the clues in plain code, so "my granddaughter" finds *Layla* instantly, offline, on any device.

Tiles are coloured like road signs: **green** found on this device, **blue** from the cloud, **brown** one of your saved words.

## Fast enough for a conversation

The first version asked the model for six words, each with a picture, as JSON objects. On the device that took about four seconds, slower than the cloud. Three changes brought the first word to under a second:

- **Ask for less.** The model returns only `{"words": [...]}`. Fewer tokens out is the one thing that makes a small on-device model faster.
- **Look pictures up, do not generate them.** [`shared/emoji.json`](shared/emoji.json) maps 2,485 everyday words to a picture ([`web/src/core/pictures.ts`](web/src/core/pictures.ts)). Only a word the table does not know costs one more small request.
- **Stream.** Tiles appear as each word arrives (`generateContentStream`, read while still incomplete in [`web/src/core/guess.ts`](web/src/core/guess.ts)), so the likeliest word is on screen first.

## Offline

A small service worker ([`web/public/sw.js`](web/public/sw.js)) keeps a copy of the app itself after the first visit. With an on-device model, Roundabout then opens and finds words with no connection at all. Saved words, practice and the device's own voice work offline on every device.

## What it does

- **Find a word**, four ways:
  - *Describe it*: any words, in any order, misspelled is fine.
  - *Tap hints*: one question at a time (what kind of thing, where, what for, what it is like). This follows Semantic Feature Analysis, a standard therapy technique for anomia.
  - *Draw it*: drawing is a recognised strategy when words fail.
  - *Show a photo*.
- **Say a sentence**: a few key words become three full sentences to choose from, plain, polite or firm. Sentences are spoken with a natural Gemini voice when the cloud is reachable, and with the device's own voice otherwise.
- **Practice**: naming practice with a cueing hierarchy, the order a therapist gives hints in: what it means, a sentence to finish, the first letter, and only then the word.
- **My words**: names and words that matter (family, places). They are offered first when a clue matches.
- **A helper can add words from their own device**: the person shows an 8-character code that works for 15 minutes; a family member types it in and can then add names to the list, which appear on the person's device at once. Sharing is off until the person turns it on.
- **Private mode**: one switch, and nothing is ever sent to the cloud.

## One prompt pack for every platform

[`shared/prompts.json`](shared/prompts.json) holds every system prompt and JSON schema, and [`shared/hints.json`](shared/hints.json) the hint chips. The same schema is passed to Gemini Nano as `responseConstraint` and to the cloud model as `responseSchema`, so both sides return the same shape and can be compared like for like.

## Firebase

- **Firebase AI Logic**: every model call ([`web/src/core/ai.ts`](web/src/core/ai.ts)): hybrid inference in all four modes, structured output, image input, and text-to-speech for the natural voice ([`web/src/core/speech.ts`](web/src/core/speech.ts)).
- **App Check** with reCAPTCHA Enterprise, enforced for AI Logic and for Firestore. A request without a token is refused (`node scripts/check-appcheck.mjs` shows the 401).
- **Remote Config** ([`web/src/core/remote.ts`](web/src/core/remote.ts), [`remoteconfig.template.json`](remoteconfig.template.json)): the cloud model names, the number of guesses, the on-device time limit, the voice switch and even prompt text can be changed without a release. Values are checked before use, so a typo in the console cannot break the app.
- **Authentication** (anonymous sign-in, no email or password) and **Cloud Firestore** for sharing saved words with a helper ([`web/src/core/sync.ts`](web/src/core/sync.ts)). The words stay readable offline. This code is only downloaded when sharing is turned on.
- **Security rules** ([`firestore.rules`](firestore.rules)): only the person and the helpers they admitted can read or change their words; every write is checked for shape and size.
- **Hosting** for the web app.
- Project set-up is scripted in [`scripts/`](scripts): `fetch-web-config.mjs`, `provision-ailogic.cjs`, `setup-appcheck.cjs`.

The project is on the free Spark plan with no billing account, so the cloud side cannot cost money.

One measured trade-off: one-time-use App Check tokens (replay protection) add about half a second to every cloud request. In a conversation that is a lot, so they are off by default and can be switched on from Remote Config.

## Run it

```bash
cd web
npm install
cp .env.example .env.local     # then fill it in, or run the two set-up scripts from the repo root
npm run dev                    # http://localhost:5196
npm test                       # unit tests
```

On-device answers need Chrome on a desktop computer that can run Gemini Nano. Everywhere else Roundabout works through the cloud.

## Tests

- `npm test` (in `web/`): unit tests for the routing rule, cleaning model output into tiles, saved-word matching, the hint chips and the remote settings checks.
- `node scripts/e2e-device.mjs`: drives the live site in real Chrome with Gemini Nano: answers on the device with no model request leaving the machine, the cloud adding ideas for a short clue, private mode, hints, drawing, sentences, and finding a word after a reload with the network off.
- `node scripts/e2e-cloud.mjs`: drives the live site in a browser with no on-device model: describe, hints, drawing, photo, sentences, the natural voice, saved words, private mode, offline, Remote Config, and a check that every model request goes to Firebase AI Logic.
- `node scripts/rules-test.mjs`: three real anonymous users (owner, helper, stranger) try 45 operations against the deployed security rules.
- `node scripts/e2e-share.mjs`: two browsers on the live site, one person and one helper: invite code, a name added by the helper appears on the other device, removal cuts access.
- `node scripts/eval.mjs cloud|device eval/pnt.json`: accuracy on an independent test set (see [`docs/ACCURACY.md`](docs/ACCURACY.md)).

## Limits, stated plainly

- Roundabout has not yet been tested with people who have aphasia. It is built from published therapy techniques and aphasia-friendly design guidance, not from clinical trials.
- It is a communication aid, not a medical device, and it does not replace speech and language therapy.
- Similar tools exist (naming-therapy apps, and at least one app that suggests words from sketches). Roundabout's contribution is finding a word from a loose description or tapped hints, working offline on the device, and falling back to the cloud on devices that cannot.

## Licence

Apache-2.0. All names and examples in this repository are fictional.
