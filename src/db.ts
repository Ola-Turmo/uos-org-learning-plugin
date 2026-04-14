/**
 * SurrealDB Cloud persistence layer for uos.org-learning plugin.
 *
 * Connection (v2 SDK — surrealdb npm package):
 *   WSS endpoint  → SURREALDB_URL
 *   Auth user     → SURREALDB_USER  (default: root)
 *   Auth pass     → SURREALDB_PASS
 *   Namespace     → SURREALDB_NS
 *   Database      → SURREALDB_DB
 *
 * Gracefully falls back to in-memory when env vars are absent so the plugin
 * still works in dev / CI without a live database.
 */

import { Surreal } from "surrealdb";
import type {
  Learning,
  Playbook,
  Policy,
  Deliverable,
  Scorecard,
  ScorecardHistoryEntry,
  Retrospective,
  AuditEntry,
  LearningSource,
  LearningTag,
  LearningStatus,
  LearningPriority,
  DeliverableStatus,
  RetrospectiveStatus,
} from "./types.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface DbConfig {
  url:       string;
  user:      string;
  pass:      string;
  namespace: string;
  database:  string;
}

function getConfig(): DbConfig | null {
  const url  = process.env.SURREALDB_URL      ?? process.env.SURREAL_DB_URL      ?? "";
  const user = process.env.SURREALDB_USER     ?? process.env.SURREAL_DB_USER     ?? "root";
  const pass = process.env.SURREALDB_PASS     ?? process.env.SURREAL_DB_PASS     ?? "";
  const ns   = process.env.SURREALDB_NS       ?? process.env.SURREAL_DB_NS       ?? "";
  const db   = process.env.SURREALDB_DB       ?? process.env.SURREAL_DB_DB       ?? "";

  if (!url || !pass) return null;
  return {
    url,
    user,
    pass,
    namespace: ns  || "demo",
    database:   db  || "surreal_deal_store",
  };
}

// ---------------------------------------------------------------------------
// Singleton client
// ---------------------------------------------------------------------------

let _db: Surreal | null = null;
let _connected = false;

export async function connectDatabase(): Promise<boolean> {
  if (_connected) return true;
  const config = getConfig();
  if (!config) {
    console.warn("[db] No SURREALDB_URL/PASS — running in-memory mode");
    return false;
  }

  try {
    _db = new Surreal();
    await _db.connect(config.url);
    await _db.use({ namespace: config.namespace, database: config.database });
    await _db.signin({ username: config.user, password: config.pass });
    _connected = true;
    console.info(`[db] Connected to SurrealDB Cloud: ${config.namespace}/${config.database}`);
    return true;
  } catch (err) {
    console.error("[db] Connection failed — falling back to in-memory", err);
    _db = null;
    return false;
  }
}

export function isConnected(): boolean {
  return _connected;
}

export async function dbClose(): Promise<void> {
  if (_db) {
    await _db.close();
    _db = null;
    _connected = false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Execute a raw SurrealQL query and return the first result array. */
async function query<T>(sql: string, vars?: Record<string, unknown>): Promise<T[]> {
  if (!_db) return [];
  const [result] = await _db.query<[T[]]>(sql, vars);
  return result ?? [];
}

// ---------------------------------------------------------------------------
// Learning
// ---------------------------------------------------------------------------

interface DbLearning {
  id:          string;
  title:       string;
  body:        string;
  source:      LearningSource;
  sourceId?:   string;
  sourceName?: string;
  tags:        LearningTag[];
  status:      LearningStatus;
  priority:    LearningPriority;
  createdAt:   string;
  updatedAt:   string;
  createdBy?:  string;
  supersededBy?: string;
  supersedes?:   string[];
}

function toLearning(r: DbLearning): Learning { return r as unknown as Learning; }

export async function dbUpsertLearning(learning: Learning): Promise<Learning> {
  if (!_db) throw new Error("Database not connected");
  const [result] = await _db.query<[DbLearning[]]>(
    /* SurrealQL upsert — INSERT with ON DUPLICATE KEY UPDATE */
    `INSERT INTO learning {
      id:          $id,
      title:       $title,
      body:        $body,
      source:      $source,
      sourceId:    $sourceId,
      sourceName:  $sourceName,
      tags:        $tags,
      status:      $status,
      priority:    $priority,
      createdAt:   $createdAt,
      updatedAt:   $updatedAt,
      createdBy:  $createdBy,
      supersededBy: $supersededBy,
      supersedes:  $supersedes
    } ON DUPLICATE KEY UPDATE
      title       = $title,
      body        = $body,
      source      = $source,
      sourceId    = $sourceId,
      sourceName  = $sourceName,
      tags        = $tags,
      status      = $status,
      priority    = $priority,
      updatedAt   = $updatedAt,
      supersededBy = $supersededBy,
      supersedes  = $supersedes
    RETURN *`,
    {
      id:          learning.id,
      title:       learning.title,
      body:        learning.body,
      source:      learning.source,
      sourceId:    learning.sourceId ?? null,
      sourceName:  learning.sourceName ?? null,
      tags:        learning.tags,
      status:      learning.status,
      priority:    learning.priority,
      createdAt:   learning.createdAt,
      updatedAt:   learning.updatedAt,
      createdBy:   learning.createdBy ?? null,
      supersededBy: learning.supersededBy ?? null,
      supersedes:  learning.supersedes ?? null,
    }
  );
  if (!result?.length) throw new Error("Upsert failed");
  return toLearning(result[0]);
}

export async function dbUpdateLearning(
  id: string,
  patch: Partial<Pick<Learning, "title" | "body" | "tags" | "status" | "priority" | "supersededBy" | "supersedes">>
): Promise<Learning | null> {
  if (!_db) return null;
  const sets: string[] = [];
  const vars: Record<string, unknown> = { id };
  if (patch.title      !== undefined) { sets.push("title       = $title");       vars.title       = patch.title; }
  if (patch.body       !== undefined) { sets.push("body        = $body");        vars.body        = patch.body; }
  if (patch.tags       !== undefined) { sets.push("tags        = $tags");        vars.tags        = patch.tags; }
  if (patch.status     !== undefined) { sets.push("status      = $status");     vars.status      = patch.status; }
  if (patch.priority   !== undefined) { sets.push("priority    = $priority");   vars.priority    = patch.priority; }
  if (patch.supersededBy !== undefined) { sets.push("supersededBy = $supersededBy"); vars.supersededBy = patch.supersededBy; }
  if (patch.supersedes !== undefined) { sets.push("supersedes  = $supersedes"); vars.supersedes  = patch.supersedes; }
  if (!sets.length) return null;
  vars.updatedAt = new Date().toISOString();
  sets.push("updatedAt = $updatedAt");
  const [result] = await _db.query<[DbLearning[]]>(
    `UPDATE learning SET ${sets.join(", ")} WHERE id = $id RETURN *`,
    vars
  );
  return result?.length ? toLearning(result[0]) : null;
}

export async function dbDeleteLearning(id: string): Promise<void> {
  if (!_db) return;
  await _db.query(`DELETE FROM learning WHERE id = $id`, { id });
}

export async function dbSelectLearnings(opts?: {
  status?: LearningStatus; source?: LearningSource; limit?: number;
}): Promise<Learning[]> {
  const rows = await query<DbLearning>("SELECT * FROM learning ORDER BY updatedAt DESC");
  let results = rows.map(toLearning);
  if (opts?.status)  results = results.filter(l => l.status  === opts.status);
  if (opts?.source)  results = results.filter(l => l.source === opts.source);
  return opts?.limit ? results.slice(0, opts.limit) : results;
}

export async function dbSelectLearningById(id: string): Promise<Learning | null> {
  if (!_db) return null;
  const [result] = await _db.query<[DbLearning[]]>(
    "SELECT * FROM learning WHERE id = $id", { id }
  );
  return result?.length ? toLearning(result[0]) : null;
}

export async function dbSelectAllLearnings(): Promise<Learning[]> {
  const rows = await query<DbLearning>("SELECT * FROM learning ORDER BY updatedAt DESC");
  return rows.map(toLearning);
}

// ---------------------------------------------------------------------------
// Playbook
// ---------------------------------------------------------------------------

interface DbPlaybook {
  id: string; title: string; body: string; tags: LearningTag[];
  sourceInfo?: { source: LearningSource; sourceId?: string; sourceName?: string };
  createdAt: string; updatedAt: string; createdBy?: string;
}
function toPlaybook(r: DbPlaybook): Playbook { return r as unknown as Playbook; }

export async function dbUpsertPlaybook(p: Playbook): Promise<Playbook> {
  if (!_db) throw new Error("Database not connected");
  const [result] = await _db.query<[DbPlaybook[]]>(
    `INSERT INTO playbook {
      id: $id, title: $title, body: $body, tags: $tags,
      sourceInfo: $sourceInfo, createdAt: $createdAt, updatedAt: $updatedAt, createdBy: $createdBy
    } ON DUPLICATE KEY UPDATE
      title = $title, body = $body, tags = $tags,
      sourceInfo = $sourceInfo, updatedAt = $updatedAt
    RETURN *`,
    { id: p.id, title: p.title, body: p.body, tags: p.tags,
      sourceInfo: p.sourceInfo ?? null, createdAt: p.createdAt,
      updatedAt: p.updatedAt, createdBy: p.createdBy ?? null }
  );
  if (!result?.length) throw new Error("Upsert playbook failed");
  return toPlaybook(result[0]);
}

export async function dbSelectAllPlaybooks(): Promise<Playbook[]> {
  const rows = await query<DbPlaybook>("SELECT * FROM playbook ORDER BY updatedAt DESC");
  return rows.map(toPlaybook);
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

interface DbPolicy {
  id: string; title: string; body: string; tags: LearningTag[];
  sourceInfo?: { source: LearningSource; sourceId?: string; sourceName?: string };
  createdAt: string; updatedAt: string; createdBy?: string;
}
function toPolicy(r: DbPolicy): Policy { return r as unknown as Policy; }

export async function dbUpsertPolicy(p: Policy): Promise<Policy> {
  if (!_db) throw new Error("Database not connected");
  const [result] = await _db.query<[DbPolicy[]]>(
    `INSERT INTO policy {
      id: $id, title: $title, body: $body, tags: $tags,
      sourceInfo: $sourceInfo, createdAt: $createdAt, updatedAt: $updatedAt, createdBy: $createdBy
    } ON DUPLICATE KEY UPDATE
      title = $title, body = $body, tags = $tags,
      sourceInfo = $sourceInfo, updatedAt = $updatedAt
    RETURN *`,
    { id: p.id, title: p.title, body: p.body, tags: p.tags,
      sourceInfo: p.sourceInfo ?? null, createdAt: p.createdAt,
      updatedAt: p.updatedAt, createdBy: p.createdBy ?? null }
  );
  if (!result?.length) throw new Error("Upsert policy failed");
  return toPolicy(result[0]);
}

// ---------------------------------------------------------------------------
// Deliverable
// ---------------------------------------------------------------------------

interface DbDeliverable {
  id: string; relatedRunId: string; agentId: string; status: DeliverableStatus;
  feedback?: string; score?: number; createdAt: string; updatedAt: string;
}
function toDeliverable(r: DbDeliverable): Deliverable { return r as unknown as Deliverable; }

export async function dbUpsertDeliverable(d: Deliverable): Promise<Deliverable> {
  if (!_db) throw new Error("Database not connected");
  const [result] = await _db.query<[DbDeliverable[]]>(
    `INSERT INTO deliverable {
      id: $id, relatedRunId: $relatedRunId, agentId: $agentId,
      status: $status, feedback: $feedback, score: $score,
      createdAt: $createdAt, updatedAt: $updatedAt
    } ON DUPLICATE KEY UPDATE
      status = $status, feedback = $feedback, score = $score, updatedAt = $updatedAt
    RETURN *`,
    {
      id: d.id, relatedRunId: d.relatedRunId, agentId: d.agentId,
      status: d.status, feedback: d.feedback ?? null, score: d.score ?? null,
      createdAt: d.createdAt, updatedAt: d.updatedAt,
    }
  );
  if (!result?.length) throw new Error("Upsert deliverable failed");
  return toDeliverable(result[0]);
}

export async function dbSelectDeliverable(id: string): Promise<Deliverable | null> {
  if (!_db) return null;
  const [result] = await _db.query<[DbDeliverable[]]>(
    "SELECT * FROM deliverable WHERE id = $id", { id }
  );
  return result?.length ? toDeliverable(result[0]) : null;
}

export async function dbSelectDeliverablesByRun(runId: string): Promise<Deliverable[]> {
  const rows = await query<DbDeliverable>(
    "SELECT * FROM deliverable WHERE relatedRunId = $runId", { runId }
  );
  return rows.map(toDeliverable);
}

// ---------------------------------------------------------------------------
// Scorecard
// ---------------------------------------------------------------------------

interface DbScorecard {
  scopeKind: string; scopeId: string; metricName: string;
  currentValue: number; targetValue: number; history: ScorecardHistoryEntry[];
}
function toScorecard(r: DbScorecard): Scorecard { return r as unknown as Scorecard; }

export async function dbUpsertScorecard(s: Scorecard): Promise<Scorecard> {
  if (!_db) throw new Error("Database not connected");
  const [result] = await _db.query<[DbScorecard[]]>(
    `INSERT INTO scorecard {
      scopeKind: $scopeKind, scopeId: $scopeId, metricName: $metricName,
      currentValue: $currentValue, targetValue: $targetValue, history: $history
    } ON DUPLICATE KEY UPDATE
      currentValue = $currentValue, targetValue = $targetValue, history = $history
    RETURN *`,
    {
      scopeKind: s.scopeKind, scopeId: s.scopeId, metricName: s.metricName,
      currentValue: s.currentValue, targetValue: s.targetValue, history: s.history,
    }
  );
  if (!result?.length) throw new Error("Upsert scorecard failed");
  return toScorecard(result[0]);
}

export async function dbSelectScorecard(
  scopeKind: string, scopeId: string, metricName: string
): Promise<Scorecard | null> {
  if (!_db) return null;
  const [result] = await _db.query<[DbScorecard[]]>(
    `SELECT * FROM scorecard WHERE scopeKind = $scopeKind AND scopeId = $scopeId AND metricName = $metricName`,
    { scopeKind, scopeId, metricName }
  );
  return result?.length ? toScorecard(result[0]) : null;
}

export async function dbAppendScorecardHistory(
  scopeKind: string, scopeId: string, metricName: string, value: number
): Promise<ScorecardHistoryEntry> {
  if (!_db) {
    return { value, timestamp: new Date().toISOString() };
  }
  const existing = await dbSelectScorecard(scopeKind, scopeId, metricName);
  const now = new Date().toISOString();
  const entry: ScorecardHistoryEntry = { value, timestamp: now };
  if (existing) {
    await dbUpsertScorecard({ ...existing, currentValue: value, history: [...existing.history, entry] });
  } else {
    await dbUpsertScorecard({ scopeKind, scopeId, metricName, currentValue: value, targetValue: 1, history: [entry] });
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Retrospective
// ---------------------------------------------------------------------------

interface DbRetro {
  scopeKind: string; scopeId: string;
  linkedDeliverableIds: string[]; keyFindings: string[];
  actionItems: string[]; status: RetrospectiveStatus;
  createdAt: string; updatedAt: string;
}
function toRetro(r: DbRetro): Retrospective { return r as unknown as Retrospective; }

export async function dbUpsertRetrospective(r: Retrospective): Promise<Retrospective> {
  if (!_db) throw new Error("Database not connected");
  const [result] = await _db.query<[DbRetro[]]>(
    `INSERT INTO retrospective {
      scopeKind: $scopeKind, scopeId: $scopeId,
      linkedDeliverableIds: $linkedDeliverableIds, keyFindings: $keyFindings,
      actionItems: $actionItems, status: $status, createdAt: $createdAt, updatedAt: $updatedAt
    } ON DUPLICATE KEY UPDATE
      linkedDeliverableIds = $linkedDeliverableIds, keyFindings = $keyFindings,
      actionItems = $actionItems, status = $status, updatedAt = $updatedAt
    RETURN *`,
    {
      scopeKind: r.scopeKind, scopeId: r.scopeId,
      linkedDeliverableIds: r.linkedDeliverableIds ?? [],
      keyFindings: r.keyFindings ?? [],
      actionItems: r.actionItems ?? [],
      status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt,
    }
  );
  if (!result?.length) throw new Error("Upsert retrospective failed");
  return toRetro(result[0]);
}

export async function dbSelectRetrospective(scopeKind: string, scopeId: string): Promise<Retrospective | null> {
  if (!_db) return null;
  const [result] = await _db.query<[DbRetro[]]>(
    `SELECT * FROM retrospective WHERE scopeKind = $scopeKind AND scopeId = $scopeId LIMIT 1`,
    { scopeKind, scopeId }
  );
  return result?.length ? toRetro(result[0]) : null;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export async function dbAppendAudit(a: AuditEntry): Promise<void> {
  if (!_db) return;
  await _db.query(
    `INSERT INTO audit_entry { action: $action, actorId: $actorId, actorType: $actorType, note: $note, timestamp: $timestamp }`,
    { action: a.action, actorId: a.actorId, actorType: a.actorType, note: a.note ?? null, timestamp: a.timestamp }
  );
}
