# PRD — Study Accountability Tracker

**Status:** Draft v1.2 · **Date:** 2026-10-13 · **Owner:** arvindkumar
**Stack:** React Native (Expo) · Node.js · MongoDB · LangChain · LangGraph · OpenRouter · Google Sheets

> **v1.3 correction — 2026-10-13, found by actually bundling the app.**
> FR-1.2 assumed a device folder picker could enumerate a chosen folder. **It cannot.**
> `@react-native-documents/picker` v10.1.7 exports no `listDirectory` and no `listAllFiles` —
> `pickDirectory()` returns a URI and nothing about its children. Enumerating a SAF tree needs a
> custom native module (DocumentFile / ContentResolver). The app therefore ships
> **multi-select file picking** as the on-device path, and full-folder import is covered by the
> **backend folder scan**, which works because the workbooks live on the Mac. The Import screen
> says so in plain text rather than promising something the platform will not do.

> **v1.2 decisions — 2026-10-13.**
> 4. **MongoDB is the system of record.** Google Sheets is the human-readable mirror ("the
>    accountability sheet"), not the store. Natural `_id`s (`daily_logs._id = "2026-10-05"`,
>    `import_logs._id = <file sha256>`) make every write an idempotent upsert, which removes the
>    append-only duplicate-guard hacks §7 previously needed. Sheets writes become a projection
>    of committed Mongo documents.
> 5. **Folder import lives in BOTH layers.** Backend scans a configured local directory
>    (`WATCH_FOLDER`, FR-1.3); the RN app uses a device folder picker (FR-1.2). Answering
>    open question §13.1 in favour of both.

> **v1.1 decisions — personal, single-user, local.**
> Scope confirmed by the user on 2026-10-13:
> 1. **No authentication.** No accounts, no pairing code, no JWT, no session layer.
> 2. **No git repository.** No CI, no PRs, no branches. Quality gates run as local npm scripts.
> 3. **Single user, local-first.** The backend runs on this Mac; the RN app is a client for it.
>
> **What this does *not* change:** the OpenRouter key and the Google service-account key still live
> only on the server. A React Native JS bundle is trivially extractable, so any key shipped in it is a
> public key — that is true for personal tools too. The server is not optional; it is where secrets
> live. §9 and §9.1 are rewritten accordingly.

---

## 1. Problem Statement

A study accountability system is currently maintained as a hand-edited `.xlsx` workbook. It captures
plans, time, blockers, and reflections, but it does not *analyse* them, and it silently breaks in the
ways spreadsheets always do: inconsistent units, free-text status columns, duplicated plans, and zero
rows that look like data.

The user needs an assistant that ingests this workbook, normalises it honestly, finds the patterns a
human cannot see across 30 rows of free text, and writes back specific, evidence-cited guidance — with
Google Sheets remaining the durable, auditable record.

### 1.1 Grounded findings from the real workbook

Analysis of `October_Accountability-2.xlsx` (31 daily rows, Oct 1–31 2026, headers on **row 4**, a
monthly-goal note on row 2 that is **empty**). These are not hypotheticals — each one is a hard
requirement below.

| # | Observed in the file | Consequence |
|---|---|---|
| F1 | Headers `D–G` are labelled **`GenAI (h)`, `Coding (h)`, `English (h)`**, but row 5 stores `75`, `100`, `50` | Values are **minutes**, headers lie. Row 5: `75+0+30 = 105 min ÷ 60 = 1.75 h`, which matches `I5 = 1.75`. Proven. |
| F2 | `I (Total (h))` is `0` on 26 of 31 rows, including days with fully written plans | A zero must mean **NO DATA**, never "studied 0 hours". Conflating them makes streaks meaningless. |
| F3 | `J (Target Met?)` contains `Floor`, `Minimum`, `NO` — and never a `Yes` | Free-text status column. Needs an alias map to a closed enum. |
| F4 | `L (Did I build…)` contains `Nothing`, `- learn to build`, `yes i build but it's vibe code…` | Three different shapes for one binary question. |
| F5 | Column `C` rows 6 and 7 are **byte-identical** | Copy-paste plans. The system must detect and flag repeated plans, not silently average them. |
| F6 | Column `H` holds `"7-8 pm - mid sem prep / 9 - 10:30 pm - langchain lecuter"` | Needs a deterministic time-block parser into `{start, end, label, done}`. |
| F7 | Rows 14–35 (Oct 10–31) are empty; today is Oct 13 | **Anti-fabrication is a hard requirement.** 22 of 31 days have no evidence. The AI must not invent insight about them. |
| F8 | `M (what blocks me)` already contains machine-written coaching text (row 11) | A prior attempt at AI feedback existed. The app must not double-write into a user-authored field. |
| F9 | Blockers are rich and specific: *"one thought relapse me knew already what that would be, and i did not interupt"*, *"Sleep till 1 hour from 7 to 8"*, *"only watch like a movie but i don't code myself no notes"* | This is the highest-signal text in the file. It is the raw material for the product. |

**Product thesis:** the value is not in re-recording the day. It is in reading column `M` and column `K`
across a month and naming the pattern.

---

## 2. Goals & Non-Goals

### Goals
| ID | Goal | Measurable outcome |
|---|---|---|
| G1 | Import all `.xlsx` files from a user-selected folder | ≥1 file per run, ≥30 rows parsed, 0 hard failures on the reference workbook |
| G2 | Normalise messy workbook data into a canonical schema | 100% of unit/status ambiguity auto-resolved with a confidence score; unresolved rows quarantined, never guessed |
| G3 | Generate evidence-cited AI feedback | 100% of AI claims cite ≥1 specific day; 0 claims about empty days |
| G4 | Persist everything to Google Sheets | Daily log, blockers, and insights mirrored within 60 s of edit |
| G5 | Produce "better study plan" guidance | Every day with a plan returns a structured critique: measurable? time-boxed? realistic? |
| G6 | Keep secrets out of the mobile bundle | 0 credentials in the built RN bundle, verified by `npm run verify:no-secrets` |

### Non-Goals (v1)
- Multi-user accounts, sharing, leaderboards, or social feeds.
- Native calendar/timer integration (Pomodoro). v1 uses declared time blocks.
- Auto-generating the user's daily plan from scratch — v1 critiques and suggests; it does not commit the plan on the user's behalf.
- Predictive "you will fail on Friday" forecasting.
- Offline-first sync conflict resolution beyond last-write-wins on single-user data.

---

## 3. Personas

**Primary — Arvind (the accountable self).** Final-year student, night-owl study pattern, learning
GenAI/LangChain/RAG, doing on-the-job (OJT) work, balancing mid-semester exams, internship
applications, and English practice. Fills the sheet nightly; loses momentum when plans are missed
(Oct 10–13 empty). Wants an honest mirror, not cheerleading.

**Secondary — the future self.** Opens the Google Sheet in six weeks to see whether the pattern
repeated. This is why every AI insight is written to the sheet with its evidence and cost.

---

## 4. Functional Requirements

Organised as epics. Acceptance criteria are normative and testable.

### E1 — Folder Import & Parsing

| ID | Requirement | Priority |
|---|---|---|
| FR-1.1 | User selects a **folder**; app enumerates all `.xlsx`/`.xls` inside (non-recursive v1, recursive behind a flag) | Must |
| FR-1.2 | Mobile path: `@react-native-documents/picker` `pickDirectory()` with `requestLongTermAccess` (Android `ACTION_OPEN_DOCUMENT_TREE`; iOS security-scoped bookmark). Fallback: `expo-document-picker` multi-select | Must |
| FR-1.3 | Desktop path: `POST /ingest/scan-folder` reads a configured local directory on the Node host | Should |
| FR-1.4 | Parse with `xlsx` (SheetJS). Handle `.xlsx` and legacy `.xls`. | Must |
| FR-1.5 | **Header detection** — do not assume row 1. Scan the first 10 rows for the row whose column A–N best match the known header signature; record the detected offset | Must |
| FR-1.6 | Parse Excel **serial dates** (46296 → 2026-10-01), locale strings, and blank cells | Must |
| FR-1.7 | Dedupe by `(month, date)`. Skip files whose SHA-256 appears in `Import_Log` unless the user forces re-import | Must |
| FR-1.8 | Show a **pre-flight preview**: files found, rows parsed, quarantined rows + reason, detected header row, detected month. Nothing is written until confirmed. | Must |

### E2 — Normalisation (the correctness core)

This is where F1–F6 get resolved. Every rule emits a `confidence` (0–1) and a human-readable `reason`.

| ID | Source column | Canonical field | Rule |
|---|---|---|---|
| FR-2.1 | `D GenAI (h)` | `genai_minutes` | **Unit inference:** if any value in a column labelled `(h)` exceeds 24, the whole column is treated as **minutes**. Confidence 0.95. |
| FR-2.2 | `E Coding (h)` | `coding_minutes` | Same rule |
| FR-2.3 | `F English (h)` | `english_minutes` | Same rule |
| FR-2.4 | `G other` | `other_minutes` | Same rule; header lacks `(h)` but is the same series |
| FR-2.5 | `I Total (h)` | `total_hours_reported` | **Never trusted for presence.** If all of D–G are blank, `total_hours = null` and `has_data = false`, regardless of `I`. |
| FR-2.6 | `D+E+F+G` | `total_hours_computed` | Recomputed. If `\|computed − reported\| > 5%` and `has_data`, raise a `MISMATCH` warning on the row. |
| FR-2.7 | `J Target Met?` | `target_met` | Alias map → enum `MET \| PARTIAL \| MISSED \| SKIPPED`. `Floor`→`PARTIAL`, `Minimum`→`PARTIAL`, `NO`→`MISSED`, `Yes/Y/Yep/✅`→`MET`, blank+no-data→`SKIPPED`. Unmapped value → `UNKNOWN` + quarantine flag. |
| FR-2.8 | `L Did I build…` | `build_outcome` | Enum `NONE \| LEARNED \| BUILT`, plus `build_note`. `Nothing`→`NONE`; `- learn to…`→`LEARNED`; `yes i build…`→`BUILT`. Extract the sentence as `build_note` for AI context. |
| FR-2.9 | `C Planned` | `plan_items[]`, `plan_summary`, `planned_hours` | Split on `1.` / `2.` / `-` enumerations. **Detect byte-identical consecutive days → `plan_repeat_flag`** (F5). Extract trailing `N hours` if present. |
| FR-2.10 | `H Time blocks` | `time_blocks[]` | Regex for `7-8 pm`, `10 - 12 am`, `10:10 - 1:00`. Each → `{start, end, label, dur_min, done}`. Reject impossible ranges (end ≤ start without am/pm rollover) → quarantine with reason. |
| FR-2.11 | `K What did i accomplish` | `accomplished` | Raw passthrough. Truncate >4000 chars for the LLM prompt. |
| FR-2.12 | `M what blocks me` | `blockers[]` | Raw passthrough **plus** split-on-blank-line segmentation. **Detect prior AI-written text** (F8: heuristic — formal imperative voice, no first-person markers) and quarantine it from re-analysis into a `preexisting_ai_text` field. |
| FR-2.13 | `N One thing to change` | `tomorrow_change` | Raw passthrough. |
| FR-2.14 | Row 2 | `monthly_goal` | Parse `This month's goal:` — currently empty → surface as a **prompted input** in the app, never auto-filled by the AI. |

**Quarantine contract.** Any row that cannot be normalised is written to the `Quarantine` tab with
`{source_file, sheet_row, column, raw_value, reason, confidence}`. It is **excluded from AI prompts**
and shown to the user as "N rows need your input". Silent guessing is forbidden.

### E3 — Deterministic Metrics (no LLM)

Computed in pure TypeScript, unit-tested. The LLM never does arithmetic — it reads these numbers.

| ID | Metric | Definition |
|---|---|---|
| FR-3.1 | `days_logged` / `days_elapsed` / `days_remaining` | In the imported month, up to today |
| FR-3.2 | `consistency_rate` | `days_logged / days_elapsed` |
| FR-3.3 | `longest_streak`, `current_streak` | Consecutive days with `has_data` |
| FR-3.4 | `hours_total`, `hours_avg_per_logged_day` | From `total_hours_computed` |
| FR-3.5 | `category_split` | `{genai, coding, english, other}` share of total |
| FR-3.6 | `plan_vs_actual` | Planned item count vs. items evidenced in `K` |
| FR-3.7 | `passive_learning_ratio` | Days where `K` describes watching without coding/notes ÷ logged days — the F9 pattern, quantified |
| FR-3.8 | `weekday_vs_weekend` | Two aggregates, to expose the college-leaves binge pattern |
| FR-3.9 | `late_start_days` | Days whose first time block starts ≥ 21:00 |
| FR-3.10 | `declining_trend` | Linear regression slope over `total_hours_computed`, normalised |

### E4 — AI Analysis (LangGraph + OpenRouter)

See §6 for the graph design. Product-level requirements:

| ID | Requirement |
|---|---|
| FR-4.1 | Every insight carries `evidence: [{date, quote}]`. **An insight with zero evidence is dropped by a validation node, not rendered.** |
| FR-4.2 | Zero insights may reference a date where `has_data === false` (F7). Enforced by a hard validator that cross-checks citations against the input set. |
| FR-4.3 | Feedback is split into: `What went well`, `What's costing you`, `Do this tomorrow` (max 3), and `Plan critique`. |
| FR-4.4 | **No cheerleading and no invented progress.** The system prompt forbids praise not backed by a cited day. |
| FR-4.5 | Support an **ask-about-my-data** chat thread, grounded in the same month context, with a retrieval step over the user's own rows. |
| FR-4.6 | Regenerate is idempotent: re-running on unchanged data produces no duplicate Sheet rows (`content_hash` guard). |
| FR-4.7 | If the user has < 3 logged days, the app **asks for more data** and refuses to analyse. |
| FR-4.8 | Streaming to the client so the insight card fills progressively; the client renders a skeleton until the first token. |
| FR-4.9 | Tone and safety rules: no diagnosis of mental-health conditions (F9 mentions relapse — the system must respond with practical study-hygiene guidance, not clinical claims), no shaming, no financial advice. |

### E5 — Plan-Writing Assistance

| ID | Requirement |
|---|---|
| FR-5.1 | Score each day's plan on 4 axes: **specific**, **time-boxed**, **measurable**, **realistic** (vs. `planned_hours` vs. historical avg) |
| FR-5.2 | Return a rewritten plan suggestion as structured time blocks, not a wall of text |
| FR-5.3 | Flag the anti-pattern present in the reference data: plan says "2h lecture", actual `I` is `1.67h` → under-scoped |
| FR-5.4 | **Respect the user's stated constraints** found in column `M` — e.g. *"Can't study after the 12 am"*, *"Milk should be at last"*. A generated plan that violates a stated constraint is rejected by the validator and regenerated once. |

### E6 — Google Sheets Persistence

| ID | Requirement |
|---|---|
| FR-6.1 | Backend creates the workbook on first connect, with all 7 tabs and headers (§7) |
| FR-6.2 | Mirror `Daily_Log`, `Blockers`, `Time_Blocks`, `AI_Insights`, `Plan_Critiques`, `Import_Log`, `Quarantine` |
| FR-6.3 | **No AI text is written into user-authored columns.** Insights go to `AI_Insights`, which has its own `status` column (`OPEN / ACTED_ON / DISMISSED`) |
| FR-6.4 | Writes are **idempotent** — upsert by key, guarded by `content_hash` + `Import_Log` file checksum |
| FR-6.5 | Use `spreadsheets.values.append` for logs and `values.batchUpdate` for corrections |
| FR-6.6 | Offline tolerance: writes queue locally (AsyncStorage) and flush on reconnect with exponential backoff. Queue is visible in Settings. |
| FR-6.7 | `Settings → Export` regenerates a cleaned `.xlsx` matching the original layout, so the user can keep the offline workflow |

### E7 — Clean Architecture & Security

See §8 and §9.

---

## 5. Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-1 | Latency | Import parse < 2 s for 1,000 rows. Metrics < 100 ms. Insight generation < 20 s (streaming starts < 3 s). |
| NFR-2 | Cost | ≤ US$0.15 per full-month regeneration at default model routing. Tracked per insight from `usage.cost`. |
| NFR-3 | Reliability | A failed import never corrupts the Sheet. Writes are transactional per tab. Retries: 3 with jittered backoff on 429/5xx. |
| NFR-4 | Offline | Read and log work fully offline. AI and Sheets sync require connectivity and degrade gracefully. |
| NFR-5 | Security | See §9. Zero secrets in the RN bundle, enforced by `npm run verify:no-secrets` (local gate, not CI). |
| NFR-6 | Privacy | Journal text is highly personal. It is sent only to OpenRouter, only for the explicit analysis call. Never logged at INFO — redacted in all server logs. No third-party analytics. **Implemented `shared/logger.js`; verified by grepping real log output for the exact strings that leaked during development.** |
| NFR-7 | Testability | Normalisation, metrics, time-block parser, and the AI validator are pure functions with ≥90 % branch coverage. Graph nodes individually invocable. |
| NFR-8 | Accessibility | Dynamic type, VoiceOver labels on charts, non-colour-only status encoding. |
| NFR-9 | Platform | iOS + Android. Expo Go for Phases 0–1; custom dev client from Phase 2 (folder picker). |
| NFR-10 | Local operation | Backend starts with `npm start` and reaches "ready" in < 5 s. No container, no cloud deploy. MongoDB runs locally (`mongod --dbpath`); Google Sheets is the human-readable mirror. |
| NFR-11 | Recoverability | With no git and no CI, the durability guarantee is: original `.xlsx` files are never modified, Google Sheets keeps revision history, and `Import_Log` records every file's SHA-256 so a bad import is always detectable and re-runnable. |

---

## 6. AI Architecture — LangGraph Pipeline

### 6.1 Why a graph, not a single prompt

Four real requirements force multi-step control flow: (a) evidence must be validated before rendering,
(b) hallucinated insight about empty days must be *caught*, not hoped away, (c) a plan that violates a
user-stated constraint must trigger regeneration, (d) failures must fall back to a cheaper/alternate
model mid-run. A single prompt can do none of these.

### 6.2 State

```js
import { Annotation } from '@langchain/langgraph';

export const AnalysisState = Annotation.Root({
  month:            Annotation<string>,        // "2026-10"
  monthGoal:        Annotation<string>,        // may be ""
  entries:          Annotation<DayEntry[]>({   // normalised, non-empty only
    reducer: (a, b) => (a ?? []).concat(b), default: () => [],
  }),
  metrics:          Annotation<Metrics>,       // FR-3, deterministic
  priorInsights:    Annotation<Insight[]>({    // for "did you act on this?" (F5 repeats)
    reducer: (a, b) => (a ?? []).concat(b), default: () => [],
  }),
  patterns:         Annotation<Pattern[]>,     // node: detectPatterns
  insights:         Annotation<Insight[]>,     // node: critique
  actions:          Annotation<Action[]>,      // node: coach
  planCritiques:    Annotation<PlanCritique[]>,// node: critiquePlans
  rejected:         Annotation<Rejected[]>,    // node: validate — what was dropped & why
  attempts:         Annotation<number>({        // node: regenerate trigger
    reducer: (a, b) => (a ?? 0) + (b ?? 0), default: () => 0,
  }),
  errors:           Annotation<string[]>({ reducer: (a,b)=>(a??[]).concat(b), default: () => [] }),
});
```

### 6.3 Nodes

| Node | LLM? | Responsibility |
|---|---|---|
| `loadContext` | no | Filter `entries` to `has_data === true`. **Emit a hard error and short-circuit if `< 3`** (FR-4.7). |
| `computeMetrics` | no | FR-3.1–3.10. Pure functions. |
| `detectPatterns` | **yes** (cheap model) | Structured output. Classifies `M`/`K` text into pattern objects: `{category, days[], evidence_quotes[], severity}`. Categories: `sleep`, `distraction`, `passive_learning`, `overplanning`, `start_lateness`, `task_avoidance`, `resource_chaos`, `env_collapse`. |
| `critique` | **yes** (strong model) | Produces the three narrative sections. Every claim must carry `evidence[]`. |
| `coach` | **yes** (strong model) | Turns top patterns into ≤3 `Action`s: `{action, why, first_step, time_box, constraint_check[]}`. |
| `critiquePlans` | **yes** (strong model) | Per FR-5: 4-axis score + rewritten time blocks. Must honour constraints extracted in `detectPatterns`. |
| `validate` | no | **The gate.** Drops any insight/pattern whose `evidence` cites a date not in `entries`. Drops actions failing `constraint_check`. Records everything dropped in `rejected` with a reason, surfaced to the user as "AI suggested X but it conflicted with your stated rule". |
| `needsRegeneration` | no | Conditional edge. If `rejected.length > 0 && attempts < 1` → back to `critique` with the rejection list appended to the prompt. |
| `render` | no | Pure formatting into the client-facing `InsightBundle`. |
| `persist` | no | Upserts into `AI_Insights` / `Plan_Critiques`, guarded by `content_hash`. |

### 6.4 Graph shape

```
START → loadContext ──(<3 days)──→ insufficientData → END
            │
            ▼
      computeMetrics
            │
            ▼
     detectPatterns ──┐
            │        │ (pattern count == 0)
            ▼        ▼
         critique → needsRegeneration ──(rejected & attempts<1)──┐
            │            │                                     │
            │            └──(clean)──→ coach ─→ validate ─→ render ─→ persist → END
            ▼                                                            ▲
        critiquePlans ───────────────────────────────────────────────────┘
```

### 6.5 Model strategy (OpenRouter)

Config in `Config` tab, not hardcoded:

| Stage | Default | Rationale |
|---|---|---|
| `detectPatterns` | `google/gemini-2.5-flash` | Cheap, high-volume classification |
| `critique`, `coach`, `critiquePlans` | `anthropic/claude-sonnet-4.6` | Judgement and tone matter most here |

- **Structured outputs** via `response_format: { type: 'json_schema' }` so node outputs are typed.
- **Fallback routing**: `models: [primary, secondary], route: 'fallback'` so a provider 5xx or
  rate-limit transparently fails over instead of failing the run.
- **Attribution headers**: `HTTP-Referer`, `X-OpenRouter-Title`.
- `usage.cost` (returned per call) is written to `AI_Insights.cost_credits` — NFR-2 becomes auditable, not a guess.
- `temperature` 0.2 for analysis nodes, 0.6 for `critiquePlans`.

---

## 7. Persistence

### 7.1 MongoDB — the system of record

Single user, so no tenant scoping. Every collection is keyed on a **natural id**, which is what
makes re-importing the same workbook a no-op rather than a duplicate source of truth.

| Collection | `_id` | Purpose |
|---|---|---|
| `daily_logs` | `"2026-10-05"` (ISO date) | Canonical normalised day. Upsert-on-import. |
| `months` | `"2026-10"` | Month goal, target, and computed metrics snapshot. |
| `time_blocks` | auto | Individually queryable blocks (start-minute queries across a month). |
| `blockers` | auto | Categorised blocker log with `ai_response` + `status`. |
| `insights` | `"<month>:<contentHash>"` | AI insights. Same insight regenerated twice never duplicates. |
| `plan_critiques` | `"2026-10-05"` | Per-day 4-axis plan critique. |
| `import_logs` | `<file sha256>` | Import audit trail; the dedupe key for FR-1.7. |
| `quarantine` | `"<file>:<row>:<col>"` | Values the system refused to guess. |
| `settings` | arbitrary key | Target hours, model choices, dismissed-insight memory. |

Indexes: `daily_logs {month,date}`, `{blockers.machineWritten}`, `time_blocks {date,startMinutes}`,
`insights {month,generatedAt}` + `{status}`, `import_logs {importedAt:-1}`.

**Embedding rule:** blockers and time blocks live embedded inside their `daily_logs` document
(they are always read with the day) *and* are projected into their own collections for
cross-day aggregation. Denormalised reads, normalised writes.

### 7.2 Google Sheets — the accountability mirror

Workbook: **Study Accountability Tracker**. Sheets is written *after* Mongo commits, so the
Sheet can never contain data the database rejected. Seven tabs:

**`Months`** — `month · monthly_goal · target_daily_hours · days_logged · days_elapsed · hours_total · consistency_rate · longest_streak · computed_trend · last_updated`

**`Daily_Log`** *(upserted by `date`)* —
`date · weekday · plan_summary · plan_items · plan_repeat_flag · planned_hours · genai_min · coding_min · english_min · other_min · total_hours_computed · total_hours_reported · variance_pct · target_met · accomplished · build_outcome · build_note · blockers · tomorrow_change · time_blocks · has_data · source_file · content_hash · synced_at`

**`Time_Blocks`** — `date · seq · start · end · duration_min · crosses_midnight · label · done · missed · meridiem_assumed`

**`Blockers`** — `date · raw_text · category · severity · days_repeated · machine_written · ai_response · status`

**`AI_Insights`** — `id · generated_at · month · date_scope · section · title · body · evidence_dates · evidence_quotes · severity · action · constraint_ref · model · tokens · cost_credits · content_hash · status(OPEN/ACTED_ON/DISMISSED) · user_response`

**`Plan_Critiques`** — `date · axis_specific · axis_timeboxed · axis_measurable · axis_realistic · overall · issues · rewritten_blocks · user_accepted`

**`Import_Log`** — `imported_at · file_name · sha256 · sheet_name · header_row · rows_populated · rows_parsed · rows_quarantined · unit_decisions · month · agreement · status · error`

Auth: **service account** (2-legged) held server-side only; sheet shared with the service-account
email; scopes `spreadsheets` + `drive.file`.

---

## 8. Clean Architecture

Four layers with a strict inward dependency rule: **domain → application → infrastructure → interface.**
Domain imports nothing. Interface depends inward. Nothing depends outward.

```
tracker/
├── mobile/                      # React Native (Expo)
│   └── src/
│       ├── domain/              # entities, value objects — zero imports
│       │   ├── entities/{DayEntry,Insight,TimeBlock,PlanCritique}.js
│       │   ├── valueObjects/{StudyCategory,TargetMet,BuildOutcome}.js
│       │   └── errors/DomainError.js
│       ├── application/         # use cases — orchestrates domain
│       │   ├── useCases/{ImportWorkbook,RenderDashboard,GetInsight,
│       │   │              LogDailyEntry,GeneratePlanCritique}.js
│       │   └── ports/           # interfaces only
│       │       ├── repositories/{WorkbookRepository,InsightsRepository}.js
│       │       ├── services/{SheetsGateway,LLMGateway,FileSystemGateway}.js
│       │       └── http/apiClient.js
│       ├── infrastructure/     # adapters implement ports
│       │   ├── http/{apiClientImpl,sseClient}.js
│       │   ├── sheets/{sheetIdStore}.js
│       │   ├── security/{secureStore,configResolver}.js   # no tokenProvider — auth is out of scope
│       │   └── persistence/{offlineQueue,cache}.js
│       ├── interface/           # screens, components, navigation
│       │   ├── screens/{Dashboard,Import,DailyLog,Insights,PlanCritique,Settings}
│       │   ├── components/{ProgressRing,StreakBar,InsightCard,TimeBlockEditor}
│       │   └── navigation/
│       └── shared/              # di/container.js, config, logger
│
└── server/                      # Node.js (Express)
    └── src/
        ├── domain/              # mirrors mobile domain — no framework
        │   ├── services/{WorkbookNormalizer,MetricsCalculator,TimeBlockParser,UnitInference}.js
        │   └── entities/ValueObjects
        ├── application/
        │   ├── useCases/{ImportWorkbooks,GenerateInsights,SyncToSheets}.js
        │   └── ports/{LLMPort,SheetPort,FileStorePort}
        ├── infrastructure/
        │   ├── ai/              # ← LangChain + LangGraph live here, nothing above
        │   │   ├── clients/openRouterClient.js
        │   │   ├── graphs/analysisGraph.js
        │   │   ├── graphs/nodes/{loadContext,computeMetrics,detectPatterns,
        │   │   │                critique,coach,critiquePlans,validate,render}.js
        │   │   ├── prompts/{systemPrompts,nodePrompts}.js
        │   │   ├── schemas/{InsightSchema,PatternSchema,ActionSchema}.js
        │   │   └── memory/{checkpointerFactory,store}.js
        │   ├── sheets/{googleSheetsAdapter,tabInitialiser,rowMapper}.js
        │   ├── persistence/{xlsxReader,sqliteRepository}.js
        │   └── config/{env,secrets}.js
        ├── interface/http/{routes,controllers,middleware}.js
        └── shared/{logger,errors,result}.js
```

Rules, enforced by `npm run lint:boundaries` (`eslint-plugin-boundaries`) — a local gate rather than CI:
1. `domain/` may import **nothing** but itself and shared pure utils.
2. No `infrastructure/` import may appear in `domain/` or `application/`.
3. All cross-layer calls go through a **port** defined in `application/ports/` and implemented in `infrastructure/`.
4. No `import` of `express`, `googleapis`, `langchain`, or `xlsx` anywhere outside `infrastructure/` and `interface/`.
5. Every use case returns `Result<T, DomainError>` — no exceptions across layer boundaries.
6. DI is a hand-rolled container (`shared/di/container.js`) — no framework magic, fully testable.

With no CI these rules are only as good as running them. `npm test` and `npm run lint:boundaries`
are therefore wired together as a single `npm run verify`, which must pass before any commit-worthy
change is considered done. **State in the RN app:** React Query for server state, Zustand for local UI
state only. No business logic in components; nothing sensitive persisted outside the secure store.

---

## 9. Security & API Key Management

Authentication is explicitly **out of scope** (§ v1.1). What remains is **secret isolation** — and that
is not optional, because it is the one reason a server exists at all.

| Concern | Control |
|---|---|
| **OpenRouter key** | Server-side only, from `OPENROUTER_API_KEY` in `.env`. **Never** in `mobile/`. A RN JS bundle is trivially extractable — a key shipped there is a public key, personal tools included. All LLM calls are proxied via `/api/analysis/*`. `npm run verify:no-secrets` greps the built bundle for `sk-or-` and fails if found. |
| **Google service account** | `GOOGLE_SERVICE_ACCOUNT_JSON` in `.env` (or a mounted secret), `private_key` newline-unescaped at load. The sheet is shared with the service-account email; scopes limited to `spreadsheets` + `drive.file`. |
| **`.env` handling** | `.gitignore`d even without a repo (prevents an accidental `git init` + commit). `.env.example` committed with placeholder values. `docs/SECURITY.md` documents rotation for both keys. |
| **Network exposure** | Backend **binds `127.0.0.1` by default** — reachable only from this Mac, zero LAN exposure. See §9.1 for the per-target overrides. |
| **Logging** | `blockers`, `accomplished`, and any journal text are tagged `PHI` and redacted at INFO. Only counts and hashes are logged. No third-party analytics, no error reporters. |
| **Transport** | HTTP is acceptable on `localhost`. `helmet` headers on; `express-rate-limit` (60 req/min) as a guard against a runaway loop from the client; 1 MB body cap. |
| **Input validation** | Every request body validated by schema before reaching a use case. Xlsx cell length caps prevent prompt-stuffing via an oversized cell. |
| **Prompt injection** | User text is wrapped in explicit delimiters; the system prompt states it is *data, never instructions*. The `validate` node is the last line of defence. |

**Residual risk, stated plainly:** with no auth, anything that can reach the bound port can spend
OpenRouter credits and write to your Google Sheet. §9.1 reduces this to zero for the common case. If
you ever run this outside your own Mac, add a static bearer token in `server/.env` and send it from
the RN app — 5 lines of code, no user system needed.

### 9.1 Topology — how the app reaches the backend

| Target | Base URL | Backend must bind | Exposure |
|---|---|---|---|
| **iOS Simulator** | `http://localhost:3000` | `127.0.0.1` | None — the simulator shares the Mac's network stack |
| **Android Emulator** | `http://10.0.2.2:3000` | `127.0.0.1` | None — host loopback alias |
| **Physical device (Expo Go)** | `http://<mac-lan-ip>:3000` | `0.0.0.0` | ⚠️ Whole LAN |
| **Physical device (dev build)** | `http://<mac-lan-ip>:3000` | `0.0.0.0` | ⚠️ Whole LAN |

So: develop on the simulator with the default `127.0.0.1` bind and no LAN exposure at all. When you
eventually test on a real phone, switch to `0.0.0.0` **only for the duration of that session**, then
switch back. `BASE_URL` lives in one file, `mobile/src/shared/config.js`, overridable via a single
`.env` switch — no other file knows the address.

---

## 10. UX Flows

**Onboarding (first run)** → pick folder → pre-flight preview (F1/F3/F5 findings shown as *"3 issues found in your file — review?"*) → prompt for the empty monthly goal → connect Google Sheets → create workbook → generate first insight.

**Daily loop** → Today's card (plan vs. done, time-block chips, streak) → log accomplishments/blockers/build → optional *"critique my plan"* → submit → synced badge.

**Weekly review** → 7-day chart + patterns → each insight card shows its **evidence quotes** and an `Acted on / Dismiss` button. Dismissed insights are remembered so the AI stops repeating them.

**Import** → pick folder → animated parse → preview table with quarantined rows highlighted → confirm → insight generation streams in → *"Added 31 rows to Google Sheets"*.

**Empty-data honesty** — if today has no entry, the dashboard shows *"Nothing logged for Oct 13"* — never a red "0 hours, 0% complete". This distinction is F2 and it is a design commitment, not a bug.

---

## 11. Milestones

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 — Foundation** ✅ | Layer skeletons, DI container, `.env` handling, MongoDB connection + indexes, `npm run verify` | **Done** — 49 tests green, import verified against the real workbook |
| **1 — Ingest** ✅ | `xlsxReader` + full normaliser (E2) + metrics (E3) + Mongo repositories | **Done** — 31/31 rows parsed, F1 resolved at confidence 1.0, totals reconcile with the user's own summary, 0 duplicates on re-import |
| **2 — Persist** ✅ | Google Sheets mirror, 7 tabs, idempotent upserts, dry-run planner | **Done** — 122 tests green; 3 consecutive syncs are byte-identical, 0 duplicate rows |
| **3 — AI** ✅ | LangGraph analysis pipeline, evidence validator, constraint enforcement, model fallback, cost tracking | **Done** — 87 tests green; 0 insights reference a blank day; constraint violations rejected and surfaced |
| **4 — Mobile** ✅ | RN app: folder import, dashboard, daily log, insights, settings | **Done** — 22 mobile tests green in plain node; upload + daily-write verified end to end |
| **5 — Plan critique** ✅ | E5 constraint checking + rejection, 4-axis critique, rewritten blocks, mobile screen | **Done** — constraint violations rejected and surfaced; critique screen shipped with 19 view-model tests |
| **6 — Harden** ✅ | PHI-redacting logger, error budgets, circuit breaker, spend ceiling, soak test | **Done** — 178 server tests; 50 import cycles lose nothing and duplicate nothing |

### Phase 4 — as built

The app deliberately does **not** parse spreadsheets. SheetJS needs `fs`/`Buffer` polyfills in
React Native, and a second copy of the normaliser would drift. It picks a folder, reads the bytes,
and POSTs them; `/api/import/upload` (32 MB limit, ZIP/OLE2 magic-byte sniffing so a random blob
cannot be "parsed" into a bogus sheet) reuses the same normaliser as the folder scan.

App-written entries carry `origin: "app"`, never populate `totalHoursComputed` — the app has no
way to know how long someone studied — and are immediately citable evidence on the next analysis.

`src/domain` and `src/application` import no platform code, so **22 tests run in plain node with
no emulator and no bundler**. That is the payoff for the layering.

### Phase 2 — as built

Sheets is a **projection** of committed Mongo documents, written after the database commits, so
it can never contain data the database rejected.

Idempotency lives in `writePlanner.js` as a pure function, so the guarantee is provable without a
Google account: read the key column, index it, UPDATE known keys at their exact row, APPEND only
genuinely new ones. `dryRun` reports the plan without writing. `now` is injectable so that
`synced_at` reflects the source row's own update time — stamping the sync time would rewrite every
row on every run and make idempotency untestable.

**Phase 3 is the riskiest** — it is the phase where the product either becomes genuinely useful or
becomes a motivational poster. Gate it behind the evidence validator; do not ship without it.

### Phase 3 — as built

The validator (`domain/services/InsightValidator.js`) is a **pure function with no LLM, network,
or database**, so the safety behaviour is provable without an API key. It is enforced by 26 tests
that drive the real LangGraph pipeline through a fake model.

Reducer policy was chosen per-key from data semantics rather than convenience: last-write-wins for
anything whose only writer produces the newest truth (`insights`, `actions`, `rejected`),
accumulate for genuine running totals (`costCredits`, `tokens`, `modelsUsed`). An earlier
concat-everything design silently kept the rejected first attempt visible next to its successful
replacement — exactly the insights we had thrown out.

The bundle exposes its own working:
`validationStats.fabricatedDayCitations`, `rejectionHistory` (every claim that ever failed),
and `regeneration { ran, critiquePasses, correctedAfterRetry }`.

---

## 12. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| The AI invents insight about the 22 empty days | **High** — destroys trust instantly | `validate` node hard-fails the run; citations cross-checked against `entries` |
| Folder picker needs a custom dev client, breaking Expo Go | Medium | Phase 1 ships multi-select fallback in Expo Go; folder picker in Phase 2 |
| Spreadsheet unit ambiguity mis-detected | Medium | Column-level inference with explicit confidence + Quarantine tab; show the decision to the user |
| Sheets API quota (60 writes/min/user) | Medium | Batch appends, coalesce the offline queue, exponential backoff |
| LangGraph adds complexity with no payoff | Medium | The four requirements in §6.1 justify it; if scope is cut, ship a 3-node graph, not a single prompt |
| Cost creep from full-month regeneration | Low | `usage.cost` tracked per insight; budget alert at US$0.50/month |
| OpenRouter provider outage | Low | `route: 'fallback'` with two models per stage |

---

## 13. Open Questions

**Resolved 2026-10-13:** ~~Auth~~ → no authentication. ~~Repo~~ → no git. ~~Multi-user~~ → single
user. ~~Local store~~ → **MongoDB** as system of record. ~~Folder scope~~ → **both** backend and
frontend. Recorded in the v1.1 / v1.2 decision notes at the top.

Still open:

1. **Model preference** — defaults are `gemini-2.5-flash` (classification) and `claude-sonnet-4.6` (coaching), both overridable via `.env`. Pin specific models, or leave the defaults?
2. **Monthly-goal ownership** — row 2 of the workbook is empty. Should the AI *propose* a goal for review, or must you always type it?

---

## Appendix A — Reference workbook facts used by this spec

```
File      : October_Accountability-2.xlsx (47 KB)
Sheets    : 1 ("Sheet1"), 1000 declared rows, 35 populated
Header row: 4   |  Monthly-goal note: row 2 (empty)
Month     : October 2026, rows 5–35  (serials 46296–46326)
Columns   : A Date · B Day · C Planned · D GenAI(h) · E Coding(h) · F English(h)
            G other · H Time blocks · I Total(h) · J Target Met?
            K What did i accomplish · L Did I build… · M what blocks me
            N One thing to change tomorrow?
Populated : rows 5–13 only (Oct 1–9).  Rows 14–35 empty.
Units     : D–G hold MINUTES (row 5: 75+0+30=105min → I=1.75h ✔)
Status    : J ∈ {Floor, Minimum, NO} — no positive value present
```

## Appendix B — Glossary

| Term | Meaning |
|---|---|
| **has_data** | The day has at least one real entry. Distinct from "logged 0 hours". |
| **Quarantine** | A value the system refuses to guess. Surfaced to the user, excluded from AI. |
| **Evidence** | A citation — `{date, quote}` — attached to every AI claim. |
| **Constraint** | A study rule the user stated in column `M` that generated plans must respect. |
| **Insight** | One AI finding with evidence, severity, and an optional action. |