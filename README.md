# IELTS Writing Scoring by Harper

IELTS Writing practice (Task 1 Academic and Task 2) with teacher scoring.

- **Students** write essays (Practice, Test or Assigned test mode), submit them, and get their final score, feedback,
  highlighted errors, rewrite requests and a progress dashboard.
- **The teacher (admin)** scores from a queue: copies the essay to their own Claude.ai Project, pastes Claude's JSON
  reply back to fill the score form, compares AI4IELTS / Wispace / Perplexity results, edits, and submits. Only the
  final score is ever shown to the student, who gets an email from the teacher's Gmail.

Everything runs on free services plus the teacher's own Google account and Claude.ai subscription. There are no paid
APIs and no secrets in this repository.

| Part      | Technology                                                                                   |
| --------- | -------------------------------------------------------------------------------------------- |
| Front end | Vite + TypeScript, Chart.js, marked + DOMPurify — deployed to GitHub Pages by GitHub Actions |
| Back end  | Google Apps Script web app (`apps-script/`), managed with `clasp`, one JSON API (`doPost`)   |
| Database  | One private Google Sheet, one tab per table                                                  |
| Files     | Google Drive (one folder per essay, chart images)                                            |
| Email     | Gmail via `GmailApp`, with a quota-aware queue                                               |
| Jobs      | Apps Script time-driven triggers (daily reminders, hourly email queue)                       |

---

## 1. Local development

Requirements: Node.js 24+ and Git.

```bash
npm install
npm run mock-api      # terminal 1: mock API on http://localhost:8787 (real back-end code, in-memory Google services)
npm run dev:mock      # terminal 2: front end on http://localhost:5173 talking to the mock API
```

Log in with a demo account: request a link on the login page, then open
`http://localhost:8787/__test/login-link?email=<email>` to get the link the mock "sent".

- Admin: `admin@example.com`
- Students: `demo.an@example.com`, `demo.binh@example.com`

Useful scripts:

| Command                           | What it does                                                         |
| --------------------------------- | -------------------------------------------------------------------- |
| `npm run build`                   | Type-check everything and build the front end into `dist/`           |
| `npm run lint` / `npm run format` | ESLint / Prettier                                                    |
| `npm test`                        | Vitest unit and integration tests (back end runs with mocked Google) |
| `npm run e2e`                     | Playwright flow + accessibility scan (starts the mock API itself)    |
| `npm run gas:build`               | Bundle the back end into `apps-script/dist/Code.js`                  |
| `npm run gas:push`                | Bundle and `clasp push` to your Apps Script project                  |

First run of `npm run e2e` on a new machine: `npx playwright install chromium`.

---

## 2. Creating a test Sheet and test deployment

Use a separate test setup before touching real student data. It is exactly the production setup below, with "(TEST)"
names and its own Apps Script project:

1. Create an empty Google Sheet `IELTS Writing (TEST)` and a Drive folder `IELTS Writing Essays (TEST)`; note their IDs.
2. Create a second Apps Script project (step 3.3 below) in a copy of the repo folder, push, and set the Script
   Properties to the test IDs.
3. Run `setup()`. It creates every tab with headers and seeds topics, classes, about 40 error categories, feedback
   sources, your admin user and two demo students (`demo.an@example.com`, `demo.binh@example.com`) with sample essays,
   scores, Drive folders and one rewrite request. Running it again is safe: it only adds what is missing. The demo
   students use `example.com` addresses, so no real email is ever delivered to them.
4. Deploy a web app (step 3.6) and point a local front end at it: create `.env.local` with
   `VITE_API_URL=<test web app URL>` and run `npm run dev`.

---

## 3. Production setup (one time)

### 3.1 Google Sheet and Drive folder

1. In Google Drive, create an empty Google Sheet, for example `IELTS Writing Data`. Copy its ID from the URL:
   `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`.
2. Create a folder, for example `IELTS Writing Essays`. Copy its ID from the URL:
   `https://drive.google.com/drive/folders/<DRIVE_ROOT_FOLDER_ID>`.
3. Do not share either of them with anyone. Only the script, running as you, reads and writes them.

### 3.2 Turn on the Apps Script API (needed by clasp)

Open <https://script.google.com/home/usersettings> and switch **Google Apps Script API** on.

### 3.3 Create the Apps Script project with clasp

```bash
cd apps-script
npx clasp login
npx clasp create-script --type standalone --title "IELTS Writing Scoring" --rootDir dist
cd ..
```

This writes `apps-script/.clasp.json` (it holds your script ID and is git-ignored). If `clasp` created it elsewhere,
copy `apps-script/.clasp.json.example` to `apps-script/.clasp.json` and paste your script ID.

### 3.4 Push the code

```bash
npm run gas:push
```

This bundles `apps-script/src` into `apps-script/dist/Code.js` and pushes it with `appsscript.json`. Run it again after
every back-end change.

### 3.5 Script Properties

Open the project (`npx clasp open-script` from `apps-script/`), go to **Project Settings → Script Properties** and add:

| Property               | Value                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `ADMIN_EMAIL`          | Your Google/Gmail address. Several admins: comma-separated.                              |
| `SHEET_ID`             | The Sheet ID from 3.1                                                                    |
| `DRIVE_ROOT_FOLDER_ID` | The folder ID from 3.1                                                                   |
| `APP_URL`              | The front-end URL, e.g. `https://ieltsharper.github.io/IELTS-Writing-Scoring-by-Harper/` |
| `PORTAL_SECRET`        | Optional. The key from IELTS Harper Portal's `createHarperKey` (at least 32 characters). |

`PORTAL_SECRET` lets IELTS Harper Portal send the essays of its daily writing task here (action
`portal.essays.import`, server to server). They join the normal queue and Drive archive. Without it the action
refuses every request.

### 3.6 Run setup() and installTriggers(), then deploy

1. In the Apps Script editor, pick **setup** in the function list and press **Run**. Approve the permissions it asks
   for (Sheets, Drive, Docs, Gmail, triggers). Google warns that the app is unverified because it is your own script:
   choose **Advanced → Go to IELTS Writing Scoring (unsafe)**.
2. Pick **installTriggers** and press **Run**. This creates a daily job (07:00 in the admin time zone: rewrite
   reminders and overdue status) and an hourly job (queued emails, auto-submitting abandoned timed tests).
3. **Deploy → New deployment → Select type: Web app**. Description `v1`, **Execute as: Me**,
   **Who has access: Anyone**. Press **Deploy** and copy the **Web app URL** (ends with `/exec`).

Updating the back end later: `npm run gas:push`, then **Deploy → Manage deployments → Edit (pencil) → Version: New
version → Deploy**. The URL stays the same.

### 3.7 Front end on GitHub Pages

1. Put the web app URL into `.env.production`:

   ```
   VITE_API_URL=https://script.google.com/macros/s/XXXXXXXX/exec
   ```

2. In the GitHub repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Commit and push to `main`. The **Deploy front end to GitHub Pages** workflow lints, tests, builds and publishes.
   The site is at `https://<user>.github.io/<repo>/`. Make sure `APP_URL` (3.5) matches it exactly, because login
   links in emails point there.

### 3.8 Log in as admin

Open the site, enter your `ADMIN_EMAIL` on the login page, open the emailed link. You land on the **Scoring queue**.
The role comes only from `ADMIN_EMAIL`; nothing the browser sends can make someone an admin.

---

## 4. Setting up the Claude Project

The app never calls Claude and holds no Claude key. You use your own Claude.ai subscription:

1. In Claude.ai, create a Project, for example **IELTS Writing Scoring**.
2. In the app, open **Claude setup** (admin menu). Press **Copy Project instructions** and paste them into the
   Project's instructions. They contain the exact JSON format the app expects.
3. On the same page, download **error categories** and **calibration samples** and upload both as Project files.
   Also upload the official IELTS band descriptors (Task 1 and Task 2) and any other scoring materials.
4. Mark good examples as samples: on a scored essay's scoring page tick **Use as calibration sample**. Re-download and
   re-upload the files when you change categories or add samples.

Scoring one essay:

1. Open the essay from the queue. Press **Copy for Claude**, start a new chat in the Project, paste. For Task 1
   Academic, also download the chart image (under the prompt) and attach it in the chat.
2. Copy Claude's reply, press **Paste Claude draft**, paste it and press **Check reply**. Invalid replies show which
   fields are wrong and load nothing. Press **Load into form**. Unknown categories and excerpts that could not be found
   in the essay are flagged for you to fix.
3. Optionally paste AI4IELTS / Wispace / Perplexity results in their tabs (each shows its running bias), press
   **Copy reconcile prompt**, paste it into the same Claude chat and paste the answer into **Reconcile notes**.
4. Edit the scores, feedback and errors, optionally require a rewrite, and press **Preview and submit score**. The
   preview shows the essay page and the email exactly as the student will receive them. Press **Back to editing** to
   change anything, or **Send to student** to save the final score and send the email.

### Adding essays yourself

To score an essay that did not come through the website (written on paper, sent by message…), open the **Queue**
and press **Add an essay**. Choose the student, or **+ New student…** (name, optional email, class). Paste the text
or load a **.txt / .docx** file, fill in the task type, then the diagram type (Task 1) or the topic and essay type (Task 2), the prompt (and the chart image for Task 1), then press
**Add and score now**. The essay gets a Drive folder and joins the queue tagged "Uploaded by teacher"; it does not
count toward the student's daily limit. Students added without an email cannot log in and never get emails; if you
give an email, they can sign up or log in with it later and see their essays.

---

## 5. Making a user admin

Add their Google email to the `ADMIN_EMAIL` Script Property (comma-separated, for example
`teacher@gmail.com, assistant@gmail.com`). It takes effect on their next request; they log in with an emailed link like
everyone else. Run `setup()` again if you also want the Users tab's `role` column updated. To remove an admin, take
their email out of the property.

---

## 6. Day-to-day notes

- **Gmail quota**: a personal Gmail account can email about 100 recipients a day from Apps Script. When the quota is
  low, result and reminder emails wait in a queue (the **Email** page shows how many) and the hourly job sends them
  when quota returns. Login links always go first. The Settings value `email_quota_reserve` (default 10) keeps quota
  for login links.
- **Daily cap** (`daily_submission_cap`, default 3) and **admin time zone** (`admin_timezone`, default
  `Asia/Ho_Chi_Minh`, used for Drive folder dates) are on the **Lists** page or the Sheet's Settings tab.
- **Drive copy failed** essays show in the queue with a **Retry Drive copy** button. Retries reuse the stored folder.
- Don't edit the Sheet by hand while people are using the app; if you must, keep the header row unchanged.

---

## 7. Manual checklist for the real deployment

Run through this once after deploying (use your own second email address as a test student):

1. [ ] Open the site. The login page loads with no error banner (if it says the app is not connected, check
       `VITE_API_URL`).
2. [ ] Sign up as a student with the consent box ticked. The email arrives from your Gmail; the link logs you in.
       Opening the same link again says it has expired.
3. [ ] Practice mode: write a Task 2 essay, **Save draft**, reload the page, the draft is still there. Submit and
       confirm. The essay shows as Pending.
4. [ ] Task 1 Academic: try to submit without an image (blocked), attach a PNG under 5 MB, submit.
5. [ ] In Drive, the root folder has `<Name> - Task 2 - <Topic> - <date>` and `<Name> - Task 1 Academic - …` folders,
       each with a Google Doc (and the chart image for Task 1). In the Sheet, the Essays tab has both rows.
6. [ ] Test mode: start a 40-minute test, try pasting (blocked), close the tab, reopen: the timer kept running and the
       text is back.
7. [ ] Daily cap: a 4th practice submission within 24 hours is refused with a clear message.
8. [ ] As admin: the queue shows the essays oldest first. Open one, **Copy for Claude**, paste into your Claude
       Project, paste the reply back, **Load into form**. Paste one AI4IELTS result. Change one score, tick
       **Rewrite required** with a due date, **Preview and submit score**, check the preview, **Send to student**.
9. [ ] The student gets the result email (band, four criteria, top errors, rewrite date, button). In the Sheet:
       Scores, ErrorLog, SourceFeedback (Claude + AI4IELTS) and EmailEvents rows exist.
10. [ ] As the student: the essay page shows scores, feedback and highlighted errors, but nothing from Claude drafts or
        AI4IELTS. The dashboard shows the rewrite deadline with a countdown. Submit the rewrite; the admin scoring page
        shows the original and its score.
11. [ ] Type a value starting with `=` in an essay; the Sheet shows it as text, not a formula.
12. [ ] **Source calibration** shows numbers for Claude and AI4IELTS. Change a score with **Notify student again**
        ticked: exactly one more email arrives.
13. [ ] In the Apps Script editor, **Triggers** lists `dailyJob` and `hourlyJob`. Run each once by hand: no errors in
        **Executions**.
14. [ ] Settings → **Delete my account** on the test student: their rows disappear and their folders are in Drive's
        trash.

---

## Repository layout

```
src/                 front end (pages, UI helpers, API client)
shared/              pure logic used by both sides (band rounding, word count, Claude parsing, stats…)
apps-script/src/     back end: router, authorize, handlers, Drive/Gmail pipeline, triggers, setup
apps-script/testing/ in-memory Sheets/Drive/Gmail/Cache/Lock used by tests and the mock API
mock-server/         local mock API (same contract as the web app)
tests/unit/          Vitest; tests/e2e/ Playwright
```

See [DECISIONS.md](DECISIONS.md) for the defaults chosen where the spec left room.
