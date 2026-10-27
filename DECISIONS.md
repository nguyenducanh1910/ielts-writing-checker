# Decisions

Defaults chosen where the spec was ambiguous, and every addition or substitution, with the reason.
No service in the spec was replaced; everything runs on GitHub Pages, Apps Script, Sheets, Drive and Gmail.

## Tooling and structure

- **Single npm package at the repo root.** Front end, Apps Script back end, mock API and tests share one
  `package.json`, so the pure logic in `shared/` (band rounding, word count, Claude parsing, statistics) is used by both
  sides without duplication.
- **Back end written in TypeScript and bundled with esbuild.** Apps Script has no module system, so
  `apps-script/build.mjs` bundles `apps-script/src/gas.ts` into one `dist/Code.js` (IIFE) and appends the top-level
  functions Apps Script needs (`doPost`, `doGet`, `setup`, `installTriggers`, `dailyJob`, `hourlyJob`). `clasp` pushes
  `apps-script/dist` (`rootDir: dist`). esbuild targets ES2020 for the Apps Script V8 runtime.
- **Google services are passed in as narrow interfaces** (`apps-script/src/services.ts`). `gas.ts` wires the real
  `SpreadsheetApp`/`DriveApp`/`DocumentApp`/`GmailApp`/`MailApp`/`CacheService`/`LockService`; tests and the mock API use
  in-memory versions (`apps-script/testing/memory.ts`). The in-memory Sheet mimics the two Sheets behaviours that matter:
  a leading `=` becomes a formula and a leading apostrophe is hidden.
- **The mock API runs the real back-end code** (`mock-server/server.ts`) with in-memory services, so it follows exactly
  the same contract as the web app. Test-only helpers live under `/__test/` and exist only in the mock.
- **Extra test:** `tests/unit/gasBundle.test.ts` loads the built `Code.js` with fake Google globals to exercise the
  adapter code in `gas.ts` (signed-byte SHA-256, base64, Drive moves, triggers) that otherwise only runs in Google.
- **Extra test:** an axe-core accessibility scan (`tests/e2e/a11y.spec.ts`) runs with the Playwright flow.
- **`.clasp.json` is not committed** (it holds the admin's script ID); `.clasp.json.example` is.
- **Front-end config** is `VITE_API_URL` in `.env.production`. The web app URL is public by design.
- **Hash routing** (`#/essays/…`) so GitHub Pages needs no 404 tricks; `base: './'` so the build works under `/<repo>/`.
- **Vanilla TypeScript UI** (a tiny `h()` DOM builder) instead of a framework: small bundle, and text is always inserted
  as text nodes, which makes XSS mistakes hard to write. ESLint forbids `innerHTML`.

## Data model additions

- **`Essays.test_date`** column added: the spec's submit form has an optional test date but the Essays table had no
  column for it.
- **Every cell is stored as plain text** (`setup()` sets the `@` number format on every tab), so Sheets never turns ISO
  dates or numbers into other types. Booleans are `true`/`false`, numbers are decimal strings.
- **Assignments `class_ids` / `student_ids`** are JSON arrays in one cell.
- **"Other" topic** is seeded with the 15 topics and is never counted as a gap on the topics page.
- **Scores are one row per essay** (no history). Each source's scores (including Claude's first draft) are kept in
  SourceFeedback, which is what calibration uses.
- **Cell size:** Sheets cells hold 50,000 characters. Pasted replies/tool output are limited to 20,000 characters, essays
  to 20,000, feedback is checked in total, and the Sheet layer refuses longer values instead of failing silently.

## Roles and access

- **Admin = email in `ADMIN_EMAIL`** (comma-separated list allowed). The role is recomputed from the property on every
  request; the Users `role` column is informational and synced by `setup()`.
- **`authorize(action, user, resource)` is called twice per request**: once by the router at action level, and again by
  handlers with the loaded resource (essay, score, draft, …). Unknown actions are denied to students.
- **The admin cannot delete their own account from the app** (it would lock them out); students can.
- **Students see results only for scored essays.** Saving a draft score moves the essay to `in_review` but shows
  nothing to the student. Once scored, an essay can only be updated with **Submit score** (not "Save draft"), so a
  student never sees half-edited scores.

## Security

- **CSRF does not apply**: there are no cookies. The session token is kept in `localStorage` and sent in the JSON body
  of every request; a page on another site cannot read it or make the browser attach it.
- **Tokens:** login token = two UUIDs (hyphens removed, 64 hex chars), valid 15 minutes, single use; session token the
  same shape, valid 30 days. Only SHA-256 hashes are stored. The login link is removed from the address bar and history
  as soon as the page loads, and `<meta name="referrer" content="no-referrer">` keeps it out of referrers.
- **Rate limits** (CacheService, fixed one-hour windows): 3 login links per email, 30 overall, and 30 new sign-ups per
  hour. Every login-link request gets the same "If that email is registered…" message.
- **Passwords (change from the spec's passwordless login).** Login emails often went to Spam or never arrived, so
  sign-up now takes a password and logs the student straight in; login is email + password. The emailed link stays as
  a backup ("Forgot your password?"). Passwords are stored as `v1$rounds$salt$hash` (random salt, 1000 rounds of
  SHA-256 via `Utilities.computeDigest`; Apps Script has no bcrypt/PBKDF2), compared in constant time, and never
  returned to the browser. Password attempts are limited to 10 per email and 300 overall per hour.
- **Claiming an existing account.** An account with no password that nobody has used (no session, no used login link,
  no essay the student wrote) can be claimed by signing up with its email: this covers students whose first login
  email never arrived and students the teacher added. Any other existing email gets "already has an account. Log in
  instead", which does reveal that the email is registered; that trade-off is accepted for a class app. The teacher
  can set a password for any student (Students → student → Set a password); everyone can set or change theirs in
  Settings (the admin reaches Settings by clicking their name in the header).
- **Content-Security-Policy** meta tag in the production build (GitHub Pages cannot send headers): scripts only from
  the site, network only to `script.google.com` / `script.googleusercontent.com`, images only from the site or `data:`.
- **Images** are validated on both sides (PNG/JPEG by magic bytes, ≤ 5 MB) and only ever displayed as
  `data:image/png|jpeg;base64` after an access check.
- **Pasted text from Claude and other tools is treated as data**: the essay is wrapped in markers that the student's
  text cannot fake, tool output is rendered as plain text, and Markdown feedback goes through marked + DOMPurify with a
  small tag allow-list.
- **Writes are serialized with `LockService.getScriptLock()`** (30 s wait). Read-only actions skip the lock.

## Product behaviour

- **Daily cap** counts practice/test submissions (including rewrites) in the last 24 hours. Test mode checks the cap
  when the test _starts_, so a timed essay is never refused at the end. **Assigned tests are exempt**: the teacher set
  them.
- **Timing** is computed on the server from `started_at`. "Over time" = handed in more than 2 minutes after the
  deadline. The browser corrects its countdown with the server time sent in each response.
- **Abandoned timed tests**: the hourly job submits a timed draft whose time ran out (plus grace) if it has any text,
  marked auto-submitted with time used = the limit (not "over time", since the delay was the job's). A test with no
  text stays unsubmitted; for an assignment it then shows as **missed** after the close time.
- **Assignment "missed"** is computed (no stored column): not started (or started with nothing handed in) and the
  close time has passed. The list updates at the close time without needing a job.
- **One attempt per assignment**: pressing Start again resumes the same essay with the timer still running.
- **Rewrite**: one draft rewrite per original; it inherits task type, prompt, topic and image. The student can choose
  "Start from my original text". A rewrite is late when submitted after `due_at`. Due dates are the end of the chosen
  day in the student's time zone (from their browser at sign-up, editable in Settings).
- **Overdue** is shown as soon as the due date passes (computed on read); the daily job also stores `overdue` and sends
  the overdue email once.
- **Progress highlights** need at least 4 scored essays (last 3 vs up to 3 before). Rates are errors per 100 words.
- **Top errors** per criterion use the error's category criterion; the example correction is the most recent one.
- **Claude reply parsing** accepts code fences and also extracts the outermost `{…}` if Claude adds a sentence around
  the JSON. Scores may be numbers or numeric strings. `suggested_topic` is optional; it is matched to a topic label
  ignoring case. Excerpts are matched exactly (outer whitespace trimmed); a repeated excerpt takes the next unused
  occurrence.
- **Saving the Claude draft**: a reply is stored in the Drafts tab when it passes validation ("Check reply"). On
  Submit score, the _first_ stored draft's scores become Claude's SourceFeedback row.
- **Email idempotency keys**: `<type>:<essay or request id>:<version>`. The first result email is version `1`;
  "Notify student again" uses a request ID generated by the scoring page (a double click reuses it). Reminders and
  overdue emails use the rewrite request ID with version `1`. Email content is never stored; a queued or failed email
  is rebuilt from its key, and a queued login link gets a fresh token when it is finally sent.
- **Quota**: login links need 1 send left; other emails need more than `email_quota_reserve` (default 10) left.
- **Assignment emails** are a sixth email type (`assignment_notice`), sent only when the checkbox is ticked.
- **Drive**: images uploaded with a draft are kept in a `_uploads` subfolder and moved into the essay folder on submit.
  Images shared with another essay (assignment chart, rewrite of an original) are copied, never moved or trashed.
  Renaming after a topic change keeps the folder unique with " (2)". Folder dates use the admin time zone.
- **Times** are stored in UTC ISO strings and shown in the browser's local time zone.

## Essays added by the teacher

- **`admin.essays.create`** adds an essay for an existing student or for a new student created on the spot. It is
  stored like a practice essay with `Essays.source = 'admin'` (new column; `setup()` adds missing columns to existing
  tabs), submitted immediately, archived to Drive and shown in the queue as "Uploaded by teacher".
- **New students may have no email.** They have no consent time (the teacher added them) and cannot log in. Every
  email job carries its recipient, and a job with no recipient is skipped (`no_email`) instead of failing. If the
  teacher gives an email, the student can later sign up or log in with it; signing up then records their consent.
- **Teacher-added essays do not count toward the daily cap**, and "Date written" is stored in `test_date`.
- **.docx import happens in the browser** with a small ZIP reader and the built-in `DecompressionStream`, so no
  library is added. Old binary `.doc` files are refused with a hint to save as .docx.

## Diagram type and essay type

- **Task 1 Academic is classified by diagram type** (Dynamic, Static, Process, Map, Mixed) **instead of topic**;
  **Task 2 has a topic and an essay type** (Agree or disagree, Discussion, Pros & Cons, R.E.S, 2-part question).
  Stored in new `diagram_type` / `essay_type` columns on Essays and Assignments (`setup()` adds them).
- The lists are fixed in `shared/constants.ts` (not editable in the app) because the categories are part of the IELTS
  task design rather than the teacher's own list.
- Display label: the diagram type for Task 1 ("Process"), "Topic · Essay type" for Task 2. The Drive folder name keeps
  the spec's format, using the diagram type in place of the topic for Task 1.
- Older essays saved with only a topic keep working (shown by topic). When scoring, fields that are not sent keep
  their current value, so an older essay can still be scored; the scoring page asks for the missing type.
- "Topics I've written" also lists Task 2 essay types and Task 1 diagram types not yet attempted.

## Privacy notice

- **The "How AI tools are used" section was removed from the privacy page at the teacher's request** (the spec asked
  for it). The sign-up consent checkbox still says essays may be pasted into Claude and other AI tools and that a human
  reviews every final score.

## Feedback language and preview before sending

- **Comments for students are in Vietnamese**: the Claude Project instructions (and the Copy for Claude reminder) ask
  for the four criterion comments, the general comment and error notes in Vietnamese, while the excerpt (copied from
  the essay) and the correction stay in English. The app's own labels (criterion names, email headings) stay in English.
- **Preview before sending**: "Preview and submit score" first calls `admin.previewResult`, which validates the form
  exactly like Submit and builds the result email from the unsaved form without writing or sending anything. The
  preview shows the essay page (scores, feedback, highlighted errors) and the email (recipient, subject, HTML in a
  sandboxed frame, plain text). Curating means going back to the form, editing, and previewing again; only
  **Send to student** saves the final score and sends the email.

## Look and feel

- **Name: IELTS Harper.** Used in the header, page titles, the email footer and the Gmail sender name.
- **Orange and white.** The brand orange is #d2450b, the brightest orange where white text still passes WCAG AA
  (4.5:1); links, focus rings and email buttons use #c2410c. Backgrounds are white or a faint warm white.
- **Criterion colours are used consistently**: red TA/TR, orange CC, blue LR, purple GRA for error highlights, feedback
  cards, error badges and the "Average by criterion" chart.
- The scoring page uses the full screen width with three panels; reconcile notes are collapsed by default.
- The reconcile prompt tells Claude to answer in plain text for that message, because the Project instructions
  otherwise require JSON.

## Accessibility

- Every field has a label; errors are announced and the first invalid field is focused; dialogs return focus.
- Charts have a text summary (`role="img"` + `aria-label`) and a "Show data as a table" fallback.
- The error tagger works without a mouse: type the exact text instead of selecting it.
- The test timer announces 10, 5 and 1 minute left without reading every second.

## Task 2 prompt bank (2026-10-28)

- The student editor (practice and test set-up) has **Choose from the prompt bank** for Task 2:
  331 prompts from the teacher's spreadsheet, filtered by topic and question type, searchable,
  with a random pick. Choosing one fills in the prompt, the essay type and the closest topic
  (`shared/promptMatch.ts`); the student can change them. Hidden for Task 1 and for rewrites.
- `src/data/promptBank.ts` and `shared/promptMatch.ts` are **copies of IELTS Harper Portal's**
  (`web/src/data/promptBank.ts`, `shared/promptMatch.ts`): change both together. The bank is
  loaded only when the student opens it.

## Practice mode clock (2026-10-28)

- The practice editor shows **Time spent**: it starts at the first keystroke in the essay and
  counts while the page is visible, not paused, and the student typed in the last 3 minutes
  (thinking time counts, walking away does not). Pause/Resume button.
- Saved with the draft and on submit in `time_used_seconds` (never lowered, at most 6 hours),
  so the student's essay page and the scoring page show it ("Time spent X min (practice)").
  It is counted by the student's browser: a guide, not proof (test mode is timed by the server).
- `[hidden]` now always hides (a class such as `.btn` no longer overrides it).
