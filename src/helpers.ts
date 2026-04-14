/**
 * In-memory store and query helpers for ALL uos.org-learning entities.
 *
 * Stores:
 *   - learnings[]       — LearningTag+Learning artifacts with full-text search
 *   - playbooks[]        — Predefined task templates
 *   - policies[]         — Formal organizational rules
 *   - deliverables[]     — Agent run output artifacts
 *   - scorecards[]       — KPI metrics per scope
 *   - retrospectives[]   — Post-mortem summaries
 *   - auditLog[]         — Immutable action audit trail
 */

import type {
  Learning,
  LearningSummary,
  LearningQuery,
  LearningCreateParams,
  LearningUpdateParams,
  LearningSource,
  LearningPriority,
  LearningStatus,
  LearningTag,
  KnowledgeEntry,
  Playbook,
  Policy,
  Deliverable,
  DeliverableStatus,
  Scorecard,
  ScorecardHistoryEntry,
  Retrospective,
  RetrospectiveStatus,
  AuditEntry,
  ActorType,
  ArtifactKind,
} from "./types.js";

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

let _learnings: Learning[] = [];
let _playbooks: Playbook[] = [];
let _policies: Policy[] = [];
let _deliverables: Deliverable[] = [];
let _scorecards: Scorecard[] = [];
let _retrospectives: Retrospective[] = [];
let _auditLog: AuditEntry[] = [];

// ---------------------------------------------------------------------------
// Store access
// ---------------------------------------------------------------------------

export function getLearningsStore(): Learning[] {
  return _learnings;
}
export function getPlaybooksStore(): Playbook[] {
  return _playbooks;
}
export function getPoliciesStore(): Policy[] {
  return _policies;
}
export function getDeliverablesStore(): Deliverable[] {
  return _deliverables;
}
export function getScorecardsStore(): Scorecard[] {
  return _scorecards;
}
export function getRetrospectivesStore(): Retrospective[] {
  return _retrospectives;
}
export function getAuditLogStore(): AuditEntry[] {
  return _auditLog;
}

export function clearStore(): void {
  _learnings = [];
  _playbooks = [];
  _policies = [];
  _deliverables = [];
  _scorecards = [];
  _retrospectives = [];
  _auditLog = [];
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Audit log (append-only)
// ---------------------------------------------------------------------------

export function appendAudit(
  action: string,
  actorId: string,
  actorType: ActorType,
  note?: string
): void {
  _auditLog.push({
    action,
    actorId,
    actorType,
    note,
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Learning CRUD + queries
// ---------------------------------------------------------------------------

export function createLearning(params: LearningCreateParams): Learning {
  const now = new Date().toISOString();
  const learning: Learning = {
    id: genId("lrn"),
    title: params.title,
    body: params.body,
    source: params.source,
    sourceId: params.sourceId,
    sourceName: params.sourceName,
    tags: params.tags ?? [],
    status: "active",
    priority: params.priority ?? "medium",
    createdAt: now,
    updatedAt: now,
    createdBy: params.createdBy,
  };
  _learnings.push(learning);
  appendAudit("learning.created", learning.id, "agent", `Created: ${learning.title}`);
  return learning;
}

export function updateLearning(params: LearningUpdateParams): Learning | null {
  const idx = _learnings.findIndex((l) => l.id === params.id);
  if (idx === -1) return null;
  const existing = _learnings[idx];
  const updated: Learning = {
    ...existing,
    title: params.title ?? existing.title,
    body: params.body ?? existing.body,
    tags: params.tags ?? existing.tags,
    status: params.status ?? existing.status,
    priority: params.priority ?? existing.priority,
    updatedAt: new Date().toISOString(),
  };
  _learnings[idx] = updated;
  appendAudit("learning.updated", updated.id, "agent", `Updated: ${updated.title}`);
  return updated;
}

export function archiveLearning(id: string): Learning | null {
  return updateLearning({ id, status: "archived" });
}

export function getLearningById(id: string): Learning | null {
  return _learnings.find((l) => l.id === id) ?? null;
}

export function queryLearnings(q: LearningQuery): Learning[] {
  let results = [..._learnings];

  if (q.query) {
    const lower = q.query.toLowerCase();
    results = results.filter(
      (l) =>
        l.title.toLowerCase().includes(lower) ||
        l.body.toLowerCase().includes(lower) ||
        l.tags.some((t) => t.name.toLowerCase().includes(lower))
    );
  }

  if (q.sources?.length) {
    results = results.filter((l) => q.sources!.includes(l.source));
  }

  if (q.tags?.length) {
    results = results.filter((l) =>
      q.tags!.every((qt) => l.tags.some((lt) => lt.name === qt))
    );
  }

  if (q.priority) {
    results = results.filter((l) => l.priority === q.priority);
  }

  if (q.status) {
    results = results.filter((l) => l.status === q.status);
  }

  results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return q.limit ? results.slice(0, q.limit) : results;
}

export function getLearningsBySource(source: LearningSource, limit?: number): Learning[] {
  return queryLearnings({ sources: [source], status: "active", limit });
}

// ---------------------------------------------------------------------------
// Summary / health
// ---------------------------------------------------------------------------

function countByField<T extends Learning>(
  store: T[],
  field: (l: T) => string
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const l of store) {
    const key = field(l);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function computeSummary(): LearningSummary {
  const active = _learnings.filter((l) => l.status === "active");
  const bySource = countByField(active, (l) => l.source) as Record<LearningSource, number>;
  const byPriority = countByField(active, (l) => l.priority) as Record<LearningPriority, number>;
  const byStatus = countByField(_learnings, (l) => l.status) as Record<LearningStatus, number>;

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentCount = active.filter((l) => new Date(l.createdAt) >= sevenDaysAgo).length;

  return {
    totalLearnings: _learnings.length,
    bySource,
    byPriority,
    byStatus,
    recentCount,
  };
}

export function computeHealth(): { status: "ok" | "degraded"; checkedAt: string; message?: string } {
  const summary = computeSummary();
  if (summary.totalLearnings === 0) {
    return { status: "degraded", checkedAt: new Date().toISOString(), message: "No learnings recorded yet." };
  }
  if (summary.recentCount === 0) {
    return { status: "degraded", checkedAt: new Date().toISOString(), message: "No new learnings in the last 7 days." };
  }
  return { status: "ok", checkedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Playbooks
// ---------------------------------------------------------------------------

export function createPlaybook(params: {
  title: string;
  body: string;
  tags?: LearningTag[];
  source?: LearningSource;
  sourceId?: string;
  sourceName?: string;
  createdBy?: string;
}): Playbook {
  const now = new Date().toISOString();
  const playbook: Playbook = {
    id: genId("play"),
    title: params.title,
    body: params.body,
    tags: params.tags ?? [],
    sourceInfo: params.source
      ? { source: params.source, sourceId: params.sourceId, sourceName: params.sourceName }
      : undefined,
    createdAt: now,
    updatedAt: now,
    createdBy: params.createdBy,
  };
  _playbooks.push(playbook);
  appendAudit("playbook.created", playbook.id, "agent", `Created: ${playbook.title}`);
  return playbook;
}

export function searchPlaybooks(query?: string, tags?: string[]): Playbook[] {
  let results = [..._playbooks];
  if (query) {
    const lower = query.toLowerCase();
    results = results.filter(
      (p) =>
        p.title.toLowerCase().includes(lower) ||
        p.body.toLowerCase().includes(lower)
    );
  }
  if (tags?.length) {
    results = results.filter((p) => tags.every((t) => p.tags.some((pt) => pt.name === t)));
  }
  return results.slice(0, 20);
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export function createPolicy(params: {
  title: string;
  body: string;
  tags?: LearningTag[];
  source?: LearningSource;
  sourceId?: string;
  sourceName?: string;
  createdBy?: string;
}): Policy {
  const now = new Date().toISOString();
  const policy: Policy = {
    id: genId("pol"),
    title: params.title,
    body: params.body,
    tags: params.tags ?? [],
    sourceInfo: params.source
      ? { source: params.source, sourceId: params.sourceId, sourceName: params.sourceName }
      : undefined,
    createdAt: now,
    updatedAt: now,
    createdBy: params.createdBy,
  };
  _policies.push(policy);
  appendAudit("policy.created", policy.id, "agent", `Created: ${policy.title}`);
  return policy;
}

// ---------------------------------------------------------------------------
// Deliverables
// ---------------------------------------------------------------------------

export function createDeliverable(params: {
  relatedRunId: string;
  agentId: string;
  status?: DeliverableStatus;
}): Deliverable {
  const now = new Date().toISOString();
  const d: Deliverable = {
    id: genId("del"),
    relatedRunId: params.relatedRunId,
    agentId: params.agentId,
    status: params.status ?? "pending_review",
    createdAt: now,
    updatedAt: now,
  };
  _deliverables.push(d);
  appendAudit("deliverable.created", d.id, "agent", `Run: ${d.relatedRunId}`);
  return d;
}

export function approveDeliverable(id: string, feedback?: string): Deliverable | null {
  const d = _deliverables.find((x) => x.id === id);
  if (!d) return null;
  d.status = "approved";
  d.feedback = feedback;
  d.updatedAt = new Date().toISOString();
  appendAudit("deliverable.approved", id, "agent", feedback);
  return d;
}

export function rejectDeliverable(id: string, feedback?: string): Deliverable | null {
  const d = _deliverables.find((x) => x.id === id);
  if (!d) return null;
  d.status = "rejected";
  d.feedback = feedback;
  d.updatedAt = new Date().toISOString();
  appendAudit("deliverable.rejected", id, "agent", feedback);
  return d;
}

// ---------------------------------------------------------------------------
// Retrospectives
// ---------------------------------------------------------------------------

export function createOrUpdateRetrospective(params: {
  scopeKind: string;
  scopeId: string;
  keyFindings?: string[];
  actionItems?: string[];
  status?: RetrospectiveStatus;
}): Retrospective {
  const existing = _retrospectives.find(
    (r) => r.scopeKind === params.scopeKind && r.scopeId === params.scopeId
  );
  const now = new Date().toISOString();

  if (existing) {
    if (params.keyFindings) existing.keyFindings = params.keyFindings;
    if (params.actionItems) existing.actionItems = params.actionItems;
    if (params.status) existing.status = params.status;
    existing.updatedAt = now;
    appendAudit("retrospective.updated", existing.scopeId, "agent");
    return existing;
  }

  const retro: Retrospective = {
    scopeKind: params.scopeKind,
    scopeId: params.scopeId,
    linkedDeliverableIds: [],
    keyFindings: params.keyFindings ?? [],
    actionItems: params.actionItems ?? [],
    status: params.status ?? "draft",
    createdAt: now,
    updatedAt: now,
  };
  _retrospectives.push(retro);
  appendAudit("retrospective.created", params.scopeId, "agent");
  return retro;
}

export function getRetrospective(scopeKind: string, scopeId: string): Retrospective | null {
  return _retrospectives.find(
    (r) => r.scopeKind === scopeKind && r.scopeId === scopeId
  ) ?? null;
}

// ---------------------------------------------------------------------------
// Seed demo data
// ---------------------------------------------------------------------------

export function seedDemoLearnings(): void {
  if (_learnings.length > 0) return;

  const seeds: LearningCreateParams[] = [
    {
      title: "Connector Slack callbacks fail after upstream API change",
      body: "When Slack changes their callback signature, replaying missed events requires manual reconciliation. Always check the x-signature-timestamp header before replay.",
      source: "incident",
      sourceId: "slack-callback-mismatch",
      sourceName: "Slack Connector",
      tags: [{ name: "slack", source: "connector" }, { name: "callbacks", source: "connector" }],
      priority: "high",
      createdBy: "ops-cockpit",
    },
    {
      title: "Use readiness packets for launch decisions instead of ad-hoc checklists",
      body: "LaunchReadinessService provides structured readiness scoring. Always create a ReadinessPacket before any go/no-go decision.",
      source: "project",
      sourceName: "UOS v2 Migration",
      tags: [{ name: "launch", source: "project" }, { name: "readiness", source: "workflow" }],
      priority: "high",
      createdBy: "dept-product-tech",
    },
    {
      title: "Department health degrades when tools are unregistered mid-flight",
      body: "Tools must be gracefully deregistered — mark them as degraded before removing from the registry to prevent orphaned actions.",
      source: "department",
      sourceId: "uos-department-product-tech",
      sourceName: "Product Tech Department",
      tags: [{ name: "health", source: "department" }, { name: "tools", source: "system" }],
      priority: "medium",
      createdBy: "dept-product-tech",
    },
  ];

  for (const params of seeds) {
    createLearning(params);
  }

  // Demo playbooks
  createPlaybook({
    title: "Incident Response Playbook",
    body: "## Incident Response\n\n1. **Detect** — Alert fires in monitoring dashboard\n2. **Triage** — Classify severity (P1/P2/P3/P4)\n3. **Assemble** — Page on-call, open incident issue\n4. **Mitigate** — Apply rollback or hotfix\n5. **Resolve** — Confirm service restored\n6. **Retro** — Schedule retrospective within 48h\n\nSee the Retrospective tab on the incident issue for auto-generated findings.",
    tags: [{ name: "incident", source: "playbook" }, { name: "operations", source: "playbook" }],
    source: "manual",
    createdBy: "org-learning-plugin",
  });

  createPlaybook({
    title: "Code Review Playbook",
    body: "## Code Review Checklist\n\n1. **Correctness** — Does it solve the stated problem?\n2. **Testing** — Are there unit/integration tests?\n3. **Performance** — Any N+1 queries or expensive operations?\n4. **Security** — Input validation, auth checks, secrets management\n5. **Readability** — Clear naming, documented intent\n6. **Documentation** — README/API docs updated if needed",
    tags: [{ name: "code-review", source: "playbook" }, { name: "quality", source: "playbook" }],
    source: "manual",
    createdBy: "org-learning-plugin",
  });

  createPlaybook({
    title: "Architecture Decision Playbook",
    body: "## ADR Process\n\n1. **Context** — What forces are driving this change?\n2. **Decision** — What is the proposed solution?\n3. **Consequences** — Document both positive and negative outcomes\n4. **Alternatives considered** — Why were other options rejected?\n\nUse the Architecture Decision template in the project root. Link the ADR in the pull request description.",
    tags: [{ name: "architecture", source: "playbook" }, { name: "adr", source: "playbook" }],
    source: "manual",
    createdBy: "org-learning-plugin",
  });
}
