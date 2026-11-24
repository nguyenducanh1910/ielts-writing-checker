// Choose an error category when the AI's label is not exactly one of the teacher's labels:
// a near label ("Article" -> "Articles", "Verb tense" -> "Tense"), or the name of a
// criterion ("Grammatical Range and Accuracy", "Lexical") -> the category that fits the
// correction best ("a" added -> Articles, one misspelt word -> Spelling, ...).
import type { Criterion } from './constants';

export interface CategoryChoice {
  id: string;
  label: string;
  criterion?: string;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFC')
    .replace(/\(task \d\)/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Criterion names the AI sometimes puts in "category". */
const CRITERION_NAMES: Array<[RegExp, Criterion]> = [
  [/^(grammatical range( and accuracy)?|grammar|grammatical( accuracy)?|gra|ngữ pháp)$/, 'grammar'],
  [/^(lexical( resource)?|vocabulary|lr|từ vựng)$/, 'lexical'],
  [/^(coherence( and cohesion)?|cohesion|cc|mạch lạc)$/, 'coherence'],
  [/^(task( achievement| response)?|ta|tr|task achievement response)$/, 'task'],
];

/** Words in a label or a note -> the standard label they point to. Checked in order. */
const KEYWORDS: Array<[RegExp, string]> = [
  [/subject verb|agreement|hòa hợp|hoà hợp|chia động từ theo chủ ngữ/, 'Subject-verb agreement'],
  [/tense|\bthì\b|verb form|chia động từ/, 'Tense'],
  [/article|mạo từ|determiner/, 'Articles'],
  [/preposition|giới từ/, 'Prepositions'],
  [/conditional|câu điều kiện/, 'Conditionals'],
  [/passive|bị động/, 'Passive voice'],
  [/word order|trật tự từ|vị trí/, 'Word order'],
  [/run on|comma splice|câu ghép|câu dài/, 'Run-on sentence'],
  [
    /fragment|incomplete sentence|thiếu động từ|câu không hoàn chỉnh|câu thiếu|thiếu chủ ngữ/,
    'Sentence fragment',
  ],
  [/plural|countab|số nhiều|số ít|đếm được/, 'Plurals and countability'],
  [/relative|mệnh đề quan hệ/, 'Relative clauses'],
  [/sentence variety|complex sentence|câu phức|đa dạng cấu trúc/, 'Limited sentence variety'],
  [/punctuation|comma|capital|dấu câu|dấu phẩy|viết hoa/, 'Punctuation'],
  [/spelling|typo|chính tả/, 'Spelling'],
  [/collocation|kết hợp từ|cụm từ/, 'Collocation'],
  [/word form|part of speech|từ loại|dạng từ/, 'Word form'],
  [/repetit|lặp/, 'Repetition'],
  [/register|informal|colloquial|trang trọng|văn nói/, 'Informal register'],
  [/memori[sz]ed|cliché|cliche|học thuộc|sáo rỗng/, 'Memorised phrase'],
  [/imprecise|vague|mơ hồ|chung chung|không chính xác/, 'Imprecise vocabulary'],
  [/topic vocabulary|từ vựng chủ đề/, 'Limited topic vocabulary'],
  [/word choice|wrong word|vocabulary|dùng từ|chọn từ|từ vựng/, 'Word choice'],
  [/overuse|quá nhiều từ nối|lạm dụng/, 'Overuse of connectors'],
  [/linking|connector|cohesive device|transition|từ nối/, 'Linking words'],
  [/referenc|pronoun|đại từ|tham chiếu/, 'Referencing'],
  [/paragraph|đoạn văn|chia đoạn/, 'Paragraphing'],
  [/topic sentence|câu chủ đề/, 'Unclear topic sentence'],
  [/conclusion|kết bài|kết luận/, 'Missing conclusion'],
  [/progression|flow|logic|sequenc|mạch lạc|trình tự/, 'Illogical sequencing'],
  [/overview|tổng quan/, 'Missing overview (Task 1)'],
  [/inaccurate data|wrong data|số liệu sai|sai số liệu/, 'Inaccurate data'],
  [/key data|key feature|thiếu số liệu/, 'Missing key data'],
  [/off topic|lạc đề/, 'Off topic'],
  [/position|stance|quan điểm/, 'No clear position'],
  [/underdevelop|develop|example|support|phát triển|ví dụ|dẫn chứng/, 'Underdeveloped idea'],
  [/irrelevant|không liên quan/, 'Irrelevant detail'],
  [/overgenerali|khái quát/, 'Overgeneralisation'],
];

const ARTICLES = new Set(['a', 'an', 'the']);
const PREPOSITIONS = new Set(
  'in on at to for of with by from about into onto over under between among through during towards toward against without within upon across behind beyond'.split(
    ' ',
  ),
);
const BE_HAVE = new Set(
  'is are was were be been being has have had does do did will would'.split(' '),
);
const DETERMINERS = new Set(
  'a an the this that these those many few several some any each every both all most more less fewer two three four five'.split(
    ' ',
  ),
);
const LINKERS = new Set(
  'however moreover furthermore therefore thus besides although though because so but and also additionally consequently meanwhile nevertheless firstly secondly finally'.split(
    ' ',
  ),
);

const words = (s: string): string[] => [...(s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [])];

/** Words removed from `a` and added in `b` (longest common subsequence diff). */
function wordDiff(a: string[], b: string[]): { removed: string[]; added: string[] } {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) removed.push(a[i++]!);
    else added.push(b[j++]!);
  }
  while (i < n) removed.push(a[i++]!);
  while (j < m) added.push(b[j++]!);
  return { removed, added };
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur.push(
        Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)),
      );
    prev = cur;
  }
  return prev[b.length]!;
}

const stem = (w: string) => stem1(w).replace(/e$/, '');
const stem1 = (w: string) =>
  w.replace(/(ations?|ions?|ments?|ness|ity|ive|ively|ly|al|ally|ed|ing|es|s|er|est)$/, '');

/** Best guess from what the correction changed. '' when nothing is clear. */
export function guessFromCorrection(excerpt: string, correction: string): string {
  if (!correction.trim()) return '';
  const a = words(excerpt);
  const b = words(correction);
  if (a.join(' ') === b.join(' ')) return 'Punctuation'; // only punctuation / capitals changed
  const { removed, added } = wordDiff(a, b);
  const changed = [...removed, ...added];
  if (!changed.length) return '';
  if (changed.every((w) => ARTICLES.has(w))) return 'Articles';
  if (changed.every((w) => PREPOSITIONS.has(w))) return 'Prepositions';
  if (changed.every((w) => LINKERS.has(w))) return 'Linking words';
  if (removed.length === 1 && added.length === 1) {
    const [x, y] = [removed[0]!, added[0]!];
    const at = a.indexOf(x);
    const prev = at > 0 ? a[at - 1]! : '';
    const next = a[at + 1] ?? '';
    if ((y === x + 'ed' || y === x + 'd') && next === 'by') return 'Passive voice'; // cause by -> caused by
    if (x + 's' === y || y + 's' === x || x + 'es' === y || y + 'es' === x) {
      // this trends -> this trend (a determiner before it) / pollution cause -> causes
      if (BE_HAVE.has(x) || BE_HAVE.has(y)) return 'Subject-verb agreement';
      return DETERMINERS.has(prev) || /^\d/.test(prev)
        ? 'Plurals and countability'
        : 'Subject-verb agreement';
    }
    if (BE_HAVE.has(x) && BE_HAVE.has(y)) {
      const pair = [x, y].sort().join('/');
      return ['are/is', 'was/were', 'has/have', 'do/does'].includes(pair)
        ? 'Subject-verb agreement'
        : 'Tense';
    }
    if (/(ed|ing)$/.test(x) !== /(ed|ing)$/.test(y) && stem(x) === stem(y)) return 'Tense';
    if (stem(x) === stem(y) && stem(x).length >= 3) return 'Word form';
    if (editDistance(x, y) <= 2 && Math.min(x.length, y.length) >= 4) return 'Spelling';
    return 'Word choice';
  }
  if (changed.every((w) => BE_HAVE.has(w) || /ed$/.test(w))) return 'Tense';
  if (removed.length === 0 && added.length <= 2 && added.some((w) => BE_HAVE.has(w)))
    return 'Sentence fragment';
  // Same words in another order
  if ([...a].sort().join(' ') === [...b].sort().join(' ')) return 'Word order';
  return '';
}

const DEFAULT_FOR: Record<Criterion, string> = {
  grammar: 'Sentence fragment',
  lexical: 'Word choice',
  coherence: 'Linking words',
  task: 'Underdeveloped idea',
};

/**
 * The id of the category to use for an AI label, or null when there is no sensible choice
 * (the teacher then picks one, as before).
 */
export function resolveCategory(
  label: string,
  cats: CategoryChoice[],
  error: { excerpt?: string; correction?: string; note?: string } = {},
): string | null {
  const byNorm = new Map(cats.map((c) => [norm(c.label), c]));
  const find = (l: string) => byNorm.get(norm(l)) ?? null;
  const allowed = (c: CategoryChoice | null, crit: Criterion | null) =>
    c && (!crit || !c.criterion || c.criterion === crit) ? c : null;
  const l = norm(label);
  if (!l) return null;
  // 1. Same label (ignoring case, punctuation, plural "s", "(Task 1)")
  const same =
    byNorm.get(l) ?? cats.find((c) => norm(c.label).replace(/s$/, '') === l.replace(/s$/, ''));
  if (same) return same.id;
  // 2. The label is a criterion name: guess within that criterion
  const crit = CRITERION_NAMES.find(([re]) => re.test(l))?.[1] ?? null;
  if (!crit) {
    // 3. Keywords in the label ("Verb tense", "Wrong preposition", "Missing article")
    for (const [re, target] of KEYWORDS) if (re.test(l) && find(target)) return find(target)!.id;
    // 4. A label that contains (or is contained in) one of the teacher's labels
    const part = cats.find((c) => {
      const n = norm(c.label);
      return n.length >= 4 && (l.includes(n) || n.includes(l));
    });
    if (part) return part.id;
  }
  // 5. What the correction changed, then the explanation's words
  const fromFix = allowed(
    find(guessFromCorrection(error.excerpt ?? '', error.correction ?? '')),
    crit,
  );
  if (fromFix) return fromFix.id;
  const note = norm(error.note ?? '');
  if (note) {
    for (const [re, target] of KEYWORDS) {
      const c = allowed(find(target), crit);
      if (c && re.test(note)) return c.id;
    }
  }
  // 6. The criterion's usual category
  if (crit) {
    const c = find(DEFAULT_FOR[crit]) ?? cats.find((x) => x.criterion === crit) ?? null;
    if (c) return c.id;
  }
  return null;
}
