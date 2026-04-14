/**
 * React UI widgets for uos.org-learning plugin.
 * Exports: LearningWidget, LearningHealthWidget, RetroTab, LearningPage
 */

import type { CSSProperties } from "react";
import {
  usePluginData,
  usePluginAction,
  type PluginWidgetProps,
} from "@paperclipai/plugin-sdk/ui";

import type {
  Learning,
  LearningSummary,
  Retrospective,
} from "../types.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

type HealthData = { status: "ok" | "degraded"; checkedAt: string; message?: string };
type LearningListData = { learnings?: Learning[] };
type RetroData = { retrospective: Retrospective | null };
type SummaryData = LearningSummary;

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

function priorityBadgeStyle(priority: string): CSSProperties {
  if (priority === "critical") return { fontSize: "10px", fontWeight: 600, textTransform: "uppercase" as const, padding: "1px 5px", borderRadius: "3px", background: "#fee2e2", color: "#991b1b" };
  if (priority === "high") return { fontSize: "10px", fontWeight: 600, textTransform: "uppercase" as const, padding: "1px 5px", borderRadius: "3px", background: "#fef3c7", color: "#92400e" };
  if (priority === "medium") return { fontSize: "10px", fontWeight: 600, textTransform: "uppercase" as const, padding: "1px 5px", borderRadius: "3px", background: "#dbeafe", color: "#1e40af" };
  return { fontSize: "10px", fontWeight: 600, textTransform: "uppercase" as const, padding: "1px 5px", borderRadius: "3px", background: "#e5e7eb", color: "#374151" };
}

function healthDotStyle(status: string): CSSProperties {
  return { width: "8px", height: "8px", borderRadius: "50%", background: status === "ok" ? "#22c55e" : status === "degraded" ? "#f59e0b" : "#9ca3af", display: "inline-block" };
}

const S = {
  container: { fontFamily: "system-ui, sans-serif", fontSize: "14px", padding: "0.75rem", display: "grid", gap: "0.5rem" } as CSSProperties,
  header: { display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 600, fontSize: "14px" } as CSSProperties,
  refreshButton: { marginLeft: "auto", padding: "2px 8px", fontSize: "12px", cursor: "pointer", border: "1px solid #ccc", borderRadius: "4px", background: "#f5f5f5" } as CSSProperties,
  empty: { color: "#666", fontSize: "13px", fontStyle: "italic" as const } as CSSProperties,
  feed: { display: "grid", gap: "0.5rem", maxHeight: "400px", overflowY: "auto" as const } as CSSProperties,
  card: { border: "1px solid #e0e0e0", borderRadius: "6px", padding: "0.5rem 0.625rem", background: "#fafafa", display: "grid", gap: "0.25rem" } as CSSProperties,
  cardHeader: { display: "flex", gap: "0.375rem", alignItems: "center" } as CSSProperties,
  cardTitle: { fontWeight: 600, fontSize: "13px", lineHeight: 1.3 } as CSSProperties,
  cardBody: { fontSize: "12px", color: "#444", lineHeight: 1.4 } as CSSProperties,
  sourceTag: { fontSize: "10px", background: "#f3f4f6", color: "#6b7280", padding: "1px 5px", borderRadius: "3px", border: "1px solid #e5e7eb" } as CSSProperties,
  tagRow: { display: "flex", gap: "0.25rem", flexWrap: "wrap" as const, marginTop: "0.125rem" } as CSSProperties,
  tag: { fontSize: "10px", background: "#eff6ff", color: "#1d4ed8", padding: "1px 5px", borderRadius: "3px" } as CSSProperties,
  healthMessage: { fontSize: "12px", color: "#92400e", background: "#fef3c7", padding: "0.25rem 0.5rem", borderRadius: "4px" } as CSSProperties,
  statsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem", marginTop: "0.25rem" } as CSSProperties,
  stat: { textAlign: "center" as const, padding: "0.5rem", background: "#f5f5f5", borderRadius: "6px", border: "1px solid #e5e7eb" } as CSSProperties,
  statValue: { fontSize: "20px", fontWeight: 700, lineHeight: 1 } as CSSProperties,
  statLabel: { fontSize: "11px", color: "#6b7280", marginTop: "2px" } as CSSProperties,
  sectionTitle: { fontWeight: 600, fontSize: "13px", marginTop: "0.5rem", marginBottom: "0.25rem", color: "#374151" } as CSSProperties,
  findingsList: { paddingLeft: "1rem", display: "grid", gap: "0.25rem" } as CSSProperties,
  findingItem: { fontSize: "12px", color: "#374151", lineHeight: 1.4 } as CSSProperties,
  actionItem: { fontSize: "12px", color: "#1e40af", paddingLeft: "0.5rem", borderLeft: "2px solid #dbeafe", marginTop: "0.25rem" } as CSSProperties,
  statusBadge: (status: string): CSSProperties => ({
    fontSize: "10px", fontWeight: 600, padding: "1px 6px", borderRadius: "9999px",
    background: status === "completed" ? "#dcfce7" : status === "pending_review" ? "#fef3c7" : "#f3f4f6",
    color: status === "completed" ? "#166534" : status === "pending_review" ? "#92400e" : "#374151",
  }),
  retroEmpty: { color: "#666", fontSize: "13px", fontStyle: "italic" as const, padding: "1rem 0" } as CSSProperties,
  fullPage: { fontFamily: "system-ui, sans-serif", fontSize: "14px", padding: "1rem", maxWidth: "800px" } as CSSProperties,
  pageHeader: { marginBottom: "1rem", paddingBottom: "0.75rem", borderBottom: "1px solid #e5e7eb" } as CSSProperties,
  searchBar: { width: "100%", padding: "0.5rem", fontSize: "14px", border: "1px solid #d1d5db", borderRadius: "6px", marginBottom: "0.75rem", boxSizing: "border-box" as const } as CSSProperties,
  filterRow: { display: "flex", gap: "0.5rem", flexWrap: "wrap" as const, marginBottom: "0.75rem" } as CSSProperties,
  filterChip: (active: boolean): CSSProperties => ({ padding: "4px 10px", fontSize: "12px", borderRadius: "9999px", cursor: "pointer", border: "1px solid", background: active ? "#1d4ed8" : "#fff", color: active ? "#fff" : "#6b7280", borderColor: active ? "#1d4ed8" : "#d1d5db" } as CSSProperties),
  fullCard: { border: "1px solid #e5e7eb", borderRadius: "8px", padding: "0.75rem", background: "#fff", display: "grid", gap: "0.375rem" } as CSSProperties,
  fullCardTitle: { fontWeight: 600, fontSize: "14px", lineHeight: 1.4 } as CSSProperties,
  fullCardBody: { fontSize: "13px", color: "#444", lineHeight: 1.5 } as CSSProperties,
};

// ---------------------------------------------------------------------------
// LearningWidget — recent learnings feed (dashboard widget)
// ---------------------------------------------------------------------------

export function LearningWidget(_props: PluginWidgetProps) {
  const { data, loading, error } = usePluginData<LearningListData>("learning.list");
  const refreshAction = usePluginAction("learning.query");

  if (loading) return <div style={S.container}>Loading learnings…</div>;
  if (error) return <div style={S.container}>Error: {error.message}</div>;

  const learnings = data?.learnings ?? [];

  return (
    <div style={S.container}>
      <div style={S.header}>
        <strong>Org Learning Feed</strong>
        <button style={S.refreshButton} onClick={() => void refreshAction({ limit: 10 })}>
          Refresh
        </button>
      </div>

      {learnings.length === 0 ? (
        <div style={S.empty}>No learnings yet. Ingest one from an incident or project.</div>
      ) : (
        <div style={S.feed}>
          {learnings.slice(0, 8).map((l) => (
            <div key={l.id} style={S.card}>
              <div style={S.cardHeader}>
                <span style={priorityBadgeStyle(l.priority)}>{l.priority}</span>
                <span style={S.sourceTag}>{l.source}</span>
              </div>
              <div style={S.cardTitle}>{l.title}</div>
              <div style={S.cardBody}>
                {l.body.slice(0, 120)}
                {l.body.length > 120 ? "…" : ""}
              </div>
              {l.tags.length > 0 && (
                <div style={S.tagRow}>
                  {l.tags.slice(0, 4).map((t) => (
                    <span key={t.name} style={S.tag}>{t.name}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LearningHealthWidget — summary stats (dashboard widget)
// ---------------------------------------------------------------------------

export function LearningHealthWidget(_props: PluginWidgetProps) {
  const { data: healthData } = usePluginData<HealthData>("learning.health");
  const { data: summaryData } = usePluginData<SummaryData>("learning.summary");

  if (!healthData) return <div style={S.container}>Loading health…</div>;

  const health = healthData;
  const summary = summaryData;

  return (
    <div style={S.container}>
      <div style={S.header}>
        <strong>Learning Health</strong>
        <span style={healthDotStyle(health?.status ?? "degraded")} />
        <span>{health?.status ?? "unknown"}</span>
      </div>

      {health?.message && <div style={S.healthMessage}>{health.message}</div>}

      {summary ? (
        <div style={S.statsGrid}>
          <div style={S.stat}>
            <div style={S.statValue}>{summary.totalLearnings}</div>
            <div style={S.statLabel}>Total</div>
          </div>
          <div style={S.stat}>
            <div style={S.statValue}>{summary.recentCount}</div>
            <div style={S.statLabel}>Last 7d</div>
          </div>
          <div style={S.stat}>
            <div style={S.statValue}>{summary.byStatus?.active ?? 0}</div>
            <div style={S.statLabel}>Active</div>
          </div>
        </div>
      ) : (
        <div style={S.empty}>No summary available.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RetroTab — retrospective panel for issue detail pages
// ---------------------------------------------------------------------------

interface RetroTabProps extends PluginWidgetProps {
  /** The issue ID from the context — passed automatically by the host */
  entityId?: string;
}

export function RetroTab(props: RetroTabProps) {
  // Use entityId from props if available, otherwise try to get from context
  const entityId = props.entityId ?? "unknown";

  const { data, loading, error } = usePluginData<RetroData>("retrospective.get", {
    scopeKind: "issue",
    scopeId: entityId,
  });
  const createRetroAction = usePluginAction("retrospective.create");
  const learningsAction = usePluginAction("learning.query");

  if (loading) return <div style={S.container}>Loading retrospective…</div>;
  if (error) return <div style={S.container}>Error: {error.message}</div>;

  const retro: Retrospective | null = data?.retrospective ?? null;

  function handleCreateRetro() {
    void createRetroAction({
      scopeKind: "issue",
      scopeId: entityId,
      status: "draft",
    });
  }

  return (
    <div style={S.container}>
      <div style={S.header}>
        <strong>Retrospective</strong>
        {retro && <span style={S.statusBadge(retro.status)}>{retro.status.replace("_", " ")}</span>}
      </div>

      {!retro ? (
        <div style={S.retroEmpty}>
          <p style={{ margin: "0 0 0.75rem" }}>No retrospective for this issue yet.</p>
          <button
            style={{ ...S.refreshButton, marginLeft: 0 }}
            onClick={handleCreateRetro}
          >
            Create Retrospective
          </button>
        </div>
      ) : (
        <>
          {retro.keyFindings.length > 0 && (
            <>
              <div style={S.sectionTitle}>Key Findings</div>
              <div style={S.findingsList}>
                {retro.keyFindings.map((f, i) => (
                  <div key={i} style={S.findingItem}>{f}</div>
                ))}
              </div>
            </>
          )}

          {retro.actionItems.length > 0 && (
            <>
              <div style={S.sectionTitle}>Action Items</div>
              <div style={S.findingsList}>
                {retro.actionItems.map((a, i) => (
                  <div key={i} style={S.actionItem}>{a}</div>
                ))}
              </div>
            </>
          )}

          {retro.keyFindings.length === 0 && retro.actionItems.length === 0 && (
            <div style={S.retroEmpty}>Retrospective is empty. Add findings and action items.</div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LearningPage — full-page learnings browser
// ---------------------------------------------------------------------------

export function LearningPage(_props: PluginWidgetProps) {
  const [query, setQuery] = window.React?.useState<string>("");
  const [activeSource, setActiveSource] = window.React?.useState<string>("all");
  const [displayLearnings, setDisplayLearnings] = window.React?.useState<Learning[]>([]);

  const { data, loading } = usePluginData<LearningListData>("learning.list", { limit: 50 });
  const searchAction = usePluginAction("learning.query");

  // Sync learnings from data
  window.React?.useEffect(() => {
    if (data?.learnings) {
      setDisplayLearnings(data.learnings);
    }
  }, [data]);

  const learnings = data?.learnings ?? [];
  const sources = ["all", "incident", "project", "manual", "approval", "department", "connector"];

  const filtered =
    activeSource === "all"
      ? learnings
      : learnings.filter((l) => l.source === activeSource);

  const searched = query
    ? filtered.filter(
        (l) =>
          l.title.toLowerCase().includes(query.toLowerCase()) ||
          l.body.toLowerCase().includes(query.toLowerCase()) ||
          l.tags.some((t) => t.name.toLowerCase().includes(query.toLowerCase()))
      )
    : filtered;

  return (
    <div style={S.fullPage}>
      <div style={S.pageHeader}>
        <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>Organizational Learnings</h2>
        <p style={{ margin: "0.25rem 0 0", color: "#6b7280", fontSize: "13px" }}>
          {learnings.length} total learnings — captured from incidents, projects, approvals, and agent runs.
        </p>
      </div>

      {/* Search */}
      <input
        style={S.searchBar}
        type="text"
        placeholder="Search learnings by title, body, or tag…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {/* Source filters */}
      <div style={S.filterRow}>
        {sources.map((src) => (
          <button
            key={src}
            style={S.filterChip(activeSource === src)}
            onClick={() => setActiveSource(src)}
          >
            {src === "all" ? "All Sources" : src.charAt(0).toUpperCase() + src.slice(1)}
          </button>
        ))}
      </div>

      {/* Results */}
      {loading ? (
        <div style={S.empty}>Loading…</div>
      ) : searched.length === 0 ? (
        <div style={S.empty}>No learnings match your search.</div>
      ) : (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {searched.map((l) => (
            <div key={l.id} style={S.fullCard as CSSProperties}>
              <div style={S.cardHeader}>
                <span style={priorityBadgeStyle(l.priority)}>{l.priority}</span>
                <span style={S.sourceTag}>{l.source}</span>
                <span style={{ fontSize: "11px", color: "#9ca3af", marginLeft: "auto" }}>
                  {new Date(l.updatedAt).toLocaleDateString()}
                </span>
              </div>
              <div style={S.fullCardTitle}>{l.title}</div>
              <div style={S.fullCardBody}>
                {l.body.slice(0, 300)}
                {l.body.length > 300 ? "…" : ""}
              </div>
              {l.tags.length > 0 && (
                <div style={S.tagRow}>
                  {l.tags.map((t) => (
                    <span key={t.name} style={S.tag}>{t.name}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
