// The scoring rule for the accuracy test, in one place so the test run and the report agree.
//
// A guess counts as the target word when it is an accepted answer, or a longer name that
// contains it as whole words ("wall clock" for "clock"). Case and punctuation are ignored, and
// singular and plural count as the same word ("gloves" for "glove", "eyes" for "eye").

const tokens = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);

/** A word and its possible singulars: "gloves" -> gloves, glove, glov; "glasses" -> glasses, glasse, glass. */
const forms = (t) => {
  const f = new Set([t]);
  if (t.length > 3 && t.endsWith('s')) {
    f.add(t.slice(0, -1));
    if (t.endsWith('es')) f.add(t.slice(0, -2));
  }
  return f;
};

const sameWord = (a, b) => { const fb = forms(b); for (const x of forms(a)) if (fb.has(x)) return true; return false; };

/** True when `accepted` appears inside `guess` as whole words, in order. */
export function matches(guess, accepted) {
  const g = tokens(guess), a = tokens(accepted);
  if (!a.length) return false;
  for (let i = 0; i + a.length <= g.length; i++) if (a.every((t, k) => sameWord(g[i + k], t))) return true;
  return false;
}

/** Position of the first guess that counts (0 = first tile), or -1 if none does. */
export const rankOf = (words, accept) => words.findIndex((w) => accept.some((a) => matches(w, a)));
