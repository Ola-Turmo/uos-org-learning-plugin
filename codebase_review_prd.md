# Product Requirements Document: Codebase Review and World-Class Upgrade Plan

> **Codebase:** `Ola-Turmo/uos-org-learning-plugin` — Organizational Learning Plugin for Paperclip
> **Version:** 0.1.0
> **Review Date:** 2026-04-15
> **Reviewer:** Staff Engineer / Technical Strategist

---

## 1. Executive Summary

The `uos-org-learning-plugin` is a Paperclip plugin that captures, indexes, and surfaces organizational learnings across an ecosystem of agent runs, issues, approvals, and manual inputs. It provides a knowledge base with BM25-ranked search, playbooks, policies, deliverables, scorecards, retrospectives, and an audit trail — backed by SurrealDB Cloud with an in-memory fallback.

**Overall assessment:** The codebase is a well-structured MVP with a clear architecture, reasonable type discipline, and a good separation of concerns (manifest → worker → helpers → db → search → UI). However, it has **significant production-readiness gaps** including credential leakage, race conditions in the dual-store model, missing error handling, no test coverage for critical paths, and several logic bugs. The plugin is approximately 60–70% of the way to a production-grade system.

**Key findings at a glance:**
- **2 critical bugs** (credential leak, dual-store inconsistency)
- **5 high-severity defects** (duplicate learning creation, broken supersession logic, unbounded in-memory growth, missing error propagation, XSS in UI)
- **8 medium-severity issues** (dead code, stubbed handlers, weak ID generation, no pagination, etc.)
- **12+ architectural and quality improvements** needed for world-class status

---

## 2. Current-State Assessment

### 2.1 Architecture Overview

```
manifest.ts  →  Plugin metadata, capabilities, tools, jobs, UI slots
worker.ts    →  Event handlers, tools, data queries, actions, scheduled jobs
helpers.ts   →  In-memory stores + CRUD + query logic (dual-write to SurrealDB)
db.ts        →  SurrealDB client, schema init, all persistence operations
search.ts    →  Flexsearch BM25 full-text index over learnings + playbooks
types.ts     →  All entity interfaces (Learning, Playbook, Policy, etc.)
ui/index.tsx →  4 React widgets (LearningWidget, HealthWidget, RetroTab, LearningPage)
```

### 2.2 Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ESM) |
| Language | TypeScript 5.7 (strict mode) |
| Plugin SDK | @paperclipai/plugin-sdk ^2026.325.0 |
| Persistence | SurrealDB ^2.0.3 (WSS) |
| Search | Flexsearch ^0.8.212 (BM25) |
| UI | React 19+ (inline styles) |
| Build | esbuild 0.27 + Rollup |
| Test | Vitest 3 + Node test runner |

### 2.3 What Works Well

- **Clean module separation** — manifest, worker, helpers, db, search, types, UI are properly decoupled
- **TypeScript strict mode** enabled with proper interfaces
- **Dual persistence model** — SurrealDB with graceful in-memory fallback is a sound design
- **BM25 search** with field weighting (title:8, body:4, tags:2, sourceName:1) is well-architected
- **Supersession chain** concept for knowledge evolution is a strong product idea
- **Audit trail** append-only pattern is correct in principle
- **Schema initialization** with IF NOT EXISTS guards is idempotent
- **Manifest is comprehensive** — declares all capabilities, tools, jobs, and UI slots properly

### 2.4 What's Missing or Weak

- No integration tests (only unit tests against in-memory store)
- No CI/CD pipeline
- No linting, formatting, or pre-commit hooks
- No observability (metrics, tracing, structured logging)
- No rate limiting or input validation at boundaries
- No graceful shutdown handling
- No multi-tenant isolation
- No data migration strategy

---

## 3. Critical Bugs and Defects

### C-1: Hardcoded Credentials in `.env.example`

**Title:** Production credentials exposed in repository

**Description:** `.env.example` contains what appear to be **real credentials** to a SurrealDB Cloud instance:
```
SURREAL_ENDPOINT=wss://surreal-shadow-06ek4uedppsrt6cr5g20pkee5s.aws-euw1.surreal.cloud
SURREAL_NAMESPACE=main
SURREAL_DATABASE=main
SURREAL_USER=codex_ingest
SURREAL_PASS=Codex!20260331!Ingest
```
The comment references `~/.factory/secrets/lovcode.env (lovkode.no project)` — this is not a template, it's a copy of real secrets.

**Why it matters:** Anyone with read access to this repo can connect to and modify/delete data in this SurrealDB instance. This is a data breach and potential compliance violation.

**Severity:** CRITICAL

**Expected impact:** Complete compromise of the database. Data exfiltration, deletion, or modification by any actor.

**Effort estimate:** 5 minutes to fix; 30 minutes to rotate credentials.

**Recommended action:**
1. Immediately rotate the SurrealDB credentials
2. Replace `.env.example` with a proper template using placeholder values
3. Add the real `.env` to `.gitignore` (already done, but verify)
4. Run `git filter-branch` or BFG to purge credentials from git history
5. Audit SurrealDB access logs for unauthorized access

---

### C-2: Dual-Store Race Condition and Inconsistency

**Title:** In-memory store and SurrealDB can diverge silently

**Description:** The plugin maintains two stores simultaneously: an in-memory array (`_learnings`, `_playbooks`, etc.) and SurrealDB. Writes go to both, but:
- DB writes are wrapped in `.catch(console.error)` — failures are silently swallowed
- In-memory writes always succeed
- On restart, `rehydrateFromDb()` only loads learnings and playbooks — deliverables, retrospectives, scorecards, and audit logs are **not rehydrated** (they reset to empty arrays)
- If the DB write fails after the in-memory write succeeds, the two stores permanently diverge

**Why it matters:** Data loss on restart is guaranteed for non-rehydrated entities. Silent DB failures mean the UI shows data that doesn't exist in the database.

**Severity:** CRITICAL

**Expected impact:** Data loss, inconsistent state, phantom records in UI that don't survive restart.

**Effort estimate:** 2–4 hours

**Recommended action:**
1. Rehydrate ALL stores from DB on startup (not just learnings and playbooks)
2. Implement write-ahead logging or at minimum retry logic for DB writes
3. Add a consistency check that compares in-memory count vs DB count on startup
4. Consider using SurrealDB as the single source of truth with an LRU cache, not a dual-write model

---

### C-3: Duplicate Learning Creation on `agent.run.failed`

**Title:** `agent.run.failed` and `agent.run.finished` both create learnings for the same failure

**Description:** The comment on lines 115–117 of `worker.ts` says:
> "NOTE: do NOT create a learning here for failed runs if agent.run.failed also fires for the same run — that would create duplicates. agent.run.failed only logs; the learning is created here exclusively."

But the actual code on line 129 checks `if (runStatus === "failed")` inside `agent.run.finished` and creates a learning. Then `agent.run.failed` (lines 191–225) **also** creates a learning with a different title ("Run crashed" vs "Run failed"). Both events can fire for the same run, creating duplicate learnings.

**Why it matters:** Duplicate learnings pollute the knowledge base, confuse users, and break the supersession chain.

**Severity:** CRITICAL

**Expected impact:** 2x learnings for every failed agent run.

**Effort estimate:** 30 minutes

**Recommended action:**
1. In `agent.run.failed`, check for an existing learning with `sourceId: runId` before creating a new one
2. Or use `supersedeLearning` in `agent.run.failed` to update the one created by `agent.run.finished`
3. Add a deduplication guard: `queryLearnings({ sourceId: runId, sources: ["manual"] })` before any learning creation

---

## 4. Incomplete, Stubbed, or Fragile Areas

### S-1: `issue.comment.created` Handler Is a No-Op

**Title:** Comment keyword detection does nothing

**Description:** Lines 309–323 of `worker.ts` detect magic keywords in comments (`@org-learning record`, `record learning`, `@learning add`) but the handler body only logs — it doesn't actually create a learning or call any action. The comment says "The INGEST_FROM_EVENT action can be called by the agent when it sees this event" but no agent sees this event.

**Why it matters:** Users who type these keywords expect a learning to be created. The feature is advertised but non-functional.

**Severity:** HIGH

**Effort estimate:** 1 hour

**Recommended action:** Wire up the keyword detection to actually call `createLearning` with the comment content.

---

### S-2: `supersedeLearning` Has Broken Persistence Logic

**Title:** Supersession chain is never persisted to SurrealDB

**Description:** In `helpers.ts` `supersedeLearning()`, the `supersededBy` and `supersedes` fields are set on the in-memory objects. However, `dbUpsertLearning` in `db.ts` does NOT include `supersededBy` or `supersedes` in its SET clause. The SET clause only includes: `title, body, source, status, priority, createdAt, updatedAt, tags, supersedes` — but `supersededBy` is missing entirely. This means the supersession chain — a core feature for knowledge evolution tracking — only works in-memory and is lost on restart.

Additionally, `dbUpdateLearning` does include `supersededBy` in its patch type but the `supersedeLearning` flow uses `dbUpsertLearning`, not `dbUpdateLearning`, so the field is never written.

**Why it matters:** The supersession chain — a core feature for knowledge evolution tracking — only works in-memory and is lost on restart.

**Severity:** HIGH

**Effort estimate:** 1–2 hours

**Recommended action:**
1. Add `supersededBy` to the `dbUpsertLearning` SET clause (it already handles `supersedes`)
2. Write a test that verifies supersession survives a rehydrate cycle

---

### S-3: `INGEST_FROM_EVENT` Action Is Never Called

**Title:** Dead action registration

**Description:** `ACTION_KEYS.INGEST_FROM_EVENT` is registered in `worker.ts` (lines 776–792) but is never invoked by any event handler, tool, or job. The `issue.comment.created` handler references it but doesn't call it.

**Why it matters:** Dead code increases maintenance burden and confuses developers about what's functional.

**Severity:** MEDIUM

**Effort estimate:** 30 minutes

**Recommended action:** Either wire it up from the comment handler or remove it and the constant.

---

### S-4: `dbDeleteLearning` Is Defined But Never Used

**Title:** Dead DB function; incomplete CRUD

**Description:** `dbDeleteLearning` in `db.ts` is a complete function but is never imported or called anywhere in the codebase. There's also no `deleteLearning` function in `helpers.ts`.

**Why it matters:** Incomplete CRUD — users can create, update, and archive learnings but not permanently delete them.

**Severity:** MEDIUM

**Effort estimate:** 1 hour

**Recommended action:** Either expose a `deleteLearning` function through helpers → worker → action, or remove the dead DB function and document that deletion is intentionally unsupported (soft-delete via archive only).

---

### S-5: `LearningPage` Uses `window.React` Anti-Pattern

**Title:** React hooks accessed via global instead of import

**Description:** In `ui/index.tsx`, `LearningPage` uses `window.React?.useState` and `window.React?.useEffect` instead of importing React hooks directly. This is fragile — it depends on React being attached to the global `window` object, which is not guaranteed in all bundler configurations.

**Why it matters:** The component will silently fail (returning `undefined` for state) if `window.React` is not set, causing runtime errors.

**Severity:** HIGH

**Effort estimate:** 15 minutes

**Recommended action:** Import `useState` and `useEffect` from `react` directly. Remove the `window.React` pattern.

---

### S-6: No Delete Learning Action Exists

**Title:** Missing hard-delete capability

**Description:** There is no way to permanently delete a learning. `archiveLearning` only sets status to "archived" but the learning remains queryable and in the search index.

**Why it matters:** GDPR/compliance requirements may require actual data deletion. Accumulated archived learnings also bloat the in-memory store and search index.

**Severity:** MEDIUM

**Effort estimate:** 2 hours

**Recommended action:** Implement `deleteLearning` in helpers, wire it to an action, and ensure it removes from both in-memory store and DB and search index.


---

## 5. Architecture and Code Quality Review

### A-1: Massive worker.ts (860 lines) - God File

**Title:** Single file handles all plugin concerns

**Description:** worker.ts contains event handlers (8 different event types), a scheduled job, 3 agent tools, 6 data queries, and 8 actions -- all in one 860-line function. This violates the single responsibility principle and makes the file difficult to navigate, test, and maintain.

**Why it matters:** As the plugin grows, this file will become unmaintainable. Adding a new event type or tool requires understanding the entire file.

**Severity:** MEDIUM

**Effort estimate:** 4-6 hours

**Recommended action:** Split into modules:
- src/handlers/events.ts -- all ctx.events.on() handlers
- src/handlers/tools.ts -- all ctx.tools.register() handlers
- src/handlers/queries.ts -- all ctx.data.register() handlers
- src/handlers/actions.ts -- all ctx.actions.register() handlers
- src/handlers/jobs.ts -- scheduled job handlers

---

### A-2: No Input Validation at API Boundaries

**Title:** All tool and action handlers trust their input

**Description:** Tool handlers cast params as their target type without validation. The record-learning tool handler does String(p.title).slice(0, 120) which prevents overly long titles but does not validate required fields properly -- the kind field is checked with if (p.kind === "playbook") but if kind is undefined, it falls through to the default knowledge_entry path silently.

**Why it matters:** Malformed input can create corrupt records. The schema says kind is required but the handler does not enforce it.

**Severity:** HIGH

**Effort estimate:** 2-3 hours

**Recommended action:** Add a lightweight validation layer (Zod or manual checks) at every tool and action entry point. Return proper error responses for invalid input.

---

### A-3: Weak ID Generation

**Title:** genId uses Math.random() -- not unique enough

**Description:** genId(prefix) generates IDs like lrn_1713200000000_abc1234 using Date.now() + Math.random().toString(36).slice(2, 9). This is not cryptographically secure and has collision risk under high concurrency or in clustered deployments.

**Why it matters:** ID collisions would cause data corruption -- two different learnings with the same ID would overwrite each other.

**Severity:** MEDIUM

**Effort estimate:** 30 minutes

**Recommended action:** Use crypto.randomUUID() or at minimum crypto.randomBytes(16).toString(hex) for ID generation.

---

### A-4: No Multi-Tenant Isolation

**Title:** All data is shared across companies/tenants

**Description:** The plugin stores all learnings in a single namespace/database with no companyId field on any entity. Events include event.companyId but it is never used to scope data. The weekly retrospective job hardcodes companyId: "instance".

**Why it matters:** In a multi-tenant Paperclip deployment, Company A's learnings would be visible to Company B. This is a data isolation violation.

**Severity:** HIGH

**Effort estimate:** 4-8 hours

**Recommended action:**
1. Add companyId to all entity types
2. Scope all queries by companyId
3. Use SurrealDB namespaces or a companyId field for isolation
4. Add middleware that injects companyId from the event context

---

### A-5: Test Coverage Is Minimal

**Title:** Only 8 basic tests, all against in-memory store

**Description:** The test suite (plugin.spec.ts) has 8 tests that only cover basic CRUD on the in-memory store. There are zero tests for:
- SurrealDB persistence layer
- Search/BM25 functionality
- Event handlers
- Agent tools
- Scheduled jobs
- UI components
- Error handling paths
- Supersession logic
- Scorecard wiring
- Retrospective logic

**Why it matters:** The most complex and risky parts of the codebase are completely untested.

**Severity:** HIGH

**Effort estimate:** 16-24 hours

**Recommended action:**
1. Add tests for supersedeLearning logic
2. Add tests for queryLearningsWithRanking (BM25 path)
3. Add tests for event handlers (mock ctx)
4. Add tests for tool handlers with invalid input
5. Add integration tests with a test SurrealDB instance (Testcontainers)
6. Aim for >80% line coverage on helpers.ts and db.ts

---

### A-6: No Linting, Formatting, or Code Quality Gates

**Title:** No ESLint, Prettier, or pre-commit hooks

**Description:** The project has no eslint.config.js, no .prettierrc, no lint-staged, no husky. The package.json has no lint script.

**Why it matters:** Code quality will degrade over time without automated enforcement.

**Severity:** MEDIUM

**Effort estimate:** 1 hour

**Recommended action:** Add ESLint with @typescript-eslint, Prettier, and a pre-commit hook via lint-staged + husky.

---

### A-7: computeSummary Has Type Safety Gap

**Title:** countByField returns Record<string, number> but is cast to specific record types

**Description:** computeSummary() does:
  const bySource = countByField(active, l => l.source) as Record<LearningSource, number>;
This is an unsafe cast -- countByField only counts keys that exist in the data. If no connector learnings exist, bySource.connector will be undefined, not 0. The LearningSummary interface requires Record<LearningSource, number> which implies all keys must be present.

**Why it matters:** Consumers of computeSummary() may get undefined for missing source/priority/status keys, causing runtime errors.

**Severity:** MEDIUM

**Effort estimate:** 30 minutes

**Recommended action:** Initialize the count records with all keys set to 0, or use a type that allows optional keys.

---

### A-8: bm25Search Deduplication Logic Is Flawed

**Title:** BM25 search does not properly aggregate scores across fields

**Description:** In search.ts, bm25Search iterates over field results and adds entries to scored on first sight (seen.has() check). But it does not aggregate scores -- the first field that matches wins, and subsequent field matches for the same document are ignored. This means a document matching on both title AND body gets the same score as one matching only on title.

**Why it matters:** Search relevance is degraded. Documents that match on multiple fields should rank higher.

**Severity:** MEDIUM

**Effort estimate:** 2 hours

**Recommended action:** Aggregate scores across fields using the field weights (title:8, body:4, etc.) before sorting.

---

### A-9: appendAudit Fire-and-Forget Error Swallowing

**Title:** Audit log DB writes silently fail

**Description:** In helpers.ts, appendAudit() calls getDb().then(db => db.dbAppendAudit(entry)).catch(() => {}) -- the catch block swallows all errors. If the DB is down, audit entries are lost with no indication.

**Why it matters:** Audit logs are critical for compliance and debugging. Silent loss defeats their purpose.

**Severity:** MEDIUM

**Effort estimate:** 1 hour

**Recommended action:** At minimum, log the error. Better: queue failed audit entries for retry.

---

## 6. Performance Improvement Opportunities

### P-1: Unbounded In-Memory Store Growth

**Title:** All entities are held in memory forever

**Description:** _learnings, _playbooks, _policies, _deliverables, _scorecards, _retrospectives, and _auditLog are plain arrays that grow without bound. There is no eviction, pagination at the store level, or size limit.

**Why it matters:** In a long-running plugin with many events, memory usage will grow linearly and eventually cause OOM crashes.

**Severity:** HIGH

**Expected impact:** Memory leak over time; eventual process crash.

**Effort estimate:** 4-6 hours

**Recommended action:**
1. Implement an LRU cache with configurable max size for each store
2. Page data from SurrealDB on demand instead of loading everything into memory
3. Add a TTL for audit log entries (e.g., keep only last 10,000 entries)

---

### P-2: queryLearnings Does Full Array Scan

**Title:** Every query iterates over all learnings

**Description:** queryLearnings() does [..._learnings] followed by multiple .filter() passes. For N learnings and M filters, this is O(N*M). With BM25, queryLearningsWithRanking does even more work -- a full substring scan on top of BM25.

**Why it matters:** As the learning corpus grows past a few hundred entries, query latency will become noticeable.

**Severity:** MEDIUM

**Effort estimate:** 2-3 hours

**Recommended action:** Use the Flexsearch index for all text queries, not just BM25-ranked ones. Add in-memory indexes (Map) for source, status, and priority filters.

---

### P-3: rehydrateFromDb Loads All Data Synchronously

**Title:** Startup blocks on loading all learnings and playbooks

**Description:** rehydrateFromDb() calls dbSelectAllLearnings() (LIMIT 1000) and dbSelectAllPlaybooks() (LIMIT 100) during plugin setup. If the DB is slow or has many records, plugin startup is blocked.

**Why it matters:** Slow startup delays plugin availability and may cause health check failures.

**Severity:** LOW

**Effort estimate:** 2 hours

**Recommended action:** Lazy-load stores on first access. Show a loading state in UI while data hydrates.

---

### P-4: Search Index Rebuild Is Sequential

**Title:** rebuildIndex adds entries one at a time

**Description:** rebuildIndex calls indexLearning and indexPlaybook in a for loop, each doing an async idx.add(). Flexsearch supports bulk indexing.

**Why it matters:** Startup is slower than necessary for large datasets.

**Severity:** LOW

**Effort estimate:** 30 minutes

**Recommended action:** Use Flexsearch bulk add API to index all entries at once.

---

## 7. Functional Enhancement Opportunities

### F-1: No Semantic/Vector Search

**Title:** Search is limited to BM25 keyword matching

**Description:** The plugin uses Flexsearch for BM25 ranking but has no embedding-based semantic search. Users must know the exact keywords to find relevant learnings.

**Why it matters:** Organizational knowledge is often expressed differently by different people. Semantic search would dramatically improve discovery.

**Effort estimate:** 8-16 hours

**Recommended action:** Add an embedding service (e.g., OpenAI, local model) to generate vectors for learnings. Store vectors in SurrealDB or a dedicated vector store. Implement hybrid search (BM25 + semantic).

---

### F-2: No Learning Deduplication

**Title:** Duplicate learnings can be created freely

**Description:** There is no mechanism to detect that a new learning is substantially similar to an existing one. The supersedeLearning function requires knowing the original ID -- it does not auto-detect duplicates.

**Why it matters:** The knowledge base will accumulate redundant entries, reducing signal-to-noise.

**Effort estimate:** 4-6 hours

**Recommended action:** On learning creation, run a similarity check against existing learnings (using BM25 or embeddings). If a close match is found, suggest superseding instead of creating new.

---

### F-3: No Learning Quality Scoring

**Title:** Learnings have no quality or usefulness metric

**Description:** Learnings have priority and status but no quality score, view count, or usefulness feedback. There is no way to know which learnings are actually valuable.

**Why it matters:** Without quality signals, the system cannot prioritize or surface the most useful learnings.

**Effort estimate:** 4-8 hours

**Recommended action:** Add a qualityScore field. Track view/access counts. Allow agents and users to rate learnings. Use scores to influence search ranking.

---

### F-4: No Automated Learning Extraction

**Title:** Learnings are created manually or from simple event triggers

**Description:** The plugin creates learnings from events but does not analyze the content of agent runs, issue descriptions, or comments to extract learnings automatically. It just records "Run failed" or "Issue tracked" without extracting the actual lesson.

**Why it matters:** The most valuable learnings are the specific insights from failures and successes, not just the fact that they occurred.

**Effort estimate:** 8-16 hours

**Recommended action:** Add an AI-powered extraction step that analyzes run logs, issue descriptions, and comments to extract structured learnings with title, body, tags, and priority.

---

### F-5: No Cross-Reference or Linking Between Learnings

**Title:** Learnings exist in isolation

**Description:** While supersedes/supersededBy creates a chain, there is no general linking mechanism. Learnings cannot reference related learnings, playbooks, or policies.

**Why it matters:** Knowledge is interconnected. Without linking, users cannot navigate from one learning to related ones.

**Effort estimate:** 2-4 hours

**Recommended action:** Add a relatedLearningIds field to the Learning type. Auto-suggest related learnings based on tag overlap or BM25 similarity.

---

## 8. Automation Opportunities

### AUT-1: CI/CD Pipeline

**Current state:** No CI/CD. Build and test are manual.

**Recommended pipeline:**
- lint: ESLint + Prettier check
- typecheck: tsc --noEmit
- test: vitest run + node --test
- build: esbuild production build
- security: npm audit + dependency check

**Impact:** Catches regressions before merge. Enables safe refactoring.

**Effort:** 2-4 hours

### AUT-2: Automated Release Workflow

**Current state:** No versioning or release process.

**Recommended:** Semantic release with conventional commits. Auto-generate changelog. Tag releases. Build and publish plugin bundle.

**Effort:** 2-3 hours

### AUT-3: Pre-Commit Hooks

**Current state:** Nothing prevents committing broken code.

**Recommended:** husky + lint-staged running:
- ESLint on staged .ts/.tsx files
- Prettier formatting
- tsc --noEmit type check
- vitest run --changed for affected tests

**Effort:** 1 hour

### AUT-4: Automated Test Generation

**Current state:** 8 tests for a 2000+ line codebase.

**Recommended:** Use AI-assisted test generation to create tests for:
- All event handlers (mock ctx)
- All tool handlers (valid + invalid input)
- DB layer (with Testcontainers SurrealDB)
- Search layer (BM25 scoring accuracy)
- Supersession logic
- Scorecard wiring

**Effort:** 8-16 hours

### AUT-5: Monitoring and Alerting

**Current state:** No monitoring. console.log and console.error only.

**Recommended:**
- Structured logging (JSON format with correlation IDs)
- Metrics: learning creation rate, query latency, DB connection status, search index size
- Alerts: DB connection failure, memory usage > 80%, search index corruption
- Health endpoint with detailed status

**Effort:** 4-8 hours

### AUT-6: Documentation Generation

**Current state:** README only. No API docs, no architecture diagrams.

**Recommended:**
- Auto-generate API docs from TypeScript types (TypeDoc)
- Generate architecture diagrams from manifest capabilities
- Auto-generate tool documentation from parametersSchema

**Effort:** 2-4 hours

### AUT-7: Automated Refactoring Detection

**Current state:** No code quality metrics.

**Recommended:**
- Code coverage reports in PR comments
- Complexity metrics (cyclomatic complexity)
- Dependency graph visualization
- Dead code detection (via ts-prune or similar)

**Effort:** 2-3 hours

---

## 9. Self-Improvement and Learning Opportunities

### SI-1: Learning Quality Feedback Loop

**Concept:** Track which learnings are accessed, searched for, and referenced by agents. Use this data to:
- Auto-promote frequently-accessed learnings to higher priority
- Auto-archive learnings that have not been accessed in 90+ days
- Surface stale learnings that may need updating

**Implementation:**
1. Add accessCount and lastAccessedAt to Learning type
2. Increment on every query match or tool result inclusion
3. Scheduled job reviews access patterns and adjusts priority/status
4. UI shows most useful and stale badges

**Effort:** 4-6 hours

### SI-2: Automated Tag Suggestion

**Concept:** When a learning is created, analyze its title and body to suggest tags. Over time, build a tag co-occurrence model to improve suggestions.

**Implementation:**
1. On learning creation, run BM25 against existing tagged learnings
2. Suggest tags from the top-N most similar learnings
3. Track which suggestions are accepted/rejected to improve the model

**Effort:** 2-4 hours

### SI-3: Learning Decay and Refresh

**Concept:** Learnings have a half-life. Technical learnings about specific API versions become stale. The system should detect staleness and prompt for review.

**Implementation:**
1. Define decay rates per source type (incident: 180 days, project: 365 days, connector: 90 days)
2. Scheduled job flags learnings past their half-life
3. Auto-create a review task for the learning creator or department
4. If confirmed stale, auto-archive with a note pointing to the replacement

**Effort:** 4-6 hours

### SI-4: Agent Performance Scorecard Automation

**Concept:** The existing scorecard system tracks deliverable quality per agent. Extend this to:
- Auto-detect patterns in agent failures
- Correlate failure patterns with specific learnings
- Suggest targeted playbook updates when an agent repeatedly fails in the same area

**Implementation:**
1. Extend scorecard to track failure categories, not just binary approve/reject
2. When an agent score drops below threshold, auto-suggest relevant playbooks
3. Track whether playbook adoption improves agent scores

**Effort:** 6-10 hours

### SI-5: Knowledge Gap Detection

**Concept:** Analyze search queries that return zero or few results. These represent knowledge gaps -- topics agents are looking for but the organization has not documented.

**Implementation:**
1. Log all search queries and their result counts
2. Weekly job identifies high-frequency zero-result queries
3. Auto-create knowledge gap tickets suggesting content to create
4. Track gap closure rate as a metric

**Effort:** 4-6 hours

### SI-6: Controlled Self-Improvement via Evaluation Pipeline

**Concept:** Before auto-applying changes (priority adjustments, archival, tag suggestions), run them through an evaluation pipeline:
1. Generate a proposed change
2. Score it against historical data (would this have been correct?)
3. If confidence > threshold, auto-apply; otherwise, queue for human review
4. Track accuracy of auto-applied changes over time

**Implementation:**
1. Create an EvaluationPipeline module
2. Define evaluation criteria per change type
3. Implement confidence scoring
4. Add a review queue for low-confidence changes

**Effort:** 8-12 hours

---

## 10. Risks, Constraints, and Assumptions

### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| SurrealDB Cloud outage causes total data loss (in-memory mode) | Medium | High | Implement local SQLite fallback; add health monitoring |
| Memory exhaustion from unbounded in-memory stores | High | High | Implement LRU cache with size limits |
| Credential exposure from .env.example | **Confirmed** | **Critical** | Rotate credentials immediately |
| Multi-tenant data leakage | Medium | Critical | Add companyId scoping to all entities |
| Plugin SDK breaking changes | Low | Medium | Pin SDK version; add integration tests |
| Flexsearch index corruption on crash | Low | Medium | Rebuild index from DB on startup (already partially implemented) |

### Constraints

- **Plugin SDK dependency:** The plugin is tightly coupled to @paperclipai/plugin-sdk. Major SDK changes require plugin updates.
- **SurrealDB Cloud dependency:** Production persistence requires a paid SurrealDB Cloud instance.
- **Single-process model:** The plugin runs as a single process -- no horizontal scaling of the in-memory store.
- **React UI constraint:** UI components must work within Paperclip widget mounting system.

### Assumptions

- The Paperclip host provides reliable event delivery (at-least-once semantics)
- SurrealDB Cloud is available and performant
- The plugin runs in a trusted environment (no malicious input from other plugins)
- React 18+ is available in the host environment

---

## 11. Prioritized Roadmap

### Top 10 Priority List

| # | Item | Severity | Effort | Impact |
|---|---|---|---|---|
| 1 | **Rotate leaked credentials** | Critical | 30 min | Prevents data breach |
| 2 | **Fix dual-store inconsistency** | Critical | 4 hours | Prevents data loss |
| 3 | **Fix duplicate learning on run.failed** | Critical | 30 min | Eliminates duplicate data |
| 4 | **Fix supersededBy not persisted to DB** | High | 2 hours | Makes supersession work |
| 5 | **Fix window.React anti-pattern in LearningPage** | High | 15 min | Prevents UI crashes |
| 6 | **Wire up issue.comment.created keyword handler** | High | 1 hour | Makes advertised feature work |
| 7 | **Add input validation at tool/action boundaries** | High | 3 hours | Prevents corrupt data |
| 8 | **Add multi-tenant isolation (companyId)** | High | 8 hours | Prevents data leakage |
| 9 | **Expand test coverage to >80%** | High | 24 hours | Enables safe refactoring |
| 10 | **Implement LRU cache for in-memory stores** | High | 6 hours | Prevents OOM crashes |

### Phased Roadmap

#### Phase 1: Immediate (Week 1) - "Stop the Bleeding"

| Task | Effort | Owner |
|---|---|---|
| Rotate SurrealDB credentials, fix .env.example | 30 min | DevOps |
| Fix agent.run.failed duplicate learning | 30 min | Backend |
| Fix window.React in LearningPage | 15 min | Frontend |
| Add supersededBy/supersedes to DB upsert | 2 hours | Backend |
| Wire up comment keyword handler | 1 hour | Backend |
| Add basic input validation to tools | 3 hours | Backend |
| Add ESLint + Prettier + pre-commit hooks | 1 hour | DevOps |
| Rehydrate ALL stores from DB on startup | 2 hours | Backend |

**Total effort: ~10 hours**

#### Phase 2: Near-Term (Weeks 2-3) - "Production Ready"

| Task | Effort | Owner |
|---|---|---|
| Split worker.ts into handler modules | 6 hours | Backend |
| Add multi-tenant companyId scoping | 8 hours | Backend |
| Implement LRU cache for in-memory stores | 6 hours | Backend |
| Expand test coverage to >80% | 24 hours | QA/Backend |
| Set up CI/CD pipeline (GitHub Actions) | 4 hours | DevOps |
| Add structured logging and metrics | 4 hours | Backend |
| Fix BM25 score aggregation across fields | 2 hours | Backend |
| Replace Math.random() ID generation | 30 min | Backend |
| Fix computeSummary type safety gap | 30 min | Backend |

**Total effort: ~55 hours**

#### Phase 3: Strategic (Weeks 4-8) - "World-Class"

| Task | Effort | Owner |
|---|---|---|
| Add semantic/vector search | 16 hours | Backend/ML |
| Implement learning quality feedback loop | 6 hours | Backend |
| Add automated tag suggestion | 4 hours | Backend |
| Implement learning decay and refresh | 6 hours | Backend |
| Add knowledge gap detection | 6 hours | Backend |
| Build evaluation pipeline for self-improvement | 12 hours | Backend/ML |
| Add automated learning extraction from run logs | 16 hours | Backend/ML |
| Add cross-referencing between learnings | 4 hours | Backend |
| Implement monitoring and alerting dashboard | 8 hours | DevOps |
| Add automated release workflow | 3 hours | DevOps |

**Total effort: ~81 hours**

---

## 12. Recommended Next Steps

### Single Highest-Leverage Set of Changes to Make First

**The credential leak + dual-store fix + duplicate learning fix** (items 1-3 in the priority list) should be addressed **today**. These are confirmed bugs with active risk:

1. **Credential leak** is an active security incident -- the database is exposed
2. **Dual-store inconsistency** means data is silently lost on every restart
3. **Duplicate learnings** pollute the knowledge base with every failed agent run

These three fixes take less than 3 hours combined and eliminate the most critical risks.

### After Immediate Fixes

The next highest-leverage investment is **expanding test coverage**. The current 8-test suite covers only the happy path of basic CRUD. Without tests, every subsequent change is risky. Aim for:
- Tests for all event handlers (mock ctx)
- Tests for supersession logic
- Tests for BM25 search
- Tests for tool handlers with invalid input
- Integration tests with SurrealDB

### Long-Term Vision

The plugin has the foundation to become a **self-improving organizational memory system**. The key differentiator would be the feedback loop: learnings that get accessed become more prominent, stale learnings get flagged, knowledge gaps get detected, and agent performance improves through targeted playbook suggestions. This transforms the plugin from a passive knowledge store into an active learning engine.

---

*Document generated from comprehensive codebase review of Ola-Turmo/uos-org-learning-plugin at commit HEAD (2026-04-15).*
