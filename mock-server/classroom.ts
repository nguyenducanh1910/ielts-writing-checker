// Mock of the class management web app (Code.gs "WEB PORTAL API") for local development and
// Playwright. Same contract: {action, token, payload} -> {ok, data} | {ok: false, error}.
// Like the real one, it asks the Writing back end who the token belongs to (me.get).
import { callApi } from '../apps-script/src/api';
import type { MemoryServices } from '../apps-script/testing/memory';

type Json = Record<string, unknown>;
type Envelope =
  { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } };

const DAY = 86400e3;
const CLASSES = [
  {
    id: 'c232',
    name: 'K232 5.5 TM - BTVN',
    section: 'Tối 2-4-6',
    link: 'https://classroom.google.com/c/c232',
    hasPenaltyFile: true,
  },
  {
    id: 'c230',
    name: 'K230 5.5 TC - BTVN',
    section: 'Tối 3-5-7',
    link: 'https://classroom.google.com/c/c230',
    hasPenaltyFile: true,
  },
];
const NAMES: Record<string, Array<[string, string]>> = {
  c232: [
    ['Nguyen Van An', 'demo.an@example.com'],
    ['Tran Thi Binh', 'demo.binh@example.com'],
    ['Hoàng Quang Vinh', 'vinh@example.com'],
    ['Đỗ Quang Minh', 'minh@example.com'],
    ['Lê Ngọc Ánh', 'anh@example.com'],
    ['Phạm Gia Huy', 'huy@example.com'],
    ['Trần Yến Nhi', 'nhi@example.com'],
    ['Vũ Thành Đạt', 'dat@example.com'],
  ],
  c230: [
    ['Nguyễn Hương Ly', 'ly@example.com'],
    ['Bùi Minh Châu', 'chau@example.com'],
    ['Đặng Khánh Linh', 'linh@example.com'],
    ['Phan Đức Long', 'long@example.com'],
    ['Mai Anh Thư', 'thu@example.com'],
  ],
};

interface Sub {
  id: string;
  className: string;
  title: string;
  skill: string;
  student: string;
  email: string;
  status: string;
  turnedInAt: string;
  dueAt: string;
  score: string;
  band: string;
  summary: string;
  feedbackFile: string;
  gradeStatus: string;
  gradeKind: string;
  gradedAt: string;
  approved: boolean;
  sentAt: string;
  files: string[];
  courseWorkId: string;
  courseId: string;
  assignmentLink: string;
}

interface Cw {
  id: string;
  title: string;
  courseId: string;
  className: string;
  dueAt: string;
  skills: string[];
  link: string;
}

function seed(now: number) {
  let rnd = 7;
  const r = () => (rnd = (rnd * 9301 + 49297) % 233280) / 233280;
  const iso = (t: number) => new Date(t).toISOString();
  const cws: Cw[] = [];
  const subs: Sub[] = [];
  const plan: Array<[string, number, string, string[]]> = [
    ['L21 RW', -9, 'c232', ['Reading (Academic)', 'Writing Task 2']],
    ['L22 LS', -6, 'c232', ['Listening', 'Speaking']],
    ['L23 RW', -2, 'c232', ['Reading (Academic)', 'Writing Task 1']],
    ['L24 LS', 3, 'c232', ['Listening', 'Speaking']],
    ['L17 RW', -5, 'c230', ['Reading (Academic)', 'Writing Task 2']],
    ['L18 LS', -1, 'c230', ['Listening', 'Speaking']],
    ['L19 RW', 4, 'c230', ['Reading (Academic)', 'Writing Task 2']],
  ];
  plan.forEach(([title, dueDays, courseId, skills], wi) => {
    const cls = CLASSES.find((c) => c.id === courseId)!;
    const due = now + dueDays * DAY;
    const cw: Cw = {
      id: `cw${wi + 1}`,
      title,
      courseId,
      className: cls.name,
      dueAt: iso(due),
      skills,
      link: `https://classroom.google.com/c/${courseId}/a/cw${wi + 1}`,
    };
    cws.push(cw);
    NAMES[courseId].forEach(([name, email], si) => {
      const open = dueDays > 0;
      const x = r();
      const status = open
        ? x < 0.45
          ? 'Đã nộp'
          : 'Chưa nộp'
        : x < 0.75
          ? 'Đã nộp'
          : x < 0.88
            ? 'Nộp muộn'
            : 'Chưa nộp';
      const turned =
        status !== 'Chưa nộp'
          ? iso(due - (status === 'Nộp muộn' ? -5 : 20) * 3600e3 + si * 60e3)
          : '';
      skills.forEach((skill) => {
        const s: Sub = {
          id: `${cw.id}-${si}#${skill}`,
          className: cls.name,
          title,
          skill,
          student: name,
          email,
          status,
          turnedInAt: turned,
          dueAt: cw.dueAt,
          score: '',
          band: '',
          summary: '',
          feedbackFile: '',
          gradeStatus: '',
          gradeKind: 'waiting',
          gradedAt: '',
          approved: false,
          sentAt: '',
          files: turned
            ? [`https://drive.google.com/file/d/${cw.id}${si}${skill.length}/view`]
            : [],
          courseWorkId: cw.id,
          courseId,
          assignmentLink: cw.link,
        };
        if (turned) {
          if (/^Reading|^Listening/.test(skill)) {
            const total = skill === 'Listening' ? 20 : 13;
            const c = Math.min(total, Math.round(total * (0.45 + r() * 0.55)));
            s.score = `${c}/${total}`;
            s.gradeStatus = 'Đã chấm';
            s.gradeKind = dueDays < 0 ? 'sent' : 'graded';
            s.sentAt = dueDays < 0 ? iso(due + 3600e3) : '';
          } else if (/^Writing/.test(skill)) {
            const done = dueDays < -4;
            s.gradeStatus = done ? 'Đã chấm trên web' : 'Đã gửi lên web Writing';
            s.gradeKind = done ? 'sent' : 'web';
            s.band = done ? String(5 + Math.round(r() * 3) / 2) : '';
            s.sentAt = done ? iso(due + 2 * DAY) : '';
            s.feedbackFile = '#/admin';
          } else {
            const b = 5 + Math.round(r() * 4) / 2;
            const kind =
              si === 3 && title === 'L18 LS' ? 'error' : dueDays < -5 ? 'sent' : 'review';
            s.band = kind === 'error' ? '' : String(b);
            s.gradeKind = kind;
            s.gradeStatus =
              kind === 'error'
                ? 'Lỗi — cần kiểm tra tay: File "ghiam.amr" là ghi âm/video nhưng định dạng chưa đọc được. Nhờ HS đổi sang mp3/m4a và nộp lại.'
                : 'Đã chấm (AI) — chờ duyệt';
            s.summary =
              kind === 'error'
                ? ''
                : 'Em trả lời đủ ý, nói khá trôi chảy ở Part 1.\nĐiểm mạnh:\n- Phát âm rõ, ít ngập ngừng\nCần cải thiện:\n- Part 2 còn ngắn, cần thêm ví dụ\n- Lỗi thì quá khứ: "I go there last year" → "I went there last year"';
            s.sentAt = kind === 'sent' ? iso(due + DAY) : '';
            s.feedbackFile = kind === 'error' ? '' : 'https://docs.google.com/document/d/mock/edit';
          }
        }
        subs.push(s);
      });
    });
  });
  return { cws, subs };
}

function itemAnalysis() {
  const keys = [
    'vi',
    'iii',
    'viii',
    'ii',
    'v',
    'TRUE',
    'NOT GIVEN',
    'FALSE',
    'C',
    'A',
    'canals',
    'trade',
    'harbour',
  ];
  const ps = [0.89, 0.94, 0.28, 0.83, 0.61, 0.78, 0.22, 0.61, 0.89, 0.72, 0.5, 0.67, 0.33];
  const ds = [0.33, 0.11, 0.5, 0.11, 0.56, 0.22, -0.11, 0.33, 0.0, 0.33, 0.44, 0.22, 0.56];
  return {
    key: 'cw3|Reading (Academic)',
    courseWorkId: 'cw3',
    className: 'K232 5.5 TM - BTVN',
    title: 'L23 RW',
    part: 'Reading (Academic)',
    updatedAt: new Date(Date.now() - 2 * DAY + 3600e3).toISOString(),
    summary: {
      average: '8.9/13',
      students: 7,
      notDone: '1 HS chưa làm',
      note: 'Chữa kỹ: câu 3, 7 · Xem lại: câu 7',
      distribution: 'Vững: 3 · Đạt: 3 · Cần ôn lại: 1',
      groups: 'Nhóm G/Y: 3 HS mỗi nhóm (lớp < 20 HS: chia đôi)',
    },
    items: keys.map((k, i) => {
      const n = 7,
        right = Math.round(ps[i] * n);
      const p = right / n,
        d = ds[i];
      const flags = [
        p < 0.3 ? 'Chữa kỹ (p < 0.30)' : '',
        d < 0 ? 'Xem lại câu hỏi/đáp án (D < 0)' : '',
      ]
        .filter(Boolean)
        .join('; ');
      return {
        q: String(i + 1),
        key: k,
        n,
        right,
        wrong: n - right,
        p: Math.round(p * 100) / 100,
        pLabel: p >= 0.65 ? 'Dễ' : p >= 0.45 ? 'Trung bình' : 'Khó',
        d,
        dLabel: d >= 0.4 ? 'Rất tốt' : d >= 0.3 ? 'Tốt' : d >= 0.2 ? 'Chấp nhận' : 'Kém',
        expected: `p≈${(0.4 + (i % 5) / 10).toFixed(2)} D≈0.4${i % 3}`,
        common: n - right ? `${['A', 'B', 'iv', 'TRUE'][i % 4]} (${n - right})` : '',
        flags,
      };
    }),
  };
}

function penalty(courseId: string, subs: Sub[]) {
  const cols: Array<{ session: string; week: string; skill: string }> = [];
  const weeks = ['Tuần 2-7/11', 'Tuần 9-14/11'];
  const sess =
    courseId === 'c232'
      ? [
          ['L23', 'R + W'],
          ['L24', 'L + S'],
          ['L25', 'R + W'],
          ['L26', 'L + S'],
        ]
      : [
          ['L18', 'L + S'],
          ['L19', 'R + W'],
          ['L20', 'L + S'],
        ];
  sess.forEach(([s, t], i) => {
    const [a, b] = t === 'R + W' ? ['reading', 'writing'] : ['listening', 'speaking'];
    cols.push(
      { session: s, week: weeks[Math.floor(i / 2)] ?? weeks[1], skill: a },
      { session: s, week: weeks[Math.floor(i / 2)] ?? weeks[1], skill: b },
    );
  });
  const names = NAMES[courseId].map(([n]) => n);
  const rows = names.map((name, ni) => {
    const values = cols.map((_c, ci) =>
      ci >= 4 ? '' : (ni + ci) % 7 === 0 ? 'Missed 10k' : (ni + ci) % 5 === 0 ? 'Late' : 'Done',
    );
    const w: Record<string, number> = {};
    cols.forEach((c, i) => {
      if (values[i] === 'Missed 10k') w[c.week] = (w[c.week] ?? 0) + 10;
    });
    return { name, values, fine: Object.values(w).reduce((s, x) => s + x, 0), weeks: w };
  });
  void subs;
  return { cols, rows };
}

export function createClassroomMock(getSvc: () => MemoryServices) {
  let state = seed(Date.now());
  const assignRows: Json[] = [
    {
      row: 3,
      className: 'K232 5.5 TM - BTVN',
      session: 'L24',
      type: 'Listening + Speaking',
      folder: 'https://drive.google.com/drive/folders/L24',
      dueAt: state.cws[3].dueAt,
      publish: true,
      status: 'Đã giao',
      link: state.cws[3].link,
      detail:
        'Listening: 20 câu, đủ đáp án\nSpeaking: chấm từ file ghi âm — đề: "Speaking cue card.docx"',
    },
    {
      row: 2,
      className: 'K232 5.5 TM - BTVN',
      session: 'L23',
      type: 'Reading + Writing',
      folder: 'https://drive.google.com/drive/folders/L23',
      dueAt: state.cws[2].dueAt,
      publish: true,
      status: 'Đã giao',
      link: state.cws[2].link,
      detail: 'Reading: 13 câu, đủ đáp án\nWriting: Task 1 (có ảnh biểu đồ)',
    },
  ];

  const who = (token: string) => {
    const res = callApi(getSvc(), JSON.stringify({ action: 'me.get', token }));
    if (!res.ok)
      throw Object.assign(new Error('Vui lòng đăng nhập lại.'), { code: 'unauthenticated' });
    const u = res.data as { email: string; role: string; name: string };
    return { email: u.email.toLowerCase(), role: u.role, name: u.name };
  };
  const fail = (code: string, message: string): never => {
    throw Object.assign(new Error(message), { code });
  };
  const counts = (rows: Sub[]) => ({
    review: rows.filter((s) => s.gradeKind === 'review').length,
    approved: rows.filter((s) => s.gradeKind === 'approved').length,
    error: rows.filter((s) => s.gradeKind === 'error').length,
    web: rows.filter((s) => s.gradeKind === 'web').length,
    missing: rows.filter((s) => /Chưa/.test(s.status)).length,
    all: rows.length,
  });
  const findSub = (id: unknown) =>
    state.subs.find((s) => s.id === id) ?? fail('not_found', 'Không tìm thấy bài nộp này.');

  const teacher: Record<string, (p: Json) => unknown> = {
    overview: () => {
      const now = Date.now();
      return {
        teacherName: 'Thầy Đức Anh',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/mock/edit',
        classes: CLASSES.map((c) => ({ ...c, students: NAMES[c.id].length })),
        todo: {
          review: counts(state.subs).review,
          approved: counts(state.subs).approved,
          error: counts(state.subs).error,
          web: counts(state.subs).web,
        },
        assignments: state.cws
          .filter(
            (w) => Date.parse(w.dueAt) > now - 7 * DAY && Date.parse(w.dueAt) < now + 14 * DAY,
          )
          .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
          .map((w) => {
            const mine = state.subs.filter(
              (s) => s.courseWorkId === w.id && s.skill === w.skills[0],
            );
            return {
              id: w.id,
              title: w.title,
              className: w.className,
              courseId: w.courseId,
              dueAt: w.dueAt,
              total: mine.length,
              onTime: mine.filter((s) => s.status === 'Đã nộp').length,
              late: mine.filter((s) => s.status === 'Nộp muộn').length,
              missing: mine.filter((s) => s.status === 'Chưa nộp').length,
              missingNames: mine.filter((s) => s.status === 'Chưa nộp').map((s) => s.student),
              link: w.link,
              skills: w.skills,
            };
          }),
        log: [
          {
            at: new Date(now - 40 * 60e3).toISOString(),
            event: 'Chạy tự động',
            detail: 'Đồng bộ 7 bài, 54 bài nộp | Chấm 6 bài | File phạt: điền 12 ô',
          },
          {
            at: new Date(now - 5 * 3600e3).toISOString(),
            event: 'Báo cáo',
            detail: 'Đã gửi báo cáo tới thầy',
          },
          {
            at: new Date(now - 26 * 3600e3).toISOString(),
            event: 'Nhắc nhở',
            detail: 'Đã gửi nhắc nhở cho 4 học sinh.',
          },
        ],
      };
    },
    'submissions.list': (p) => {
      let rows = state.subs.slice();
      if (p.courseId) rows = rows.filter((s) => s.courseId === p.courseId);
      if (p.courseWorkId) rows = rows.filter((s) => s.courseWorkId === p.courseWorkId);
      if (p.q)
        rows = rows.filter((s) =>
          `${s.student} ${s.email} ${s.title}`.toLowerCase().includes(String(p.q).toLowerCase()),
        );
      const c = counts(rows);
      const view = ['review', 'approved', 'error', 'web', 'missing', 'all'].includes(String(p.view))
        ? String(p.view)
        : 'review';
      const pick: Record<string, (s: Sub) => boolean> = {
        review: (s) => s.gradeKind === 'review',
        approved: (s) => s.gradeKind === 'approved',
        error: (s) => s.gradeKind === 'error',
        web: (s) => s.gradeKind === 'web',
        missing: (s) => /Chưa/.test(s.status),
        all: () => true,
      };
      rows = rows
        .filter(pick[view])
        .sort((a, b) => (b.turnedInAt || b.dueAt).localeCompare(a.turnedInAt || a.dueAt));
      return {
        view,
        counts: c,
        total: rows.length,
        rows: rows.slice(0, 300),
        classes: CLASSES.map((x) => ({ id: x.id, name: x.name })),
        assignments: state.cws
          .filter((w) => !p.courseId || w.courseId === p.courseId)
          .map((w) => ({ id: w.id, title: w.title, className: w.className })),
      };
    },
    'submissions.files': (p) => {
      const s = findSub(p.id);
      return {
        files: s.files.map((url, i) => ({
          id: `f${i}`,
          url,
          size: /Speaking/.test(s.skill) ? 2_400_000 : 48_000,
          name: /Speaking/.test(s.skill)
            ? s.gradeKind === 'error'
              ? 'ghiam.amr'
              : `${s.student} - Speaking.m4a`
            : `${s.student} - ${s.skill}.docx`,
          mime: /Speaking/.test(s.skill) ? 'audio/mp4' : 'application/vnd.google-apps.document',
          kind: /Speaking/.test(s.skill) ? 'audio' : 'doc',
        })),
      };
    },
    'submissions.update': (p) => {
      const s = findSub(p.id);
      if (s.sentAt) fail('bad_request', 'Bài này đã gửi kết quả cho học sinh, không sửa được nữa.');
      if (p.band !== undefined) {
        const b = String(p.band).trim();
        if (b && !(Number(b) >= 0 && Number(b) <= 9 && Number(b) * 2 === Math.round(Number(b) * 2)))
          fail('bad_request', 'Band phải từ 0 đến 9, bước 0.5.');
        s.band = b;
      }
      if (p.summary !== undefined) s.summary = String(p.summary);
      if (p.approve !== undefined) {
        s.approved = p.approve === true;
        s.gradeKind = s.approved ? 'approved' : 'review';
      }
      let message = 'Đã lưu.';
      if (p.approve === true && p.sendNow === true) {
        s.sentAt = new Date().toISOString();
        s.gradeKind = 'sent';
        message = 'Đã gửi 1 nhận xét.';
      }
      return { message, row: s };
    },
    'submissions.regrade': (p) => {
      const s = findSub(p.id);
      s.gradeKind = 'waiting';
      s.gradeStatus = 'Chờ chấm';
      return {
        message: 'Hệ thống sẽ chấm lại bài này ở lần chạy tự động kế tiếp (trong vòng 1 giờ).',
      };
    },
    'submissions.sendApproved': () => {
      const list = state.subs.filter((s) => s.gradeKind === 'approved');
      list.forEach((s) => {
        s.gradeKind = 'sent';
        s.sentAt = new Date().toISOString();
      });
      return {
        message: list.length ? `Đã gửi ${list.length} nhận xét.` : 'Không có nhận xét nào chờ gửi.',
      };
    },
    'assign.options': () => ({
      classes: CLASSES.map((c) => ({ id: c.id, name: c.name })),
      types: [
        'Reading + Writing',
        'Listening + Speaking',
        'Reading',
        'Listening',
        'Writing',
        'Speaking',
      ],
      timeZone: 'Asia/Ho_Chi_Minh',
    }),
    'assign.list': () => ({ rows: assignRows }),
    'assign.check': (p) => {
      if (!/drive\.google\.com/.test(String(p.folder)))
        fail('bad_request', 'Không mở được thư mục Drive (link sai hoặc không có quyền)');
      return {
        summary: String(p.type).startsWith('Reading')
          ? 'Reading: 13 câu, đủ đáp án (1–5 Headings; 6–8 TRUE/FALSE/NOT GIVEN; 9–10 MCQ; 11–13 Completion)\nWriting: Task 2'
          : 'Listening: 20 câu, đủ đáp án\nSpeaking: chấm từ file ghi âm',
        warnings: [],
      };
    },
    'assign.create': (p) => {
      const row = {
        row: assignRows.length + 2,
        className: p.className,
        session: p.session,
        type: p.type,
        folder: p.folder,
        dueAt: new Date(String(p.dueAt)).toISOString(),
        publish: p.publish,
        status: p.publish ? 'Đã giao' : 'Đã giao (bản nháp — vào Classroom bấm Giao)',
        link: 'https://classroom.google.com/c/mock/a/new',
        detail: 'Reading: 13 câu, đủ đáp án',
      };
      assignRows.unshift(row);
      return { ok: true, status: row.status, link: row.link, summary: row.detail };
    },
    'results.items': () => {
      const sel = itemAnalysis();
      return {
        list: [
          {
            key: sel.key,
            className: sel.className,
            title: sel.title,
            part: sel.part,
            updatedAt: sel.updatedAt,
          },
          {
            key: 'cw2|Listening',
            className: sel.className,
            title: 'L22 LS',
            part: 'Listening',
            updatedAt: sel.updatedAt,
          },
        ],
        selected: sel,
      };
    },
    'results.scores': (p) => {
      const courseId = String(p.courseId || 'c232');
      const cws = state.cws.filter((w) => w.courseId === courseId);
      return {
        courseId,
        classes: CLASSES.map((c) => ({ id: c.id, name: c.name })),
        assignments: cws.map((w) => ({ id: w.id, title: w.title, dueAt: w.dueAt })),
        students: NAMES[courseId].map(([name, email]) => ({
          email,
          name,
          cells: Object.fromEntries(
            cws.map((w) => [
              w.id,
              state.subs
                .filter((s) => s.courseWorkId === w.id && s.email === email)
                .map((s) => ({
                  skill: s.skill,
                  status: s.status,
                  score: s.score,
                  band: s.band,
                  gradeKind: s.gradeKind,
                  id: s.id,
                })),
            ]),
          ),
        })),
      };
    },
    'penalty.class': (p) => {
      const courseId = String(p.courseId || 'c232');
      const { cols, rows } = penalty(courseId, state.subs);
      return {
        classes: CLASSES.map((c) => ({ id: c.id, name: c.name })),
        courseId,
        tab: 'Extra homework T11',
        tabs: ['Extra homework T10', 'Extra homework T11'],
        url: 'https://docs.google.com/spreadsheets/d/pen/edit',
        columns: cols,
        rows: rows.sort((a, b) => b.fine - a.fine),
        total: rows.reduce((s, r) => s + r.fine, 0),
        fineUnit: 10,
      };
    },
  };

  const student = (email: string) => {
    const mine = state.subs.filter((s) => s.email === email);
    if (!mine.length) return { matched: false, email };
    const now = Date.now();
    const byCw = new Map<string, Sub[]>();
    mine.forEach((s) => byCw.set(s.courseWorkId, [...(byCw.get(s.courseWorkId) ?? []), s]));
    const assignments = [...byCw.values()]
      .map((rows) => {
        const r0 = rows[0];
        return {
          id: r0.courseWorkId,
          title: r0.title,
          className: r0.className,
          dueAt: r0.dueAt,
          status: r0.status,
          turnedInAt: r0.turnedInAt,
          link: r0.assignmentLink,
          overdue: Date.parse(r0.dueAt) < now && /Chưa/.test(r0.status),
          parts: rows.map((s) => ({
            skill: s.skill,
            state: s.sentAt ? 'sent' : s.turnedInAt ? 'grading' : 'todo',
            score: s.sentAt ? s.score : '',
            band: s.sentAt ? s.band : '',
            summary: s.sentAt ? s.summary : '',
            sentAt: s.sentAt,
            feedbackFile: s.sentAt && /^https:\/\/docs/.test(s.feedbackFile) ? s.feedbackFile : '',
          })),
        };
      })
      .sort((a, b) => b.dueAt.localeCompare(a.dueAt));
    const bands: Record<string, number[]> = {
      Reading: [],
      Listening: [],
      Writing: [],
      Speaking: [],
    };
    assignments.forEach((a) =>
      a.parts.forEach((pt) => {
        const k = Object.keys(bands).find((x) => pt.skill.startsWith(x));
        if (k && pt.band) bands[k].push(Number(pt.band));
      }),
    );
    const past = assignments.filter((a) => Date.parse(a.dueAt) < now);
    const cls = CLASSES.find((c) => c.name === mine[0].className)!;
    const pen = penalty(cls.id, state.subs);
    const me = pen.rows.find((r) => r.name === mine[0].student)!;
    return {
      matched: true,
      email,
      name: mine[0].student,
      classes: [cls.name],
      stats: {
        assignments: assignments.length,
        pastDue: past.length,
        submitted: past.filter((a) => a.turnedInAt).length,
        pending: assignments.filter((a) => !a.turnedInAt && !a.overdue).length,
        overdue: assignments.filter((a) => a.overdue).length,
        bands: Object.fromEntries(
          Object.entries(bands).map(([k, v]) => [
            k,
            v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null,
          ]),
        ),
      },
      assignments,
      penalty: [
        {
          className: cls.name,
          tab: 'Extra homework T11',
          fine: me.fine,
          weeks: me.weeks,
          items: pen.cols.map((c, i) => ({ ...c, value: me.values[i] })).filter((x) => x.value),
        },
      ],
    };
  };

  return {
    reset() {
      state = seed(Date.now());
    },
    handle(raw: string): Envelope {
      try {
        let body: Json;
        try {
          body = JSON.parse(raw) as Json;
        } catch {
          return fail('bad_request', 'Yêu cầu không hợp lệ.');
        }
        const action = String(body.action ?? '');
        const payload = (body.payload ?? {}) as Json;
        if (!teacher[action] && action !== 'me.classroom')
          fail('bad_request', `Không có thao tác "${action}".`);
        const user = who(String(body.token ?? ''));
        if (action === 'me.classroom') return { ok: true, data: student(user.email) };
        if (user.role !== 'admin') fail('forbidden', 'Chỉ giáo viên được dùng mục này.');
        return { ok: true, data: teacher[action](payload) };
      } catch (err) {
        const e = err as Error & { code?: string };
        return { ok: false, error: { code: e.code ?? 'server_error', message: e.message } };
      }
    },
  };
}
