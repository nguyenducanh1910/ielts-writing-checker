// Word count in the style of the computer-delivered IELTS test: any run of
// non-space characters that contains a letter or digit counts as one word.
// Hyphenated words and contractions count once; numbers count as words.

export function countWords(text: string): number {
  if (!text) return 0;
  let count = 0;
  for (const token of text.split(/\s+/)) {
    if (/[\p{L}\p{N}]/u.test(token)) count++;
  }
  return count;
}
