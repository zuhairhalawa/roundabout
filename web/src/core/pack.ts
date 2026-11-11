// The shared prompt pack and hint chips. The same two JSON files are read by the Android app,
// so every platform sends the same words to the on-device model and to the cloud model.
import prompts from '../../../shared/prompts.json';
import hints from '../../../shared/hints.json';

export const PACK = prompts;
export const HINTS = hints;

export interface Chip { id: string; label: string; emoji: string; clue: string }
export interface Row { id: string; ask: string; chips: Chip[] }

/** Fill {placeholders} in a prompt template. Unknown placeholders are left as they are. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** The rows of chips to show once a group is picked. */
export function rowsFor(groupId: string | null): Row[] {
  if (!groupId) return [];
  return ((HINTS.rows as Record<string, Row[]>)[groupId] ?? []);
}

/** Turn tapped chips into the plain-English clue line the model reads. */
export function cluesFromChips(groupId: string | null, picked: string[]): string {
  if (!groupId) return '';
  const group = (HINTS.group.chips as Chip[]).find((c) => c.id === groupId);
  if (!group) return '';
  const parts = [group.clue];
  for (const row of rowsFor(groupId)) {
    for (const chip of row.chips) if (picked.includes(`${row.id}.${chip.id}`)) parts.push(chip.clue);
  }
  return parts.join('; ');
}
