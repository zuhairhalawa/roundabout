// Asking again when an answer is slow to start.
//
// A free cloud model usually starts answering in about a second, but now and then one request
// is held for 10, 20 or 40 seconds while the next one is answered at once. A person in the
// middle of a sentence cannot wait for that, so a request that has not started answering after
// a short time is asked again, and whichever attempt starts first is the one that is used.

export interface Hedged<T> {
  value: T;
  /** Which attempt answered: 0 is the first one. */
  attempt: number;
  /** How many attempts were begun in all. */
  attempts: number;
}

/**
 * Run `launch(0)`. While no attempt has started to answer, begin one more attempt every
 * `everyMs`, up to `max` attempts. An attempt that fails before any has started to answer is
 * replaced at once.
 *
 * `launch(i, started)` begins attempt `i`. It calls `started()` each time a piece of its answer
 * arrives; `started()` returns true while this attempt is the one being used, so that only one
 * attempt's partial answer is ever shown. The first attempt to start answering is the one that
 * is used; if it then fails, another attempt takes its place.
 *
 * A failed attempt does not count towards `max`, but no more than twice `max` attempts are
 * ever begun. Fails only when all attempts have failed, with the first attempt's error.
 * `everyMs` of 0 means a slow attempt is never asked again (a failed one is still replaced);
 * `max` of 1 means one plain attempt.
 */
export function hedge<T>(launch: (attempt: number, started: () => boolean) => Promise<T>, everyMs: number, max: number): Promise<Hedged<T>> {
  return new Promise((resolve, reject) => {
    let begun = 0;
    let open = 0;
    let over = false;
    let lead = -1;
    let fails = 0;
    let firstError: unknown;
    // An attempt that failed does not use up one of the `max` tries: a model that refuses at
    // once (its quota is used up) must not crowd out a second try of a model that is only slow.
    // The total is still limited, so that a service that is down is not asked for ever.
    const limit = max > 1 ? max * 2 : 1;
    const room = () => begun - fails < max && begun < limit;
    let spare: { value: T; attempt: number } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const win = (value: T, attempt: number) => { over = true; clearTimeout(timer); resolve({ value, attempt, attempts: begun }); };
    const arm = () => {
      clearTimeout(timer);
      if (!over && everyMs > 0 && room() && lead < 0) timer = setTimeout(next, everyMs);
    };
    function next() {
      if (over || !room() || lead >= 0) return;
      const i = begun++;
      open++;
      const started = () => {
        if (over) return false;
        if (lead < 0) { lead = i; clearTimeout(timer); }
        return lead === i;
      };
      let run: Promise<T>;
      try { run = launch(i, started); } catch (e) { run = Promise.reject(e); }
      run.then(
        (value) => {
          open--;
          if (over) return;
          if (lead < 0 || lead === i) win(value, i);
          else spare ??= { value, attempt: i }; // another attempt is being shown; keep this in case it fails
        },
        (e) => {
          open--;
          if (!fails || i === 0) firstError = e;
          fails++;
          if (over) return;
          if (lead === i) {
            lead = -1;
            if (spare) return win(spare.value, spare.attempt);
          }
          // A failed attempt is replaced at once, unless another attempt is already answering.
          if (lead < 0 && room()) return next();
          if (open > 0) return;
          over = true;
          clearTimeout(timer);
          reject(firstError);
        },
      );
      arm();
    }
    next();
  });
}

/**
 * Which cloud model each attempt asks, in turn: the main model, then each backup model; after
 * the last one the list starts again. A model that is resting (it has just said that its quota
 * is used up) is left out. `quick`, when given, goes first: the model that answered last time
 * when the main model was slow, because a busy model stays busy for a while.
 */
export function attemptOrder(main: string, backups: string[], resting: (model: string) => boolean = () => false, quick = ''): string[] {
  const list = [...new Set([main, ...backups])].filter((m) => m && !resting(m));
  if (!list.length) return [main];
  const at = list.indexOf(quick);
  if (at > 0) list.unshift(...list.splice(at, 1));
  return list;
}

/**
 * How long to leave a cloud model alone after it has said that its quota is used up. The reply
 * says when to try again ("Please retry in 50.8s", or "in 12h35m27s" when the day's quota is
 * gone). That is used, but never less than 10 seconds and never more than half an hour, so a
 * model whose quota has been raised or reset is found again without a restart.
 */
export function restAfterQuota(message: string): number {
  const m = /retry in\s+(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?/i.exec(message);
  const asked = m ? Math.round((Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) * 1000) : 0;
  return Math.min(Math.max(asked || 60_000, 10_000), 30 * 60_000);
}
