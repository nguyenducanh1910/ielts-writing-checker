import { describe, expect, it } from 'vitest';
import { ESSAY_TYPE_IDS, SEED_TOPICS, OTHER_TOPIC_LABEL } from '../../shared/constants';
import { ESSAY_TYPE_FOR, harperTopicFor } from '../../shared/promptMatch';
import { BANK_TOPICS, PROMPT_BANK } from '../../src/data/promptBank';

const TOPICS = [...SEED_TOPICS, OTHER_TOPIC_LABEL].map((label, i) => ({ id: `t${i}`, label }));
const labelOf = (id: string | null) => TOPICS.find((t) => t.id === id)?.label;

describe('Task 2 prompt bank', () => {
  it('has 331 prompts within the prompt limits', () => {
    expect(PROMPT_BANK).toHaveLength(331);
    for (const p of PROMPT_BANK) {
      expect(p.prompt.length).toBeGreaterThanOrEqual(10);
      expect(p.prompt.length).toBeLessThanOrEqual(4000);
      expect(p.topics.every((t) => BANK_TOPICS.includes(t))).toBe(true);
    }
  });

  it("maps every question type to one of Harper's essay types", () => {
    for (const p of PROMPT_BANK) expect(ESSAY_TYPE_IDS).toContain(ESSAY_TYPE_FOR[p.type]);
  });

  it('finds one of the default Harper topics (not "Other") for every bank topic', () => {
    for (const topic of BANK_TOPICS) {
      expect(labelOf(harperTopicFor([topic], TOPICS)), topic).not.toBe(OTHER_TOPIC_LABEL);
    }
    // The main topic decides: Traffic -> Transport even though Environment is also listed.
    expect(labelOf(harperTopicFor(['Traffic', 'Environment'], TOPICS))).toBe('Transport');
  });
});
