// setup(): creates every tab with headers and seeds lists and demo data.
// Safe to run more than once: existing tabs and rows are kept.
import { overallBand } from '../../shared/band';
import {
  DEFAULT_SETTINGS,
  OTHER_TOPIC_LABEL,
  SEED_CLASSES,
  SEED_ERROR_CATEGORIES,
  SEED_SOURCES,
  SEED_TOPICS,
  type TaskType,
} from '../../shared/constants';
import { addDays, endOfDayUtc } from '../../shared/dates';
import { countWords } from '../../shared/wordCount';
import { adminEmails, adminTimezone, createCtx, type Ctx } from './context';
import { archiveEssay, saveUploadedImage } from './drive';
import { SCHEMA, TABLE_NAMES } from './schema';
import type { Services } from './services';

/** A tiny PNG used as the demo chart image. */
const DEMO_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export interface SetupResult {
  createdTabs: string[];
  addedColumns: string[];
  seeded: string[];
}

export function runSetup(svc: Services, options: { demo?: boolean } = {}): SetupResult {
  const createdTabs: string[] = [];
  const addedColumns: string[] = [];
  for (const name of TABLE_NAMES) {
    let sheet = svc.spreadsheet.getSheetByName(name);
    if (!sheet) {
      sheet = svc.spreadsheet.insertSheet(name);
      createdTabs.push(name);
    }
    const columns = SCHEMA[name] as readonly string[];
    // Plain text everywhere so Sheets never converts dates, numbers or formulas.
    sheet.getRange(1, 1, sheet.getMaxRows(), columns.length).setNumberFormat('@');
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, columns.length).setValues([[...columns]]);
    } else {
      // Columns added in later versions go at the end of an existing header row.
      const width = Math.max(sheet.getLastColumn(), 1);
      const header = sheet
        .getRange(1, 1, 1, width)
        .getValues()[0]
        .map((h) => String(h ?? '').trim());
      const missing = columns.filter((c) => !header.includes(c));
      if (missing.length) {
        const used = header.filter(Boolean).length;
        sheet.getRange(1, used + 1, 1, missing.length).setNumberFormat('@');
        sheet.getRange(1, used + 1, 1, missing.length).setValues([missing]);
        addedColumns.push(...missing.map((c) => `${name}.${c}`));
      }
    }
    sheet.setFrozenRows(1);
  }

  const ctx = createCtx(svc);
  const seeded: string[] = [];
  const { db } = ctx;

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (!db.findOne('Settings', (r) => r.key === key)) {
      db.insert('Settings', { key, value });
      seeded.push(`setting ${key}`);
    }
  }
  if (db.all('Classes').length === 0) {
    SEED_CLASSES.forEach((label) => db.insert('Classes', { id: svc.uuid(), label, active: true }));
    seeded.push('classes');
  }
  if (db.all('Topics').length === 0) {
    [...SEED_TOPICS, OTHER_TOPIC_LABEL].forEach((label) =>
      db.insert('Topics', { id: svc.uuid(), label, active: true }),
    );
    seeded.push('topics');
  }
  if (db.all('FeedbackSources').length === 0) {
    SEED_SOURCES.forEach((name) =>
      db.insert('FeedbackSources', { id: svc.uuid(), name, active: true }),
    );
    seeded.push('feedback sources');
  }
  if (db.all('ErrorCategories').length === 0) {
    SEED_ERROR_CATEGORIES.forEach((c) =>
      db.insert('ErrorCategories', { id: svc.uuid(), ...c, active: true }),
    );
    seeded.push('error categories');
  }
  for (const email of adminEmails(ctx)) {
    const existing = db.findOne('Users', (u) => u.email.toLowerCase() === email);
    if (existing) {
      db.update('Users', (u) => u.id === existing.id, { role: 'admin' });
    } else {
      db.insert('Users', {
        id: svc.uuid(),
        name: 'Admin',
        email,
        class: '',
        role: 'admin',
        timezone: adminTimezone(ctx),
        consent_at: ctx.nowIso,
        created_at: ctx.nowIso,
      });
      seeded.push(`admin ${email}`);
    }
  }
  const demoDone = db.findOne('Settings', (r) => r.key === 'demo_seeded');
  if (options.demo !== false && !demoDone) {
    seedDemo(ctx);
    db.insert('Settings', { key: 'demo_seeded', value: 'true' });
    seeded.push('demo students and essays');
  }
  return { createdTabs, addedColumns, seeded };
}

const DEMO_TASK2_EDUCATION = `Some people believe that university education should be free for everyone, while others think students should pay for their own studies. In my opinion, the goverment should pay for most of the cost, but students should also contribute a small amount.

On the one hand, free university education give everyone the same chance to study. Many talented young people come from poor families and they cannot afford the high fees. If the education is free, these students can develop their skills and later contribute to the economy. For example, in Germany universities are free and the country has a strong and skilled workforce.

On the other hand, it is very expensive for the government to pay for all students. The money comes from taxes, so people who did not go to university also pay for it. Moreover, when something is free, some students do not take it serious and they waste time. If students pay a part of the fees, they will study more harder because they want to get value for their money.

In conclusion, I believe that a mixed system is the best solution. The government should cover most of the cost so that poor students are not excluded, but students should pay a small fee to make them more responsible. This way, the society can benefit from educated citizens without putting too much pressure on taxpayers.`;

const DEMO_TASK2_TECHNOLOGY = `Nowadays, technology is developing very fast and it has changed the way people communicate. Some people think that this change is positive, while others believe it makes relationships weaker. I partly agree with both views.

Firstly, technology helps people keep in touch with friends and family who live far away. With video calls and social media, a person in Vietnam can talk with relatives in Australia every day for free. This was impossible thirty years ago, when international phone calls were very expensive.

However, technology also has some negative effects. Many people spend hours looking at their phones instead of talking to the people around them. In restaurants, it is common to see a family sitting together but everyone is using their own device. As a result, face-to-face communication skills is getting worse, especially among teenagers.

In my opinion, technology itself is not the problem; the way we use it is. If people set limits, for example no phones during meals, they can enjoy the benefits of technology without damaging their relationships.

To sum up, technology has made communication easier and faster, but it can also reduce the quality of personal relationships. People should use it wisely.`;

const DEMO_TASK2_HEALTH = `In many countries, the number of people who are overweight is increasing. This essay will discuss the main causes of this problem and suggest some solutions.

The main cause of obesity is the change in people's diet. Fast food is cheap, tasty and available everywhere, so many people eat it several times a week. In addition, modern jobs are mostly done sitting at a desk, which means people burn fewer calories than in the past. Children also spend more time playing video games than playing sports outside.

There are several measures that governments and individuals can take. Firstly, governments could introduce a tax on sugary drinks and use the money to fund sports facilities. This approach has already been used in the United Kingdom with some success. Secondly, schools should teach children about nutrition and provide healthy lunches. Finally, individuals need to take responsibility for their own health by cooking at home and exercising regularly.

In conclusion, obesity is caused mainly by unhealthy diets and inactive lifestyles. A combination of government action and personal responsibility is needed to tackle it effectively.`;

const DEMO_TASK1_ENVIRONMENT = `The bar chart compares the amount of waste recycled in four countries in 2010 and 2020.

Overall, all four countries recycled more waste in 2020 than in 2010, and Germany had the highest recycling rate in both years.

In 2010, Germany recycled around 45% of its waste, which was much higher than the other countries. The UK and France recycled about 30% and 28% respectively, while Vietnam only recycle 10%.

By 2020, the figure for Germany had risen to approximately 60%. The UK and France also saw an increase to 42% and 40%. Vietnam's recycling rate doubled to 20%, but it was still the lowest of the four countries.`;

const DEMO_TASK1_TRANSPORT = `The line graph illustrates how many passengers used three types of public transport in a city between 2000 and 2020.

Overall, the number of people travelling by metro increased significantly, while bus use declined. The tram remained the least popular option throughout the period.

In 2000, buses carried about 50 million passengers, compared with 20 million for the metro and 10 million for the tram. Over the next ten years, bus passenger numbers fell gradually to 40 million, whereas metro use rose sharply to 35 million.

From 2010 to 2020, the metro overtook the bus and reached a peak of 60 million passengers. In contrast, the number of bus users continued to decrease, reaching 30 million by the end of the period. Tram use stayed relatively stable, at between 10 and 15 million.`;

interface DemoError {
  excerpt: string;
  category: string;
  correction: string;
  note?: string;
}

interface DemoEssay {
  student: 'an' | 'binh';
  taskType: TaskType;
  topic: string;
  diagramType?: string;
  essayType?: string;
  mode: 'practice' | 'test';
  prompt: string;
  body: string;
  daysAgo: number;
  status: 'draft' | 'pending' | 'scored';
  scores?: [number, number, number, number];
  errors?: DemoError[];
  rewriteDueInDays?: number;
  sources?: Record<string, [number, number, number, number]>;
}

function seedDemo(ctx: Ctx): void {
  const { db, svc } = ctx;
  const tz = adminTimezone(ctx);
  const classId = (label: string) => db.findOne('Classes', (c) => c.label === label)?.id ?? '';
  const topicId = (label: string) => db.findOne('Topics', (t) => t.label === label)?.id ?? '';
  const categoryId = (label: string) =>
    db.findOne('ErrorCategories', (c) => c.label === label)?.id ?? '';
  const sourceId = (name: string) => db.findOne('FeedbackSources', (s) => s.name === name)?.id;

  const students = {
    an: db.insert('Users', {
      id: svc.uuid(),
      name: 'Nguyen Van An',
      email: 'demo.an@example.com',
      class: classId('IELTS 5'),
      role: 'student',
      target_band: '6.5',
      exam_date: '',
      timezone: tz,
      consent_at: ctx.nowIso,
      created_at: addDays(ctx.now, -30).toISOString(),
    }),
    binh: db.insert('Users', {
      id: svc.uuid(),
      name: 'Tran Thi Binh',
      email: 'demo.binh@example.com',
      class: classId('IELTS 7'),
      role: 'student',
      target_band: '7',
      exam_date: '',
      timezone: tz,
      consent_at: ctx.nowIso,
      created_at: addDays(ctx.now, -30).toISOString(),
    }),
  };

  const essays: DemoEssay[] = [
    {
      student: 'an',
      taskType: 'task2',
      topic: 'Education',
      essayType: 'discussion',
      mode: 'practice',
      prompt:
        'Some people think university education should be free for everyone. Others believe students should pay. Discuss both views and give your opinion.',
      body: DEMO_TASK2_EDUCATION,
      daysAgo: 20,
      status: 'scored',
      scores: [6, 5.5, 5.5, 5],
      errors: [
        { excerpt: 'goverment', category: 'Spelling', correction: 'government' },
        {
          excerpt: 'free university education give',
          category: 'Subject-verb agreement',
          correction: 'free university education gives',
        },
        {
          excerpt: 'do not take it serious',
          category: 'Word form',
          correction: 'do not take it seriously',
        },
        { excerpt: 'study more harder', category: 'Word form', correction: 'study harder' },
        {
          excerpt: 'the society can benefit',
          category: 'Articles',
          correction: 'society can benefit',
        },
      ],
      rewriteDueInDays: 5,
      sources: { Claude: [6, 6, 5.5, 5], AI4IELTS: [6.5, 6, 6, 6], Wispace: [5.5, 5, 5, 5] },
    },
    {
      student: 'an',
      taskType: 'task2',
      topic: 'Technology',
      essayType: 'pros_cons',
      mode: 'test',
      prompt:
        'Technology has changed the way people communicate. Do the advantages of this development outweigh the disadvantages?',
      body: DEMO_TASK2_TECHNOLOGY,
      daysAgo: 10,
      status: 'scored',
      scores: [6, 6, 6, 5.5],
      errors: [
        {
          excerpt: 'face-to-face communication skills is getting worse',
          category: 'Subject-verb agreement',
          correction: 'face-to-face communication skills are getting worse',
        },
        {
          excerpt: 'I partly agree with both views',
          category: 'No clear position',
          correction: 'State clearly whether advantages outweigh disadvantages.',
        },
      ],
      sources: { Claude: [6, 6, 6, 6], AI4IELTS: [7, 6.5, 6.5, 6.5], Wispace: [5.5, 6, 5.5, 5.5] },
    },
    {
      student: 'an',
      taskType: 'task1_academic',
      topic: 'Environment',
      diagramType: 'dynamic',
      mode: 'practice',
      prompt:
        'The bar chart shows the percentage of waste recycled in four countries in 2010 and 2020. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.',
      body: DEMO_TASK1_ENVIRONMENT,
      daysAgo: 1,
      status: 'pending',
    },
    {
      student: 'binh',
      taskType: 'task2',
      topic: 'Health',
      essayType: 'res',
      mode: 'practice',
      prompt:
        'The number of overweight people is increasing in many countries. What are the causes of this problem and what measures can be taken?',
      body: DEMO_TASK2_HEALTH,
      daysAgo: 15,
      status: 'scored',
      scores: [7, 6.5, 6.5, 6.5],
      errors: [
        {
          excerpt: 'Children also spend more time playing video games than playing sports outside.',
          category: 'Underdeveloped idea',
          correction: 'Add a consequence or example to develop this point.',
        },
      ],
      sources: { Claude: [7, 6.5, 7, 6.5], AI4IELTS: [7.5, 7, 7, 7], Wispace: [6.5, 6, 6.5, 6] },
    },
    {
      student: 'binh',
      taskType: 'task1_academic',
      topic: 'Transport',
      diagramType: 'dynamic',
      mode: 'test',
      prompt:
        'The line graph shows the number of passengers using three types of public transport in a city from 2000 to 2020. Summarise the information by selecting and reporting the main features.',
      body: DEMO_TASK1_TRANSPORT,
      daysAgo: 5,
      status: 'scored',
      scores: [6.5, 7, 6.5, 6.5],
      errors: [
        {
          excerpt: 'reached a peak of 60 million passengers',
          category: 'Inaccurate data',
          correction: 'Check the final figure against the graph.',
        },
      ],
      sources: { Claude: [6.5, 6.5, 6.5, 6.5], AI4IELTS: [7, 7, 7, 7] },
    },
    {
      student: 'binh',
      taskType: 'task2',
      topic: 'Work',
      essayType: 'discussion',
      mode: 'practice',
      prompt: 'Some people prefer to work for a large company, others for a small one. Discuss.',
      body: 'Many people today must choose between working for a large company and a small business.',
      daysAgo: 0,
      status: 'draft',
    },
  ];

  for (const e of essays) {
    const student = students[e.student];
    const submitted = addDays(ctx.now, -e.daysAgo);
    const started = new Date(submitted.getTime() - (e.taskType === 'task2' ? 38 : 19) * 60000);
    let imageId = '';
    if (e.taskType === 'task1_academic') {
      imageId = saveUploadedImage(ctx, {
        base64: DEMO_PNG,
        mimeType: 'image/png',
        name: 'demo-chart.png',
      });
    }
    const essay = db.insert('Essays', {
      id: svc.uuid(),
      student_id: student.id,
      mode: e.mode,
      started_at: e.mode === 'test' ? started.toISOString() : '',
      time_used_seconds:
        e.mode === 'test' ? Math.round((submitted.getTime() - started.getTime()) / 1000) : '',
      auto_submitted: false,
      over_time: false,
      paste_attempts: 0,
      task_type: e.taskType,
      // Task 1 Academic is classified by diagram type, not topic.
      topic_id: e.taskType === 'task2' ? topicId(e.topic) : '',
      diagram_type: e.diagramType ?? '',
      essay_type: e.essayType ?? '',
      prompt: e.prompt,
      body: e.body,
      word_count: countWords(e.body),
      image_file_id: imageId,
      status: e.status,
      drive_sync_status: '',
      saved_at: submitted.toISOString(),
      submitted_at: e.status === 'draft' ? '' : submitted.toISOString(),
      scored_at: e.status === 'scored' ? addDays(submitted, 1).toISOString() : '',
    });
    if (e.status !== 'draft') archiveEssay(ctx, essay.id);

    if (e.scores) {
      const feedback = {
        task: 'You address all parts of the task. Develop each main idea with a specific example.',
        coherence: 'Clear paragraphing. Vary your linking words.',
        lexical: 'Adequate range. Watch word forms and spelling.',
        grammar: 'Mix of simple and complex sentences. Check subject-verb agreement.',
      };
      db.insert('Scores', {
        essay_id: essay.id,
        criterion_1: e.scores[0],
        criterion_2: e.scores[1],
        criterion_3: e.scores[2],
        criterion_4: e.scores[3],
        overall: overallBand(e.scores),
        feedback_json: JSON.stringify(feedback),
        general_comment: 'A solid response. Focus on the errors highlighted below.',
        updated_at: essay.scored_at,
      });
      for (const err of e.errors ?? []) {
        const start = e.body.indexOf(err.excerpt);
        db.insert('ErrorLog', {
          id: svc.uuid(),
          essay_id: essay.id,
          student_id: student.id,
          category_id: categoryId(err.category),
          excerpt: err.excerpt,
          start_offset: start >= 0 ? start : '',
          end_offset: start >= 0 ? start + err.excerpt.length : '',
          correction: err.correction,
          note: err.note ?? '',
          created_at: essay.scored_at,
        });
      }
      for (const [name, s] of Object.entries(e.sources ?? {})) {
        const id = sourceId(name);
        if (!id) continue;
        db.insert('SourceFeedback', {
          id: svc.uuid(),
          essay_id: essay.id,
          source_id: id,
          criterion_1: s[0],
          criterion_2: s[1],
          criterion_3: s[2],
          criterion_4: s[3],
          overall: overallBand(s),
          feedback_text: name === 'Claude' ? '' : `Demo feedback from ${name}.`,
          created_at: essay.scored_at,
        });
      }
      if (e.rewriteDueInDays !== undefined) {
        const due = addDays(ctx.now, e.rewriteDueInDays).toISOString().slice(0, 10);
        db.insert('RewriteRequests', {
          id: svc.uuid(),
          essay_id: essay.id,
          due_at: endOfDayUtc(due, student.timezone || tz, svc.tzOffsetMinutes),
          note: 'Rewrite the essay fixing the highlighted errors and give a fuller example in paragraph 2.',
          status: 'requested',
          rewrite_essay_id: '',
          created_at: essay.scored_at,
        });
      }
    }
  }
}
