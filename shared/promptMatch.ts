// Copy of IELTS Harper Portal's shared/promptMatch.ts (keep the two the same).
// Fills in IELTS Harper's categories for a prompt picked from the Task 2 prompt bank: the essay
// type from the bank's question type, and the closest Harper topic from the bank's topics.

/** Bank question type -> Harper essay type. */
export const ESSAY_TYPE_FOR: Record<string, string> = {
  agree_disagree: 'agree_disagree',
  discussion: 'discussion',
  advantages: 'pros_cons',
  positive_negative: 'pros_cons',
  causes_solutions: 'res',
  // "Others" in the bank are mostly two-part questions ("Why ..., and how ...?").
  other: 'two_part',
};

/** Bank topic -> Harper topic labels to try, best first (Harper's default topic list). */
const HARPER_TOPIC_FOR: Record<string, string[]> = {
  'Age, generation, and gender': ['Family', 'Society'],
  Animals: ['Environment'],
  'Art and museums': ['Culture'],
  'City development': ['Society', 'Transport', 'Government'],
  Climate: ['Environment'],
  'Crime, punishment, and law': ['Crime'],
  'Economy, money, and trade': ['Economy'],
  Education: ['Education'],
  Environment: ['Environment'],
  Ethics: ['Society'],
  'Food and health': ['Health'],
  'Government, politics, and diplomacy': ['Government'],
  Language: ['Culture', 'Education'],
  'Leisure, sports, and hobbies': ['Culture', 'Health'],
  Lifestyle: ['Society', 'Health'],
  'Media and communication': ['Media'],
  Population: ['Society'],
  'Science, technology, and innovation': ['Technology', 'Science'],
  'Socio-cultural and global issues': ['Society', 'Globalisation', 'Culture'],
  Traffic: ['Transport'],
  'Travelling and tourism': ['Culture', 'Globalisation', 'Transport'],
  Work: ['Work'],
};

/**
 * The Harper topic for a bank prompt: for its main topic (then the others), a Harper topic with
 * the same name or the closest default topic; else "Other". Null when Harper has none of them.
 */
export function harperTopicFor(
  bankTopics: string[],
  harperTopics: { id: string; label: string }[],
): string | null {
  const byLabel = new Map(harperTopics.map((t) => [t.label.trim().toLowerCase(), t.id]));
  const find = (label: string) => byLabel.get(label.trim().toLowerCase());
  // The main topic decides when it can; the others only when it has no match.
  for (const topic of bankTopics) {
    for (const label of [topic, ...(HARPER_TOPIC_FOR[topic] ?? [])]) {
      const id = find(label);
      if (id) return id;
    }
  }
  return find('Other') ?? null;
}
