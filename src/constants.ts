/**
 * Plugin ID and key constants for uos.org-learning plugin.
 */

export const PLUGIN_ID = "uos.org-learning" as const;

// Event kinds this plugin subscribes to
export const EVENTS_KINDS = [
  "issue.created",
  "issue.updated",
  "issue.comment.created",
  "agent.run.started",
  "agent.run.finished",
  "agent.run.failed",
  "agent.run.cancelled",
  "approval.created",
  "approval.decided",
] as const;

// Job keys
export const JOB_KEYS = {
  WEEKLY_RETROSPECTIVE: "weekly-retrospective",
} as const;

// Data query keys
export const DATA_KEYS = {
  LEARNING_LIST: "learning.list",
  LEARNING_SUMMARY: "learning.summary",
  LEARNING_BY_SOURCE: "learning.bySource",
  HEALTH: "learning.health",
} as const;

// Action keys
export const ACTION_KEYS = {
  CREATE_LEARNING: "learning.create",
  UPDATE_LEARNING: "learning.update",
  ARCHIVE_LEARNING: "learning.archive",
  QUERY_LEARNINGS: "learning.query",
  INGEST_FROM_EVENT: "learning.ingestFromEvent",
} as const;

// Tool keys
export const TOOL_KEYS = {
  SEARCH_LEARNINGS: "learning.search",
  CREATE_LEARNING: "learning.create",
  GET_LEARNING_HEALTH: "learning.health",
  GET_PLAYBOOKS: "get-playbooks",
  SEARCH_KNOWLEDGE: "search-knowledge",
  RECORD_LEARNING: "record-learning",
} as const;

// Entity types
export const ENTITY_TYPES = {
  KNOWLEDGE_ENTRY: "knowledge_entry",
  PLAYBOOK: "playbook",
  POLICY: "policy",
  DELIVERABLE: "deliverable",
  SCORECARD: "scorecard",
  RETROSPECTIVE: "retrospective",
  AUDIT: "audit",
} as const;

// Scope kinds
export const SCOPE_KINDS = ["company", "run", "goal", "agent"] as const;

// UI export names (must match manifest slots)
export const UI_EXPORTS = {
  LEARNING_WIDGET: "LearningWidget",
  LEARNING_HEALTH_WIDGET: "LearningHealthWidget",
  RETRO_TAB: "RetroTab",
  LEARNING_PAGE: "LearningPage",
} as const;
