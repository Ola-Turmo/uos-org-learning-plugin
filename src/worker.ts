/**
 * Worker for uos.org-learning plugin.
 *
 * All handlers are registered inside the single `setup(ctx)` function:
 * - Event subscriptions  (agent.run.*, issue.*, approval.*)
 * - Scheduled jobs        (weekly retrospective)
 * - Agent tools           (get-playbooks, search-knowledge, record-learning)
 * - Data queries          (learning.list, learning.summary, learning.health, …)
 * - Actions               (learning.create, learning.update, retrospective.create, …)
 */

import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type {
  PluginEvent,
  PluginJobContext,
  ToolResult,
} from "@paperclipai/plugin-sdk";

import {
  PLUGIN_ID,
  JOB_KEYS,
  TOOL_KEYS,
  DATA_KEYS,
  ACTION_KEYS,
} from "./constants.js";

import {
  createLearning,
  updateLearning,
  archiveLearning,
  queryLearnings,
  queryLearningsWithRanking,
  computeSummary,
  computeHealth,
  getLearningsBySource,
  searchPlaybooks,
  createPlaybook,
  createDeliverable,
  approveDeliverable,
  rejectDeliverable,
  createOrUpdateRetrospective,
  getRetrospective,
  seedDemoLearnings,
  rehydrateFromDb,
  supersedeLearning,
} from "./helpers.js";

import type {
  LearningQuery,
  LearningCreateParams,
  RetrospectiveStatus,
} from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTags(tags?: string | string[]): { name: string; source: string }[] {
  if (!tags) return [];
  const arr = Array.isArray(tags) ? tags : tags.split(",").map((t) => t.trim());
  return arr.map((name) => ({ name, source: "manual" }));
}

function normalizePriority(p?: string): "critical" | "high" | "medium" | "low" {
  if (p === "critical" || p === "high" || p === "low") return p;
  return "medium";
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("Setting up uos.org-learning plugin");

    // -------------------------------------------------------------------------
    // Event subscriptions
    // -------------------------------------------------------------------------

    ctx.events.on("agent.run.finished", async (event: PluginEvent) => {
      const runId = event.entityId ?? "unknown";
      const payload = event.payload as Record<string, unknown>;
      const agentId = (payload?.agentId as string) ?? "unknown";
      const runStatus = (payload?.status as string) ?? "unknown";

      createDeliverable({ relatedRunId: runId, agentId });

      if (runStatus === "failed") {
        createLearning({
          title: `Run failed: ${runId}`,
          body: `Agent run ${runId} completed with status '${runStatus}'. Review the run logs and capture lessons learned.`,
          source: "manual",
          sourceId: runId,
          sourceName: `Agent ${agentId}`,
          priority: "high",
          tags: [
            { name: "agent-run", source: "system" },
            { name: "failed", source: "system" },
          ],
          createdBy: "org-learning-plugin",
        });
        try {
          await ctx.activity.log({
            companyId: event.companyId,
            message: `Run ${runId} failed — learning placeholder created`,
            entityType: "run",
            entityId: runId,
          });
        } catch {
          // activity not available
        }
      }

      ctx.logger.info("agent.run.finished observed", { runId, agentId, runStatus });
    });

    ctx.events.on("agent.run.failed", async (event: PluginEvent) => {
      const runId = event.entityId ?? "unknown";
      const payload = event.payload as Record<string, unknown>;
      const agentId = (payload?.agentId as string) ?? "unknown";

      createLearning({
        title: `Agent run failed: ${runId}`,
        body: `Agent ${agentId} run ${runId} failed. Document the failure mode and resolution steps.`,
        source: "manual",
        sourceId: runId,
        sourceName: `Agent ${agentId}`,
        priority: "high",
        tags: [
          { name: "agent-run", source: "system" },
          { name: "failure", source: "system" },
        ],
        createdBy: "org-learning-plugin",
      });

      ctx.logger.info("agent.run.failed observed", { runId, agentId });
    });

    ctx.events.on("issue.created", async (event: PluginEvent) => {
      const issueId = event.entityId ?? "unknown";
      const payload = event.payload as Record<string, unknown>;
      const title = (payload?.title as string) ?? issueId;

      await ctx.state.set(
        { scopeKind: "issue", scopeId: issueId, stateKey: "seen" },
        true,
      );

      createLearning({
        title: `Issue tracked: ${title}`,
        body: `Issue '${title}' (${issueId}) was created. When resolved, a retrospective will capture lessons learned.`,
        source: "manual",
        sourceId: issueId,
        sourceName: title,
        priority: "medium",
        tags: [{ name: "issue", source: "system" }],
        createdBy: "org-learning-plugin",
      });

      ctx.logger.info("issue.created observed", { issueId });
    });

    ctx.events.on("issue.comment.created", async (event: PluginEvent) => {
      const issueId = event.entityId ?? "unknown";
      const payload = event.payload as Record<string, unknown>;
      const comment = (payload?.comment as string) ?? "";

      if (
        comment.includes("@org-learning record") ||
        comment.includes("record learning")
      ) {
        ctx.logger.info("Learning record trigger detected in comment", {
          issueId,
        });
      }
    });

    ctx.events.on("approval.created", async (event: PluginEvent) => {
      const approvalId = event.entityId ?? "unknown";
      const payload = event.payload as Record<string, unknown>;
      const requestedFor = (payload?.requestedFor as string) ?? "unknown";

      createLearning({
        title: `Approval pending: ${approvalId}`,
        body: `An approval request (${approvalId}) is awaiting decision for '${requestedFor}'. Decision outcomes are captured as learnings.`,
        source: "manual",
        sourceId: approvalId,
        sourceName: requestedFor,
        priority: "medium",
        tags: [{ name: "approval", source: "system" }],
        createdBy: "org-learning-plugin",
      });

      ctx.logger.info("approval.created observed", { approvalId, requestedFor });
    });

    ctx.events.on("approval.decided", async (event: PluginEvent) => {
      const approvalId = event.entityId ?? "unknown";
      const payload = event.payload as Record<string, unknown>;
      const decision = (payload?.decision as string) ?? "unknown";
      const decidedBy = (payload?.decidedBy as string) ?? "unknown";

      createLearning({
        title: `Approval ${decision}: ${approvalId}`,
        body: `Approval ${approvalId} was ${decision} by ${decidedBy}. Outcome captured for future reference.`,
        source: "manual",
        sourceId: approvalId,
        priority: decision === "rejected" ? "high" : "low",
        tags: [
          { name: "approval", source: "system" },
          { name: decision, source: "system" },
        ],
        createdBy: "org-learning-plugin",
      });

      ctx.logger.info("approval.decided observed", { approvalId, decision, decidedBy });
    });

    // -------------------------------------------------------------------------
    // Scheduled jobs
    // -------------------------------------------------------------------------

    ctx.jobs.register(
      JOB_KEYS.WEEKLY_RETROSPECTIVE,
      async (job: PluginJobContext) => {
        ctx.logger.info("Running weekly retrospective job", { jobKey: job.jobKey });

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const allActive = queryLearnings({ status: "active", limit: 100 });
        const recentLearnings = allActive.filter(
          (l) => new Date(l.createdAt) >= sevenDaysAgo,
        );

        const highPriority = recentLearnings.filter(
          (l) => l.priority === "high" || l.priority === "critical",
        );
        const bySource = new Map<string, number>();
        for (const l of recentLearnings) {
          bySource.set(l.source, (bySource.get(l.source) ?? 0) + 1);
        }

        const summaryLines = [
          `## Weekly Learning Summary`,
          `Generated: ${new Date().toISOString()}`,
          ``,
          `Total active learnings: ${recentLearnings.length}`,
          `High/critical priority: ${highPriority.length}`,
          ``,
          `### By Source`,
          ...Array.from(bySource.entries()).map(
            ([src, count]) => `- ${src}: ${count}`,
          ),
        ];

        const retro = await createOrUpdateRetrospective({
          scopeKind: "company",
          scopeId: "weekly-retro",
          keyFindings: highPriority.map((l) => l.title),
          actionItems: highPriority.map(
            (l) => `Review: ${l.title} (${l.sourceId ?? l.id})`,
          ),
          status: "draft",
        });

        try {
          await ctx.activity.log({
            companyId: "instance",
            message: `Weekly retrospective completed. ${recentLearnings.length} learnings reviewed.`,
            metadata: { summaryLines, retrospectiveId: retro.scopeId },
          });
        } catch {
          // activity not available
        }

        ctx.logger.info("Weekly retrospective job complete", {
          totalLearnings: recentLearnings.length,
          highPriorityCount: highPriority.length,
          retrospectiveId: retro.scopeId,
        });
      },
    );

    // -------------------------------------------------------------------------
    // Agent tools
    // -------------------------------------------------------------------------

    ctx.tools.register(
      TOOL_KEYS.GET_PLAYBOOKS,
      {
        displayName: "Get Playbooks",
        description:
          "Returns predefined playbooks relevant to the current context.",
        parametersSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Optional free-text query to filter playbooks.",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Optional tag filter.",
            },
          },
        },
      },
      async (params: unknown): Promise<ToolResult> => {
        const p = params as { query?: string; tags?: string[] };
        const results = searchPlaybooks(p.query, p.tags);
        return {
          content: JSON.stringify({ playbooks: results, count: results.length }),
        };
      },
    );

    ctx.tools.register(
      TOOL_KEYS.SEARCH_KNOWLEDGE,
      {
        displayName: "Search Knowledge Base",
        description: "Search the organizational knowledge base.",
        parametersSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Free-text search query." },
            sources: {
              type: "array",
              items: { type: "string" },
              description: "Optional source filter.",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Optional tag filter.",
            },
            limit: {
              type: "number",
              description: "Maximum results. Defaults to 10.",
            },
          },
        },
      },
      async (params: unknown): Promise<ToolResult> => {
        const p = params as {
          query?: string;
          sources?: string[];
          tags?: string[];
          limit?: number;
        };
        const results = queryLearnings({
          query: p.query,
          sources: p.sources as LearningQuery["sources"],
          tags: p.tags,
          limit: p.limit ?? 10,
        });
        return {
          content: JSON.stringify({ learnings: results, count: results.length }),
        };
      },
    );

    ctx.tools.register(
      TOOL_KEYS.RECORD_LEARNING,
      {
        displayName: "Record Learning",
        description: "Records a new learning artifact.",
        parametersSchema: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["knowledge_entry", "playbook", "policy"],
              description: "Kind of artifact.",
            },
            title: {
              type: "string",
              description: "Short descriptive title (max 120 chars).",
            },
            body: { type: "string", description: "Full content of the artifact." },
            source: {
              type: "string",
              description: "Source: 'incident', 'manual', 'approval', 'agent_run', 'project'.",
            },
            sourceId: { type: "string", description: "Optional source entity ID." },
            priority: {
              type: "string",
              enum: ["critical", "high", "medium", "low"],
              description: "Priority.",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Optional tags.",
            },
          },
          required: ["kind", "title", "body", "source"],
        },
      },
      async (params: unknown): Promise<ToolResult> => {
        const p = params as {
          kind?: string;
          title?: string;
          body?: string;
          source?: string;
          sourceId?: string;
          priority?: string;
          tags?: string | string[];
        };

        const title = String(p.title ?? "").slice(0, 120);
        const body = String(p.body ?? "");

        if (!title || !body) {
          return {
            error: "title and body are required",
          };
        }

        if (p.kind === "playbook") {
          const playbook = await createPlaybook({
            title,
            body,
            tags: parseTags(p.tags),
            source: p.source as LearningCreateParams["source"],
            sourceId: p.sourceId,
            createdBy: "agent",
          });
          return {
            content: JSON.stringify({
              id: playbook.id,
              title: playbook.title,
              kind: "playbook",
            }),
          };
        }

        if (p.kind === "policy") {
          const learning = await createLearning({
            title,
            body,
            source: (p.source as LearningCreateParams["source"]) ?? "manual",
            sourceId: p.sourceId,
            priority: normalizePriority(p.priority),
            tags: [...parseTags(p.tags), { name: "policy", source: "system" }],
            createdBy: "agent",
          });
          return {
            content: JSON.stringify({
              id: learning.id,
              title: learning.title,
              kind: "policy",
            }),
          };
        }

        // Default: knowledge_entry
        const learning = await createLearning({
          title,
          body,
          source: (p.source as LearningCreateParams["source"]) ?? "manual",
          sourceId: p.sourceId,
          priority: normalizePriority(p.priority),
          tags: parseTags(p.tags),
          createdBy: "agent",
        });
        return {
          content: JSON.stringify({
            id: learning.id,
            title: learning.title,
            kind: "knowledge_entry",
          }),
        };
      },
    );

    // -------------------------------------------------------------------------
    // Data queries
    // -------------------------------------------------------------------------

    ctx.data.register(
      DATA_KEYS.LEARNING_LIST,
      async (params: Record<string, unknown>) => {
        const limit = typeof params.limit === "number" ? params.limit : 20;
        const learnings = queryLearnings({ status: "active", limit });
        return { learnings };
      },
    );

    ctx.data.register(DATA_KEYS.LEARNING_SUMMARY, async () => {
      return computeSummary();
    });

    ctx.data.register(
      DATA_KEYS.LEARNING_BY_SOURCE,
      async (params: Record<string, unknown>) => {
        const source = params.source as LearningCreateParams["source"];
        const learnings = getLearningsBySource(source, 50);
        return { learnings, count: learnings.length };
      },
    );

    ctx.data.register(DATA_KEYS.HEALTH, async () => {
      return computeHealth();
    });

    ctx.data.register(
      "retrospective.get",
      async (params: Record<string, unknown>) => {
        const scopeKind = String(params.scopeKind ?? "issue");
        const scopeId = String(params.scopeId ?? "");
        const retro = getRetrospective(scopeKind, scopeId);
        return { retrospective: retro };
      },
    );

    ctx.data.register(
      "playbooks.search",
      async (params: Record<string, unknown>) => {
        const query =
          typeof params.query === "string" ? params.query : undefined;
        const tags = Array.isArray(params.tags)
          ? params.tags.map(String)
          : undefined;
        const results = searchPlaybooks(query, tags);
        return { playbooks: results, count: results.length };
      },
    );

    // -------------------------------------------------------------------------
    // Actions
    // -------------------------------------------------------------------------

    ctx.actions.register(
      ACTION_KEYS.CREATE_LEARNING,
      async (params: Record<string, unknown>) => {
        const p = params as unknown as LearningCreateParams;
        const learning = createLearning(p);
        return { success: true, learning };
      },
    );

    ctx.actions.register(
      ACTION_KEYS.UPDATE_LEARNING,
      async (params: Record<string, unknown>) => {
        const { id, ...rest } = params as {
          id: string;
        } & Partial<LearningCreateParams>;
        const updated = updateLearning({ id, ...rest });
        if (!updated) return { success: false, error: "Not found" };
        return { success: true, learning: updated };
      },
    );

    ctx.actions.register(
      ACTION_KEYS.ARCHIVE_LEARNING,
      async (params: Record<string, unknown>) => {
        const { id } = params as { id: string };
        const archived = archiveLearning(id);
        if (!archived) return { success: false, error: "Not found" };
        return { success: true, learning: archived };
      },
    );

    ctx.actions.register(
      ACTION_KEYS.QUERY_LEARNINGS,
      async (params: Record<string, unknown>) => {
        const q = params as unknown as LearningQuery;
        const results = queryLearnings(q);
        return { learnings: results, count: results.length };
      },
    );

    ctx.actions.register(
      ACTION_KEYS.INGEST_FROM_EVENT,
      async (params: Record<string, unknown>) => {
        const source = (params.source as LearningCreateParams["source"]) ?? "manual";
        const learning = createLearning({
          title: String(params.title ?? "Untitled"),
          body: String(params.body ?? ""),
          source,
          sourceId: params.sourceId as string | undefined,
          sourceName: params.sourceName as string | undefined,
          priority: normalizePriority(params.priority as string),
          tags: parseTags(params.tags as string | string[] | undefined),
          createdBy: params.createdBy as string | undefined,
        });
        return { success: true, learning };
      },
    );

    ctx.actions.register(
      "retrospective.create",
      async (params: Record<string, unknown>) => {
        const scopeKind = String(params.scopeKind ?? "issue");
        const scopeId = String(params.scopeId ?? "");
        const retro = createOrUpdateRetrospective({
          scopeKind,
          scopeId,
          keyFindings: Array.isArray(params.keyFindings)
            ? params.keyFindings.map(String)
            : undefined,
          actionItems: Array.isArray(params.actionItems)
            ? params.actionItems.map(String)
            : undefined,
          status: (params.status as RetrospectiveStatus) ?? "draft",
        });
        return { success: true, retrospective: retro };
      },
    );

    ctx.actions.register(
      "deliverable.approve",
      async (params: Record<string, unknown>) => {
        const { id, feedback } = params as { id: string; feedback?: string };
        const d = approveDeliverable(id, feedback);
        if (!d) return { success: false, error: "Not found" };
        return { success: true, deliverable: d };
      },
    );

    ctx.actions.register(
      "deliverable.reject",
      async (params: Record<string, unknown>) => {
        const { id, feedback } = params as { id: string; feedback?: string };
        const d = rejectDeliverable(id, feedback);
        if (!d) return { success: false, error: "Not found" };
        return { success: true, deliverable: d };
      },
    );

    // -------------------------------------------------------------------------
    // Setup: seed demo data
    // -------------------------------------------------------------------------

    seedDemoLearnings();
    ctx.logger.info("Plugin setup complete - demo data seeded");
  },
});

runWorker(plugin, import.meta.url);
