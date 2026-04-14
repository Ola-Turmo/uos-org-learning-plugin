import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "uos.org-learning",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Org Learning",
  description:
    "Captures, indexes, and surfaces organizational learnings — ingests from incidents, agent runs, and approvals; surfaces playbooks, policies, and retrospective insights at decision points.",
  author: "Ola Turmo",
  categories: ["automation", "ui"],
  minimumHostVersion: "2026.325.0",
  capabilities: [
    "events.subscribe",
    "jobs.schedule",
    "issues.read",
    "issue.comments.read",
    "activity.log.write",
    "plugin.state.read",
    "plugin.state.write",
    "ui.detailTab.register",
    "ui.dashboardWidget.register",
    "agent.tools.register",
  ],
  entrypoints: {
    worker: "dist/worker.js",
    ui: "dist/ui/",
  },
  jobs: [
    {
      jobKey: "weekly-retrospective",
      displayName: "Weekly Retrospective",
      description:
        "Scans completed issues and agent runs from the past week and generates retrospective summaries and action items.",
      schedule: "0 0 * * MON",
    },
  ],
  tools: [
    {
      name: "get-playbooks",
      displayName: "Get Playbooks",
      description:
        "Returns predefined playbooks relevant to the current context (e.g. incident response, code review, architecture decision). Use when asked to follow a standard process or when starting a complex task.",
      parametersSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Optional free-text query to filter playbooks by topic (e.g. 'incident', 'onboarding', 'deployment').",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional list of tags to filter playbooks (e.g. ['security', 'frontend']).",
          },
        },
      },
    },
    {
      name: "search-knowledge",
      displayName: "Search Knowledge Base",
      description:
        "Search the organizational knowledge base for prior learnings, Q&A, how-tos, and process documentation. Use this tool whenever you need to look up institutional knowledge before making a decision or performing a task.",
      parametersSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Free-text search query (e.g. 'deployment rollback steps', 'authentication setup').",
          },
          sources: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional list of source kinds to filter: 'incident', 'manual', 'approval', 'agent_run', 'project'.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optional tag filter.",
          },
          limit: {
            type: "number",
            description: "Maximum number of results to return. Defaults to 10.",
          },
        },
      },
    },
    {
      name: "record-learning",
      displayName: "Record Learning",
      description:
        "Records a new learning artifact (knowledge entry, playbook, or policy). Use whenever you discover something worth preserving — a lesson learned from an incident, a standard process, or a decision rationale.",
      parametersSchema: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["knowledge_entry", "playbook", "policy"],
            description:
              "The kind of learning artifact to create.",
          },
          title: {
            type: "string",
            description: "Short descriptive title for the learning (max 120 chars).",
          },
          body: {
            type: "string",
            description:
              "Full content of the learning artifact (markdown supported).",
          },
          source: {
            type: "string",
            description:
              "Where this learning originated: 'incident', 'manual', 'approval', 'agent_run', 'project'.",
          },
          sourceId: {
            type: "string",
            description:
              "Optional ID of the source entity (e.g. issue ID, run ID).",
          },
          priority: {
            type: "string",
            enum: ["critical", "high", "medium", "low"],
            description:
              "Priority level of the learning. Defaults to 'medium'.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional tags for categorization and retrieval (e.g. ['frontend', 'security', 'deployment']).",
          },
        },
        required: ["kind", "title", "body", "source"],
      },
    },
  ],
  ui: {
    slots: [
      {
        type: "dashboardWidget",
        id: "learning-widget",
        displayName: "Org Learning Feed",
        exportName: "LearningWidget",
      },
      {
        type: "dashboardWidget",
        id: "learning-health-widget",
        displayName: "Learning Health",
        exportName: "LearningHealthWidget",
      },
      {
        type: "detailTab",
        id: "retro-tab",
        displayName: "Retrospective",
        exportName: "RetroTab",
        entityTypes: ["issue"],
      },
      {
        type: "page",
        id: "learning-page",
        displayName: "Learnings",
        exportName: "LearningPage",
        routePath: "learnings",
      },
    ],
  },
};

export default manifest;
