// Fake Gemini API for the mock server: a valid scoring answer for the first turn, a reconcile
// answer ({notes, result}) when the conversation has three turns. Uses the first tagged error
// of Claude's draft so excerpts stay in the essay.
import type { HttpRequest, HttpResponse } from '../apps-script/src/services';

function answer(json: unknown): HttpResponse {
  return {
    status: 200,
    text: JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }],
      usageMetadata: { promptTokenCount: 4000, candidatesTokenCount: 900 },
    }),
  };
}

const feedback = (who: string) => ({
  task: `${who}: trả lời đủ ý, cần ví dụ cụ thể hơn.`,
  coherence: `${who}: bố cục rõ ràng.`,
  lexical: `${who}: từ vựng đủ dùng, còn lặp từ.`,
  grammar: `${who}: còn lỗi chia động từ.`,
});

export function fakeGemini(req: HttpRequest): HttpResponse {
  if (!req.url.includes('generativelanguage.googleapis.com')) return { status: 404, text: '{}' };
  const body = JSON.parse(req.body) as { contents: Array<{ parts: Array<{ text?: string }> }> };
  if (body.contents.length < 3) {
    return answer({
      scores: { task: 7, coherence: 6.5, lexical: 6.5, grammar: 6 },
      feedback: feedback('Gemini'),
      general_comment: 'Bài viết khá tốt.',
      suggested_topic: '',
      errors: [],
    });
  }
  const prompt = body.contents[2].parts.map((p) => p.text ?? '').join('');
  const m = /Examiner A \(Claude\)[^{]*(\{[\s\S]*?\n\})\n/.exec(prompt);
  let errors: unknown[];
  try {
    errors = m ? (JSON.parse(m[1]) as { errors: unknown[] }).errors : [];
  } catch {
    errors = [];
  }
  return answer({
    notes:
      '1. Lệch nhau: Task (Claude thấp hơn Gemini 1 band).\n2. Lập luận: thiếu ví dụ.\n3. Đề xuất: Task 6.5, các tiêu chí khác giữ nguyên.',
    result: {
      scores: { task: 6.5, coherence: 6, lexical: 6, grammar: 6 },
      feedback: feedback('Đối chiếu'),
      general_comment: 'Kết quả đối chiếu Claude + Gemini.',
      suggested_topic: '',
      errors,
    },
  });
}
