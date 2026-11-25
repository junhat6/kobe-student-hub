/**
 * Milestones on one's own page (#223). Computed on every visit from public facts only — how many
 * articles and projects are public right now, and the longest weekly run in the grass window —
 * and never stored, so stopping an article quietly takes its share back. Never shown on the
 * public profile: milestones are a private pat on the back, not a ranking.
 */
interface Milestone {
  key: 'first' | 'five' | 'ten' | 'fourWeeks';
  /** Short name next to the icon. */
  label: string;
  /** What reaching it took, for assistive tech and the tooltip. */
  detail: string;
  icon: 'sprout' | 'doc' | 'calendar';
}
const LADDER: (Milestone & { kind: 'pieces' | 'weeks'; need: number })[] = [
  {
    key: 'first',
    label: '初公開',
    detail: '最初の1本を公開',
    icon: 'sprout',
    kind: 'pieces',
    need: 1,
  },
  {
    key: 'five',
    label: '5本',
    detail: '公開中の記事・作品が5本',
    icon: 'doc',
    kind: 'pieces',
    need: 5,
  },
  {
    key: 'fourWeeks',
    label: '4週連続',
    detail: '4週続けて公開',
    icon: 'calendar',
    kind: 'weeks',
    need: 4,
  },
  {
    key: 'ten',
    label: '10本',
    detail: '公開中の記事・作品が10本',
    icon: 'doc',
    kind: 'pieces',
    need: 10,
  },
];
export interface Milestones {
  reached: Milestone[];
  /** The first one in the ladder not yet reached, with how much is left. */
  next: { milestone: Milestone; left: number; unit: '本' | '週' } | null;
}
/**
 * `pieces` is the number of public articles plus projects; `bestWeeks` the longest weekly run.
 * Nothing public yet means nothing to celebrate: the grass already shows the first nudge.
 */
export function milestones(pieces: number, bestWeeks: number): Milestones {
  if (!(pieces > 0)) return { reached: [], next: null };
  const reached: Milestone[] = [];
  let next: Milestones['next'] = null;
  for (const { kind, need, ...milestone } of LADDER) {
    const have = kind === 'pieces' ? pieces : bestWeeks;
    if (have >= need) reached.push(milestone);
    else if (!next) next = { milestone, left: need - have, unit: kind === 'pieces' ? '本' : '週' };
  }
  return { reached, next };
}
