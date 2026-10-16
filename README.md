# Study Accountability Tracker

Reads your `.xlsx` study tracker, normalises it honestly, and finds the patterns across a month
that a human can't see in 31 rows of free text. Google Sheets stays the human-readable mirror;
MongoDB is the record.

**Spec:** [`PRD.md`](./PRD.md) · **Status:** Planning, reflection, focus sessions, AI fallback, and Sheets projection are implemented — 166 server + 69 mobile tests pass (3 server integration tests skip without MongoDB).

---

## Why the normaliser exists

Your workbook declares `GenAI (h)` but stores **minutes**. Row 5 proves it:

```
GenAI 75 + Coding 0 + English 0 + Other 30 = 105 minutes
105 / 60 = 1.75 hours  —  and cell I5 is exactly 1.75
```

The system detects this from data rather than trusting the header, then cross-checks against the
totals you wrote by hand in the `Summary` block at the bottom of the sheet:

```
                    yours    computed
daysLogged              5          5
totalHours            7.7        7.67
avgHours           1.53        1.53
daysTargetMet          0          0
```

That reconciliation is a permanent regression test. If a refactor ever misreads the units,
`npm test` fails.

---

## Running it

From the project root, install and verify both parts with:

```bash
npm run setup
npm run verify
```

For a local first run, copy the safe configuration template, start MongoDB, and launch the API:

```bash
cp server/.env.example server/.env
mkdir -p /tmp/study-accountability-mongo
mongod --dbpath /tmp/study-accountability-mongo --bind_ip 127.0.0.1 --nounixsocket
```

In a second terminal:

```bash
npm run server
curl http://127.0.0.1:5555/health
```

The health response should report `status: "ok"` and `mongo: "up"`. Set `OPENROUTER_API_KEY` in
`server/.env` only when you want AI analysis; workbook import, metrics, and the mobile shell do not
need it. Then start the Expo client with `npm run mobile`.

**1. MongoDB**

```bash
mongod --dbpath ~/tracker-mongo-data --logpath ~/tracker-mongo-log/mongod.log --bind_ip 127.0.0.1
```

**2. Server**

```bash
cd server
cp .env.example .env     # fill in OPENROUTER_API_KEY when you want AI features
npm install
npm start
```

**3. Optional workbook migration**

The normal mobile workflow is plan → focus session → reflection. Workbook import remains available
for historical backfill and reconciliation; it is not required to create new daily records.

```bash
curl "http://127.0.0.1:5555/api/import/preflight"          # parse + report, writes nothing
curl -X POST http://127.0.0.1:5555/api/import -H 'content-type: application/json' -d '{}'
```

**4. Read the results**

```bash
curl http://127.0.0.1:5555/api/months/2026-10/metrics
curl http://127.0.0.1:5555/api/months/2026-10/days?withData=true
```

**5. Analyse the month** (needs `OPENROUTER_API_KEY` in `server/.env`)

```bash
curl "http://127.0.0.1:5555/api/analysis/2026-10/precheck"    # free: no LLM, no cost
curl -X POST http://127.0.0.1:5555/api/analysis/2026-10       # runs the graph
```

### Tests

```bash
npm test   # server + mobile tests
```

`test/container.test.js` is deliberately **static**, and the file says why: the container
transitively imports `react-native`, so it cannot be loaded in node at all. Its checks are
parse-with-Babel, import resolution (including dynamic `import()`), dependency declaration,
screen registration, and four Metro-specific guards — no top-level await, and no call to a picker
API that v10 does not export. Each guard was verified by reintroducing the exact bug it targets
and confirming it fails.

`--test-concurrency=1` is deliberate: the integration files share one local mongod, so running
them in parallel produced a race in which one file's `dropDatabase()` deleted another's data
mid-run. `--test-force-exit` releases the Mongo connection pool afterwards.

The 26 analysis tests drive the **real LangGraph pipeline through a fake model** — no API key, no
network, no cost. That is the whole point of the `LLMPort` abstraction: the anti-fabrication
behaviour must be provable without spending money.

### The mobile app

```bash
cd mobile
npm install
npx expo start                 # Expo Go: multi-select import works
npx expo prebuild && npx expo run:ios   # dev build: real folder picker
```

| Where the app runs | `EXPO_PUBLIC_API_URL` | Backend must be |
|---|---|---|
| Deployed app / physical phone | `https://tracker-ngzd.onrender.com` | Render service running |
| iOS simulator | `http://localhost:5555` | `HOST=127.0.0.1` (default — **no LAN exposure**) |
| Android emulator | `http://10.0.2.2:5555` | `HOST=127.0.0.1` |

**The app does not parse spreadsheets.** SheetJS needs `fs`/`Buffer` polyfills in React Native,
and a second copy of the normaliser would inevitably drift. The app picks a folder, reads the
bytes, and POSTs them to `/api/import/upload`; the server stays the single source of normalisation.

### A platform limit worth knowing

`@react-native-documents/picker` v10 **cannot enumerate a folder**. It exports no `listDirectory`
and no `listAllFiles`; `pickDirectory()` returns only a URI. Enumerating a SAF tree requires a
custom native module, which this does not ship.

So the Import screen uses the system file picker with multi-select — which works in Expo Go *and*
in a dev build — and full-folder import is handled by the **backend folder scan**, because those
workbooks are on the Mac and it can read them directly. The screen says this rather than
promising folder enumeration the platform will not deliver.

```bash
curl -X POST http://127.0.0.1:5555/api/import/upload -H 'content-type: application/json' \
  -d "{\"files\":[{\"name\":\"October_Accountability-2.xlsx\",\"base64\":\"$B64\"}]}"
curl -X PUT http://127.0.0.1:5555/api/days/2026-10-14 -H 'content-type: application/json' \
  -d '{"accomplished":"...","blockers":"...","buildOutcome":"LEARNED","targetMet":"PARTIAL"}'
```

An entry typed in the app carries `origin: "app"`, never invents a `totalHoursComputed`, and
becomes citable AI evidence on the very next analysis — verified by
`test/mobileRoutes.test.js`.

### Plan quality

The critique is generated by the analysis graph and scored on four axes. The screen's real value
is the **aggregate**, because a per-day score is just a number:

```
across 2 days  |  overall 5.5/10
weakest axis: Realistic -> 2.5
banner    : Weakest axis: Realistic. Under- or over-scoped against your real output.
biggest gap: Declared 4 hours but delivered 1.67 hours (2026-10-06)

2026-10-07 -> 6/10
   Workable with gaps — weakest on realistic (3/10)
     7:00 pm -> 9:00 pm (120m) LangChain lecture
```

That matches your own numbers: you declared 4 hours and logged 1.67 and 2.08. The critique does
not fix that; it just refuses to let you keep declaring 4.

### Daily mobile workflow

1. **Plan today** — create up to three priorities, each with an outcome, focused-time estimate,
   priority, minimum/ideal target, breaks, and buffer. `Review plan` flags vague or overloaded work
   without changing it. `Generate 3-priority draft` is optional and requires the server-side
   `OPENROUTER_API_KEY`; the draft is editable and is not saved until you press **Save daily plan**.
2. **Focus session** — start, pause, resume, mark an interruption, and finish a session. The backend
   records actual minutes and updates only the selected priority's actual time.
3. **Reflect** — answer the five guided questions. Existing plans and focus totals are shown as
   context, and the server preserves the plan, sessions, imported minutes, and provenance when the
   reflection is saved.
4. **Quality check** — AI suggestions are optional. **Use to edit** copies a suggestion into the
   original reflection form; **Keep original** dismisses it. The original stored answer is never
   overwritten by an AI response.

Daily plan routes:

```text
GET  /api/days/:date                         load the day, plan, reflection, and sessions
POST /api/days/:date/plan/generate           optional AI draft; does not persist
POST /api/days/:date/plan/check              deterministic/AI review; does not persist
PUT  /api/days/:date/plan                    persist the edited plan
POST /api/days/:date/plan/carry-forward      review and move unfinished priorities to a later day
POST /api/days/:date/focus-sessions          persist actual focused time
PUT  /api/days/:date                         persist the reflection without erasing the plan
```

### Hardening (Phase 6)

| Concern | Where |
|---|---|
| PHI redaction in logs | `shared/logger.js` |
| Error budgets + cause taxonomy | `shared/diagnostics.js` |
| AI spend ceiling (NFR-2) | `shared/spend.js` |
| Provider circuit breaker | `infrastructure/ai/circuitBreaker.js` |
| Live view of all of the above | `GET /api/diagnostics` |

**The redaction bug worth knowing about.** A denylist of PHI field names is inherently
incomplete, and the soak run proved it. Three leaks got through on the first attempt:

```
passiveDays[].evidence  ->  "watch like a movie"      (verbatim journal quotes)
timeBlocks[].label      ->  "jev model research"      (your own task names)
weekday.days            ->  redacted                 (a counter, over-redacted)
```

The first two were real privacy leaks. The fix was two-part — widen the denylist **and** change
the call sites to log scalars only, because "the logger redacts most of it" is not a privacy
guarantee. All three are now regression tests that log the real workbook and grep the output for
the exact strings that leaked.

**Errors are bucketed by cause, not message**, because the cause decides the response:

| Cause | Retry? | Why |
|---|---|---|
| `PROVIDER` | yes | OpenRouter blip; retry with fallback, breaker opens after 3 |
| `UPSTREAM` | yes | Sheets rejected a write; Mongo is still correct |
| `PERSISTENCE` | **no** | Blind retry risks duplicate writes |
| `INPUT` | **no** | Retrying a malformed workbook burns an evening |
| `NETWORK` | yes | The phone can't reach us; nothing is wrong server-side |

**Spend is a hard ceiling, checked before the run.** The graph makes up to 5 model calls, so
refusing after the fact would be pointless. `BUDGET_EXCEEDED` with an explicit `force` override.

OpenRouter model selection prefers the configured paid models. If those models return a
no-credit (`402`) response, the server automatically tries `MODEL_FREE` (default:
`openrouter/free`) and then `MODEL_FREE_FALLBACK`. Free models are rate-limited by OpenRouter,
so adding credits and keeping the paid model settings is recommended for regular analysis.

```bash
curl http://127.0.0.1:5555/api/diagnostics | python3 -m json.tool
```

### Google Sheets mirror

MongoDB is the system of record; Sheets is a **projection** of committed documents. The sheet can
therefore never contain data the database rejected — a Sheets failure leaves the sheet merely
stale, and the next sync repairs it.

Seven tabs: `Months · Daily_Log · Time_Blocks · Blockers · AI_Insights · Plan_Critiques · Import_Log`

Sheets has no unique constraint and no upsert, so naive syncing duplicates every row each run.
The fix is `writePlanner.js` — a **pure function** that reads the key column, builds an index, and
decides UPDATE-vs-APPEND:

```bash
# see exactly what would happen, without writing anything
curl -X POST http://127.0.0.1:5555/api/sheets/sync/2026-10 \
  -H 'content-type: application/json' -d '{"dryRun":true}'
```

```
first sync   → 31 appends, 0 updates
second sync  →  0 appends, 31 updates      ← idempotent
third sync   →  0 appends, 31 updates      ← byte-identical
```

`now` is injectable, so `synced_at` reflects when the *source row* last changed rather than when
the sync ran — otherwise every run would rewrite every row and idempotency would be untestable.

### The anti-fabrication gate

Your month is 84% blank — 26 of 31 days have no record. A language model handed that will happily
write a fluent narrative about days on which nothing happened. So every claim must prove itself:

| Rule | Failure reason |
|---|---|
| At least one citation required | `NO_EVIDENCE` |
| Cited day must have data | `CITES_EMPTY_OR_UNKNOWN_DAY` |
| Quote must appear **verbatim** in that day | `QUOTE_NOT_FOUND_IN_SOURCE` |
| Action must respect your stated constraints | `CONSTRAINT_VIOLATION` |

Anything failing is dropped, the graph regenerates **once** with the specific failures quoted back
at the model, and the final bundle still reports everything that ever failed:

```json
"regeneration": { "ran": true, "critiquePasses": 2, "correctedAfterRetry": 2 },
"rejectionHistory": [ { "reason": "CITES_EMPTY_OR_UNKNOWN_DAY", "title": "..." } ]
```

Constraint enforcement reads your own words out of column M — `"Can’t study after the 12 am"`
becomes a hard 00:00 cutoff, so a generated `11:30 pm – 1:00 am` block is rejected.

Text that a previous AI tool already wrote into your journal is detected and **excluded** from
constraint extraction, so it cannot be laundered back in as one of your rules.

Integration tests **skip automatically** if no mongod is reachable, so the domain suite always runs.

---

## Layout

```
server/src/
├── domain/            pure, zero dependencies — this is the part that must not rot
│   ├── entities/      value objects (TargetMet, BuildOutcome, StudyCategory)
│   ├── services/      UnitInference, TimeBlockParser, WorkbookNormalizer, MetricsCalculator
│   └── errors/        DomainError
├── application/       use cases, depends on ports only
├── infrastructure/    adapters: xlsx, mongo, openrouter, sheets
├── interface/http/    express routes — thin, no business logic
└── shared/            Result type, DI container
```

Dependencies point inward. `domain/` imports nothing; adapters implement interfaces declared in
`application/ports/`; routes call use cases and nothing else.

---

## What the normaliser does with your file

| Finding | Resolution |
|---|---|
| Headers say `(h)`, values are minutes | Column-level unit inference at confidence **1.0**, corroborated by your own `Total` column |
| `Total = 0` on 26 of 31 rows | Stored as `null`, never `0`. A day with no entry is not a day with zero study |
| `Target Met?` = `Floor` / `Minimum` / `NO` | Mapped to `PARTIAL` / `PARTIAL` / `MISSED`. Unrecognised values are **quarantined, never guessed** |
| Two consecutive days have byte-identical plans | Flagged `plan.isRepeat` with `repeatOf` pointing at the original |
| Time blocks in six different formats | Parsed to `{start, end, durationMin, label, done}`. `11:30 – 1:00` correctly resolves to 90 min |
| Column M already contains AI-written coaching | Detected via `blockers.machineWritten` — your own writing is never mistaken for it |
| Rows 37–41 are a summary block, not data rows | Parsed separately and used to cross-check the computed totals |

---

## API

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Service + Mongo + key configuration status |
| `GET` | `/api/config` | Resolved configuration |
| `GET` | `/api/import/preflight` | Parse and report without writing (FR-1.8) |
| `POST` | `/api/import` | `{folder?, recursive?, force?, asOf?}` |
| `GET` | `/api/months` · `/api/months/:month` | Month list / detail with metrics |
| `GET` | `/api/months/:month/days?withData=true` | Daily rows |
| `GET` | `/api/months/:month/metrics` | Deterministic metrics only |
| `GET` | `/api/quarantine` · `POST /api/quarantine/:id/resolve` | Values needing your input |
| `GET` | `/api/imports` | Import audit trail |
| `GET` | `/api/analysis/:month/precheck` | Sufficiency gate + constraints + metrics. **Free — no LLM** |
| `POST` | `/api/analysis/:month` | Runs the LangGraph pipeline (503 if no API key) |
| `GET` | `/api/analysis/:month/insights` | Persisted insights with status |
| `POST` | `/api/insights/:id/status` | `OPEN` / `ACTED_ON` / `DISMISSED` |
| `GET` | `/api/plan-critiques` | Per-day 4-axis plan critique |
| `GET` | `/api/sheets/status` | Connection + credentials + tab list |
| `POST` | `/api/sheets/connect` | Create or adopt the workbook |
| `POST` | `/api/sheets/sync/:month` | Project a month. `{dryRun:true}` reports without writing |
| `POST` | `/api/import/upload` | Base64 xlsx upload from the app (32 MB limit) |
| `GET` | `/api/days/:date` | Load a day, including plan, reflection, and focus sessions |
| `POST` | `/api/days/:date/plan/generate` | Optional AI draft of up to three priorities; does not persist |
| `POST` | `/api/days/:date/plan/check` | Review a plan without rewriting it |
| `PUT` | `/api/days/:date/plan` | Persist the daily plan |
| `POST` | `/api/days/:date/plan/carry-forward` | Move unfinished priorities to a later day after review |
| `POST` | `/api/days/:date/focus-sessions` | Persist actual focused time and interruptions |
| `PUT` | `/api/days/:date` | Write a daily entry from the app |

`asOf` is injectable on import so every metric is deterministic in tests.

---

## Security

There is no authentication — this is a single-user tool on your Mac (§ v1.1). What is enforced:

- **No secrets in the mobile bundle.** The OpenRouter and Google keys live only in `server/.env`.
  A React Native bundle is trivially extractable, so anything shipped there is public.
- **Backend binds `127.0.0.1` by default.** On the iOS simulator you reach it as `localhost` with
  zero LAN exposure. In `NODE_ENV=production` it binds `0.0.0.0` automatically for Render; no
  `HOST=0.0.0.0` setting is needed in local development. A physical phone should use the deployed
  Render URL or an explicitly secured LAN/tunnel setup, never a secret embedded in the mobile app.
- **Journal text is never logged.** Only counts and hashes.
