# IELTS Writing Practice App — Build Spec v3

Oct 10, 2026 · @Kris

## Role

You are a senior full-stack engineer. Build the complete application described below autonomously.

- Do not ask me questions. When something is ambiguous, choose the most sensible default, record it in DECISIONS.md, and continue.
- Work in small steps, run the code, and fix your own errors until every acceptance check at the end passes.
- Commit after each step of the build process.

## Product

A web app for IELTS Writing practice covering Task 1 Academic and Task 2. It runs entirely on free services and the admin's own Google account, plus the admin's existing Claude.ai subscription. There are no paid services and no paid API keys.

1. A student writes an essay on the website, saves drafts, and presses Submit.
2. The essay is saved to a Google Sheet and copied to a named folder in the admin's Google Drive.
3. The admin clicks "Copy for Claude", pastes into their Claude.ai Project, and pastes Claude's reply back into "Paste Claude draft", which fills the score form.
4. The admin pastes feedback from AI4IELTS, Wispace and Perplexity for reference.
5. The admin edits and submits the final score. Only this final score is ever shown to the student.
6. The student receives an email from the admin's Gmail. Their error log, topic history and dashboard update.
7. The admin can require a rewrite with a due date. The rewrite is linked to the original essay.

## Tech stack

Everything must run on free plans. Do not substitute anything without writing the reason in DECISIONS.md.

- **Front end:** a static site built with Vite and TypeScript, deployed to GitHub Pages from a public repo by a GitHub Actions workflow. Chart.js for charts. The front end contains no secrets of any kind.
- **Back end:** a Google Apps Script web app deployed from the admin's Google account with "Execute as: Me" and "Who has access: Anyone". It exposes one JSON API (`doPost`) that the front end calls with `fetch`. Send requests as `Content-Type: text/plain` with a JSON body to avoid CORS preflight. Manage the script with `clasp` in an `apps-script/` folder of the same repo.
- **Database:** one Google Sheet in the admin's Drive, one tab per table (see Data model). It is never shared with anyone; only the script reads and writes it.
- **Files:** Google Drive through `DriveApp`.
- **Email:** `GmailApp` from the admin's Gmail, HTML plus plain text.
- **Scheduled jobs:** Apps Script time-driven triggers.
- **Claude:** no API. A copy-paste workflow with the admin's Claude.ai Project (see Claude draft).
- **Validation:** validate every request in Apps Script, even if the front end already checked it.
- **Tests:** Vitest for pure functions. Keep Apps Script business logic in plain functions with the Google services passed in, so Vitest can run them in Node with mocked Sheet, Drive and Gmail objects. One Playwright end-to-end flow against the front end and a mock API server that follows the same contract.

## Roles

- **student**: reads and writes only their own data. Never sees Claude drafts, external tool feedback or other students.
- **admin**: reads all essays, writes scores, error logs and rewrite requests. The admin is the user whose email matches the `ADMIN_EMAIL` Script Property. Role is never taken from client input.

## Student features

### Account

- Sign up with name, class and email only. Class is a dropdown: IELTS 4, IELTS 5, IELTS 7, IELTS 8, IELTS Buddy (admin can edit this list). Include the privacy consent checkbox. Log in with an emailed login link only, so there are no passwords and no password reset. Log out.
- Settings: name, target band, exam date, and "Delete my account and all my data".

### Submit an essay

- Fields: task type (`task1_academic`, `task2`), prompt text, topic, essay body, optional test date.
- Topic is chosen from a controlled list (for example Education, Environment, Technology, Health, Work, Society, Government, Crime, Media, Culture, Transport, Globalisation) or "Other". Seed about 15 topics. Admin can edit the topic during scoring.
- Task 1 Academic: the student must attach the chart or diagram image themselves (png or jpg, max 5 MB). Submission is blocked without it. The image is stored in the student's essay folder in Google Drive (see Google Drive archive).
- Live word count. Warn below 150 words for Task 1 and below 250 for Task 2, but still allow submission.
- Submission cap: at most 3 essays per student per day. The server counts that student's essays submitted in the last 24 hours before accepting a new one, and shows a clear message when the cap is reached. The cap value is in the Settings tab of the Sheet.
- A student can save the essay as a draft while writing and come back to it later. When finished, they press "Submit" and confirm in a short dialog ("You can't edit after submitting"). The essay is then locked. Only submitted essays reach the admin queue, are copied to Google Drive, or count toward the daily cap.

### Practice mode and Test mode

When starting an essay, the student picks a mode. Both modes use the same scoring flow.

|  | Practice mode | Test mode |
| --- | --- | --- |
| Time limit | None. Save drafts and hand in whenever ready. | 20 minutes for Task 1, 40 minutes for Task 2, with a visible countdown. |
| Writing | Type on the site or paste text written elsewhere. | Typed on the site only. Pasting into the essay box is blocked. |
| Prompt | Entered at any time. | Prompt (and chart image for Task 1 Academic) entered first. The timer starts when the student presses "Start test". |
| Drafts | Saved drafts, can leave and come back. | One sitting. Autosaves to the browser every 15 seconds and to the server every 2 minutes, so a refresh or dropped connection loses nothing and the timer keeps running. |
| Ending | Student presses Submit. | Student presses Submit, or the essay is submitted automatically when time runs out. |

- The server records `started_at` when the test starts and computes time used itself; it does not trust the browser clock. A test submitted more than 2 minutes after the deadline is accepted but marked "over time".
- Paste attempts in Test mode are counted and shown to the admin on the scoring page.
- Word count stays visible in both modes, as in the computer-delivered IELTS test.
- Essay lists, the essay page, the result email and the admin queue show the mode. The dashboard can be filtered by mode, and the band-over-time chart marks Test mode essays differently.

### Assigned test mode

A third mode where the admin sets the prompt. It follows all Test mode rules (timer, typed on the site only, autosave, auto-submit, server-checked timing).

- **Admin creates an assignment:** title, task type, topic, prompt, chart image for Task 1 Academic, who it is for (one or more classes, or chosen students), an open and close date-time, and a time limit (default 20 minutes for Task 1, 40 for Task 2).
- **Students see "Assigned to me"** with the title, task type, time limit and close date. The prompt and chart stay hidden until the student presses "Start test", so they cannot prepare in advance.
- **One attempt per student.** Once started, the timer runs even if they leave. Starting is not possible after the close time.
- **Admin assignment page:** for each assignment, a list of students marked not started, in progress, submitted, over time or missed, with links to submitted essays. Missed status is set automatically at the close time.
- **Scoring:** assigned essays appear in the normal queue, tagged with the assignment title. The admin can filter the queue by assignment, and the student overview shows band scores across assignments so the class can be compared on the same prompt.
- **Notice:** new assignments show on the student dashboard. Emailing the class is optional (a checkbox when creating the assignment), because each email counts toward the daily Gmail quota.

### My essays

- List with status: draft, pending, scored, rewrite due, rewrite submitted, overdue.
- Essay detail page: final scores, feedback, tagged errors with corrections, and the essay text with errors highlighted.
- If a rewrite exists, show the original and rewrite bands side by side.

### Topics I've written

- Table of topics, each with task type, date, overall band and a link to the essay.
- Show which seeded topics the student has not yet attempted, so gaps are visible.

### Progress dashboard

- Overall band over time (line chart), with the student's target band as a reference line.
- Average of each of the four criteria (bar chart).
- Top 2 error categories for each of the four criteria (8 in total), in the last 30 and 90 days, with counts and one example correction each.
- Progress highlights: compare each error category's rate (errors per 100 words, so longer essays are not penalised) in the student's last 3 scored essays against the 3 before. A category that drops shows as "Improving". A category that appeared at least twice before but not at all in the last 3 essays shows as "Mistake avoided" with a short well-done message. A category that rises shows as "Needs attention". Put these highlights at the top of the dashboard.
- Essays submitted per week.
- Upcoming rewrite deadlines with a countdown.
- Filter everything by task type and mode.

## Admin features

### Queue

- Pending essays and submitted rewrites, oldest first. Filters by task type, student and status (new, Claude draft pasted, in review, Drive copy failed).

### Scoring page

Layout, left to right on desktop and stacked on mobile:

- **Essay panel**: prompt, essay with highlighted errors, the chart image for Task 1 Academic, and the original essay plus its final score when this is a rewrite.
- **Reference panel** (tabs): Claude draft, AI4IELTS, Wispace, Perplexity. See the next two sections.
- **Score form**:
  - Four criterion scores, each 0 to 9 in 0.5 steps. Task 1 uses Task Achievement; Task 2 uses Task Response; both use Coherence and Cohesion, Lexical Resource, Grammatical Range and Accuracy.
  - Overall band computed live as the average of the four, rounded to the nearest 0.5, in a pure unit-tested function. Rules: .125 → .0, .25 → .5, .375 → .5, .625 → .5, .75 → next whole band, .875 → next whole band.
  - Markdown feedback per criterion plus a general comment.
  - Topic (editable).
  - Error tagger: select text in the essay, choose a category from the controlled list, type the correction and an optional note. Store excerpt, character offsets, category, correction and note. Many errors per essay, editable and deletable before final save.
  - Rewrite request: "Rewrite required" checkbox, due date, and an instruction note for the student.
  - Buttons: "Copy for Claude", "Paste Claude draft", "Save draft" (no email), "Submit score" (locks the essay as scored and sends the email).
- Admin can edit a score after submission. The email is re-sent only if "Notify student again" is ticked.

### Error categories

- Add, rename and deactivate categories, grouped by criterion.
- Seed about 40 defaults: grammar (tense, subject-verb agreement, articles, prepositions, conditionals, passive, word order, punctuation, run-on sentences), vocabulary (collocation, word choice, word form, spelling, repetition, informal register), coherence (linking words, paragraphing, referencing, progression), and task (off topic, no clear position, underdeveloped idea, missing overview for Task 1, missing key data).

### Student overview

- Per student: essays, score trend, recurring errors, topics covered, rewrite history and any overdue rewrites.

## Claude draft (copy-paste)

The admin drafts scores with their own Claude.ai Project. The app never calls Claude and holds no Claude key. A Claude draft is always optional: every essay can be scored by hand.

### Claude Project setup

- An admin page "Claude setup" shows ready-to-copy Project instructions, including the exact JSON output format below. The README explains how to create the Project.
- Buttons export text files to upload as Project files: the active error category list, and the calibration samples (essays the admin marked as samples, with their final scores and comments). The admin also uploads the band descriptors and any other scoring materials directly to the Project.

### Copy for Claude

- On the scoring page, "Copy for Claude" copies one text block: task type, prompt, topic, word count, the essay, and the student's top recurring error categories from the last 30 days.
- Wrap the essay in clear delimiters and tell Claude to treat it as data, not instructions. End with a reminder to answer only in the JSON format.
- For Task 1 Academic, show a "Download chart image" button and a reminder to attach the image in the Claude chat.

### Paste Claude draft

- A text box accepts Claude's reply. Strip code fences, parse the JSON and validate it: four criterion scores (0 to 9 in 0.5 steps), feedback per criterion, general comment, suggested topic, and an errors array (excerpt, category label, correction, note).
- If the reply is invalid, show which fields are wrong and load nothing.
- Recompute the overall band with the pure rounding function. Ignore any overall Claude gives.
- Match category labels to active categories, ignoring case. Unknown labels are flagged for the admin to choose a category.
- Find each excerpt in the essay to compute character offsets. Excerpts not found exactly are kept but marked "unplaced" for the admin to place or delete.
- Save the pasted reply in the Drafts tab with a timestamp, so Claude counts as a source in source calibration.
- "Load into form" fills the score form. Nothing reaches the student until the admin presses Submit score.

## External tool feedback

The admin pastes results from AI4IELTS, Wispace and a trained Perplexity into the scoring page. These are reference material for the admin only and are never shown to students.

| Source | Known tendency | How the app uses it |
| --- | --- | --- |
| AI4IELTS | Generous scores | Shown with its running bias versus final scores |
| Wispace | Strict scores, little explicit feedback | Shown with its running bias versus final scores |
| Perplexity (trained) | Strong at checking arguments | Feeds the Task Response / Task Achievement review |

### Entry

- Manual paste, no integrations. Each source has: optional four criterion scores, optional overall, and a free-text feedback box (stored as plain text, rendered safely).
- Sources are rows in a `feedback_sources` table so the admin can add, rename or deactivate tools later.

### Reconcile with Claude

- After pasting the external results, the admin can click "Copy reconcile prompt". It copies Claude's earlier draft, the pasted tool results and each source's recorded bias, and asks Claude for: where sources disagree by 1 band or more, which argument problems the Perplexity notes raise, and a revised suggestion with a one-line reason per change.
- The admin pastes Claude's answer into a "Reconcile notes" box, shown as plain text beside the form. It never changes the form automatically.

### Bias tracking

- For every submitted score, store each source's criterion scores next to the final scores, including Claude's first draft.
- Admin page "Source calibration": for each source, show the average difference from the final score per criterion and overall (for example "AI4IELTS: +0.6 overall"), how often it lands within 0.5 band, and a trend over time. Filter by task type.
- Use this to show the admin which sources to trust for which criterion.

## Rewrites and deadlines

- When scoring, the admin can tick "Rewrite required", set a due date (stored as end of that day in the student's timezone, saved in UTC) and add an instruction note.
- The student sees the request on the essay page and dashboard with a countdown, and a "Submit rewrite" button that pre-fills the prompt, topic, task type and image from the original.
- A rewrite is a new `essays` row with `parent_essay_id` pointing to the original. It goes through the same Claude draft and scoring flow, and the scoring page shows the original and its final score.
- Rewrite states: `requested`, `submitted`, `overdue` (computed when the due date passes with no submission), `waived` (admin cancels the request).
- Late rewrites are still accepted and marked late.
- Reminder emails via a daily Apps Script time-driven trigger: one 2 days before the due date and one on the day it becomes overdue. Each reminder is sent at most once, recorded in `email_events`.
- Dashboard and essay page show the improvement from original to rewrite, per criterion and overall.

## Google Drive archive

Every submitted essay gets its own folder in the admin's Google Drive. Drive is also where chart images live, so there is no other file storage.

- Folder name: `{Student name} - {Task type} - {Topic} - {YYYY-MM-DD}`, for example "Nguyen Van An - Task 1 Academic - Education - 2026-10-12". Task type labels are "Task 1 Academic" and "Task 2". Rewrites add " - Rewrite". The date is the submission date in the admin's timezone (Settings tab, default Asia/Ho\_Chi\_Minh).
- Strip characters Drive does not allow. If a folder with the same name exists, append " (2)".
- Folders are created inside the root folder named by the `DRIVE_ROOT_FOLDER_ID` Script Property.
- Contents: the chart image for Task 1 Academic, and a Google Doc with the prompt, essay text and word count.
- The browser sends the image to the script as base64 (png or jpg, max 5 MB, checked on both sides). The script saves it with `DriveApp` and stores the file ID.
- Files are never shared or made public. Images are shown in the app by the script returning them as base64 after an access check.
- If the admin changes the topic during scoring, rename the folder to match.
- If folder creation fails, the submission still succeeds; the queue shows "Drive copy failed" with a retry button. Store the folder ID so a retry never creates a duplicate.

## Email

- All email is sent with `GmailApp` from the admin's Gmail. Types: login link, result, re-sent result, rewrite reminder, rewrite overdue.
- The result email, sent on Submit score, contains: task type, topic, overall band, the four criterion scores, a short feedback summary, the top 3 errors to fix (the 3 most frequent categories in this essay, with one example correction each), the rewrite due date if set, and a button to the essay page. Full feedback stays behind login.
- Responsive HTML that works in Gmail and Outlook, plus a plain-text version. Escape all student and feedback text.
- Record every attempt in the EmailEvents tab (essay\_id, type, idempotency\_key, status, error, created\_at).
- Daily quota: a personal Gmail account can email about 100 recipients a day through Apps Script. Check `MailApp.getRemainingDailyQuota()` before each send. When the quota is used up, mark the email `queued`, show the admin how many are waiting, and let an hourly trigger send them when quota returns. Login links take priority over result emails.
- If sending fails, the score is still saved, the failure shows in the admin UI, and a "Resend email" button retries.
- Idempotency: build a key from essay, email type and send version. Use `LockService` and check EmailEvents for the key before sending, so double clicks never send twice.

## Data model

One Google Sheet, one tab per table, header row first. IDs are UUIDs from `Utilities.getUuid()`. Times are stored as ISO strings in UTC. A `setup()` function creates every tab with its headers.

| Tab | Columns |
| --- | --- |
| Settings | key, value (daily submission cap, admin timezone, email quota reserve) |
| Users | id, name, email, class, role, target\_band, exam\_date, timezone, consent\_at, created\_at |
| Classes | id, label, active (seed: IELTS 4, IELTS 5, IELTS 7, IELTS 8, IELTS Buddy) |
| LoginTokens | token\_hash, user\_id, expires\_at, used\_at |
| Sessions | token\_hash, user\_id, expires\_at, created\_at |
| Topics | id, label, active |
| Essays | id, student\_id, parent\_essay\_id, mode (practice, test, assigned), assignment\_id, started\_at, time\_used\_seconds, auto\_submitted, over\_time, paste\_attempts, task\_type, topic\_id, prompt, body, word\_count, image\_file\_id, status (draft, pending, in\_review, scored), drive\_folder\_id, drive\_sync\_status, saved\_at, submitted\_at, scored\_at |
| Assignments | id, title, task\_type, topic\_id, prompt, image\_file\_id, class\_ids, student\_ids, opens\_at, closes\_at, time\_limit\_minutes, email\_students, created\_at |
| Drafts | id, essay\_id, kind (initial, reconcile), raw\_text, parsed\_json, created\_at |
| FeedbackSources | id, name, active (seed: Claude, AI4IELTS, Wispace, Perplexity) |
| SourceFeedback | id, essay\_id, source\_id, criterion\_1 to criterion\_4, overall, feedback\_text, created\_at |
| Scores | essay\_id, criterion\_1 to criterion\_4, overall, feedback\_json, general\_comment, updated\_at |
| RewriteRequests | id, essay\_id, due\_at, note, status (requested, submitted, overdue, waived), rewrite\_essay\_id, created\_at |
| ErrorCategories | id, criterion, label, active |
| ErrorLog | id, essay\_id, student\_id, category\_id, excerpt, start\_offset, end\_offset, correction, note, created\_at |
| CalibrationSamples | id, essay\_id, created\_at |
| EmailEvents | id, essay\_id, user\_id, type, idempotency\_key, status (sent, failed, queued), error, created\_at |

Rules the script enforces, since Sheets has no constraints:

- Every score is 0 to 9 in 0.5 steps. `task_type` is only `task1_academic` or `task2`. `image_file_id` is required for Task 1 Academic and empty for Task 2.
- `ErrorLog.student_id` always equals the essay's `student_id`.
- All writes run inside `LockService.getScriptLock()` so two people saving at once cannot corrupt rows.
- Any value starting with `=`, `+`, `-` or `@` is stored with a leading apostrophe so Sheets never runs it as a formula.
- Dashboard numbers (band over time, criterion averages, top errors per criterion, essays per week, topics covered, progress highlights, source bias) are computed in the script and cached per student with `CacheService` for 10 minutes. The cache is cleared when a score is submitted or edited.

## Security and privacy

The front end is public, so all protection lives in the Apps Script. The web app URL is not a secret.

### Login

- Sign up creates a Users row (name, class, email, consent time), then sends a login link.
- Login: the student enters their email. If it exists, the script emails a link with a random single-use token (two UUIDs joined), valid for 15 minutes. Store only a SHA-256 hash of the token.
- Opening the link exchanges the token for a session token, valid 30 days, also stored only as a hash. The browser keeps it in `localStorage` and sends it in the body of every request. Logout deletes the session.
- Limit login-link requests to 3 per email per hour and 30 per hour overall (tracked in `CacheService`), which also protects the Gmail quota. Always show the same "If that email is registered, a link is on its way" message.

### Access control

- Every API action goes through one function, `authorize(action, user, resource)`, before touching data.
- Students: read and create their own essays; edit or delete only their own drafts; read their own scores, errors and rewrite requests only for scored essays. No access to Drafts, SourceFeedback, CalibrationSamples, EmailEvents or other users.
- Admin: everything.
- The Sheet and Drive folders are never shared. Only the script, running as the admin, touches them.

### Safe input and output

- Validate every request in the script: types, lengths, allowed values.
- Render markdown feedback and pasted tool text safely with no raw HTML (for example, `marked` followed by `DOMPurify`, or plain text). Escape all text in emails.
- CSRF does not apply because there are no cookies; the session token travels in the request body. Record this in DECISIONS.md.
- No secrets in front-end code or the public repo. Script Properties hold `ADMIN_EMAIL`, `SHEET_ID`, `DRIVE_ROOT_FOLDER_ID` and `APP_URL`.

### Privacy

- Privacy notice page and a consent checkbox at signup. It must say that essays are stored in the teacher's Google account, that the teacher may paste them into Claude and other AI tools to help draft feedback, and that a human reviews every final score.
- "Delete my account" removes the user's rows from every tab, moves their Drive folders to trash, and ends their sessions.

### Tests

- Unit tests for `authorize` proving a student cannot read another student's essays, scores or errors; cannot read any drafts or source feedback, including their own; and cannot score anything.

## UX and quality

- Clean, accessible, mobile-friendly UI: keyboard navigation, labels, sufficient contrast.
- Loading, empty and error states for every page, including "Saving to Drive…" and "Email queued until tomorrow".
- Display times in the user's local timezone; store UTC.

## Build process

Follow in order and commit after each step.

1. Scaffold the repo: Vite and TypeScript front end, `apps-script/` folder managed with `clasp`, lint, formatting, and a GitHub Actions workflow that deploys the front end to GitHub Pages.
2. `setup()` creates every Sheet tab with headers and seeds error categories, topics, classes, feedback sources, the admin user from `ADMIN_EMAIL`, and two demo students with sample essays, scores and one rewrite request. README section on creating a test Sheet and test deployment.
3. API layer: `doPost` router, login links, sessions, `authorize`, locking and formula-safe writes.
4. Student flows: sign up, login, save draft, submit, image upload to Drive, daily cap.
5. Admin queue, scoring page with error tagger, Copy for Claude and Paste Claude draft, external feedback entry, reconcile prompt.
6. Scoring logic, Submit score, rewrite requests, and the Gmail pipeline with quota queue and retry.
7. Student dashboard, topics page, progress highlights and charts; admin student overview and source calibration page.
8. Triggers: daily rewrite reminders and overdue status, hourly queued-email sender. An `installTriggers()` function sets them up.
9. Tests: unit tests for band rounding, word count, excerpt-to-offset matching, Claude reply parsing and `authorize`; one Playwright flow.
10. Security and accessibility review. Fix findings.
11. README.md (setup, Script Properties, deploying Apps Script and GitHub Pages, setting up the Claude Project, making a user admin) and DECISIONS.md.

## Acceptance checks

Run these and show the results. If a check fails, fix it before moving on.

- The front end builds with no TypeScript or lint errors, and all tests pass.
- Band rounding: 6.125 → 6.0, 6.25 → 6.5, 6.375 → 6.5, 6.5 → 6.5, 6.625 → 6.5, 6.75 → 7.0, 6.875 → 7.0.
- A student cannot access another student's data, or any draft or source feedback, through the UI or by calling the API directly with their own session token.
- Paste Claude draft: a valid reply loads into the form; an invalid reply shows clear errors and loads nothing; unknown categories and unplaced excerpts are flagged.
- Submitting a score writes Scores, ErrorLog, SourceFeedback and EmailEvents rows, and the dashboard and source calibration numbers change.
- A failed email does not lose the score and can be retried; a double click sends only once; when the daily quota is used up, emails are queued and sent later.
- A rewrite request shows on the student dashboard, the rewrite links to the original, and a missed deadline shows as overdue.
- Both task types work end to end, including the Task 1 Academic image upload and the Drive folder with the correct name.
- An essay starting with "=" is stored as text, not run as a formula.
- Playwright flow against a mock API: student signs up, saves a draft, submits; admin pastes a Claude draft and one external result, edits a score, sets a rewrite, submits; an email event is recorded.
- Also provide a short manual checklist for testing the real deployment end to end.

## Final summary

At the end, give me a short summary of what was built, what you assumed, and the exact manual steps I need to take:

- Create the Google Sheet and Drive root folder, and note their IDs.
- Create the Apps Script project with `clasp`, push the code, and set the Script Properties.
- Run `setup()` and `installTriggers()` once, and approve the Google permissions it asks for (Sheets, Drive, Gmail).
- Deploy the web app ("Execute as: Me", "Who has access: Anyone") and put its URL in the front-end config.
- Enable GitHub Pages for the repo.
- Create the Claude Project: paste the instructions from the Claude setup page and upload the exported files, the band descriptors and my scored samples.
- Log in with my admin email to confirm admin access.
