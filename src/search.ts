/**
 * BM25 ranking engine using flexsearch.
 * Provides full-text + fielded search over learnings and playbooks.
 *
 * Why BM25 over simple substring match?
 * - Substring/keyword filters in helpers.ts are exact-match and O(n)
 * - BM25 is a probabilistic relevance ranking — it penalises frequent terms
 *   and rewards rare, informative ones, giving much better result ordering
 *   as the knowledge base grows past a few dozen entries.
 *
 * Architecture:
 *   searchIndex  — indexed once at startup; incrementally updated on CUD ops
 *   rank(query)  — BM25 scoring against title:body:tags, returns scored ids
 *   queryLearningsWithRanking() — merges BM25 scores with structured filters
 */

import type { Learning, Playbook } from "./types.js";

// -----------------------------------------------------------------------
// Flexsearch Document index — per-field weighting gives title highest signal
// -----------------------------------------------------------------------

// Lazy-load flexsearch so the module compiles even when search is unused.
let _Index: typeof import("flexsearch").Document | null = null;

async function getIndex() {
  if (!_Index) {
    const flexsearch = await import("flexsearch");
    _Index = flexsearch.Document;
  }
  return _Index!;
}

// Index schema — fields with relative weights (higher = more important)
const INDEX_FIELDS = [
  { field: "title",      weight: 8 },  // title is the strongest signal
  { field: "body",       weight: 4 },  // body is secondary
  { field: "tags",       weight: 2 },  // tags are tertiary
  { field: "sourceName", weight: 1 },  // source name is weakest
];

// ---------------------------------------------------------------------------
// In-memory index (shared state across calls within a warm worker)
// ---------------------------------------------------------------------------

interface SearchEntry {
  id: string;
  title: string;
  body: string;
  tags: string;   // denormalised as joined string for flexsearch
  sourceName: string;
  kind: "learning" | "playbook";
  [key: string]: string | "learning" | "playbook";   // index signature required by flexsearch Document
}

let _searchIndex: InstanceType<typeof import("flexsearch").Document> | null = null;
let _entries = new Map<string, SearchEntry>();

async function ensureIndex() {
  if (!_searchIndex) {
    const Doc = await getIndex();
    _searchIndex = new Doc({
      document: {
        id:     "id",
        index:  INDEX_FIELDS.map(f => f.field),
        store:  ["id", "kind"],
      },
    }) as InstanceType<typeof import("flexsearch").Document>;
  }
  return _searchIndex!;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add or update an entry in the search index.
 * Safe to call multiple times — Flexsearch Document upserts by id.
 */
export async function indexLearning(learning: Learning): Promise<void> {
  const idx = await ensureIndex();
  const entry: SearchEntry = {
    id:        learning.id,
    title:     learning.title,
    body:      learning.body,
    tags:      learning.tags.map(t => t.name).join(" "),
    sourceName: learning.sourceName ?? "",
    kind:      "learning",
  };
  _entries.set(learning.id, entry);
  idx.add(entry);
}

/** Remove a learning from the search index. */
export async function removeFromIndex(id: string): Promise<void> {
  const idx = await ensureIndex();
  _entries.delete(id);
  idx.remove(id);
}

/**
 * BM25 search over the indexed corpus.
 * Returns scored { id, kind } entries sorted by relevance.
 */
export async function bm25Search(
  query: string,
  limit = 10
): Promise<Array<{ id: string; kind: "learning" | "playbook" }>> {
  if (!query.trim()) return [];

  const idx = await ensureIndex();
  const results = await idx.searchAsync(query, {
    limit,
    enrich: true,
  });

  // Flexsearch returns { field: [Document<id, SearchEntry>] }
  // Deduplicate across fields and collect scores.
  const seen = new Set<string>();
  const scored: Array<{ id: string; kind: "learning" | "playbook" }> = [];

  for (const fieldResults of Object.values(results)) {
    if (!Array.isArray(fieldResults)) continue;
    for (const result of fieldResults as Array<{ result: SearchEntry }>) {
      if (seen.has(result.result.id)) continue;
      seen.add(result.result.id);
      scored.push({ id: result.result.id, kind: result.result.kind });
    }
  }

  return scored;
}

/**
 * Index a playbook in the search corpus.
 */
export async function indexPlaybook(playbook: Playbook): Promise<void> {
  const idx = await ensureIndex();
  const entry: SearchEntry = {
    id:        playbook.id,
    title:     playbook.title,
    body:      playbook.body,
    tags:      playbook.tags.map(t => t.name).join(" "),
    sourceName: playbook.sourceInfo?.sourceName ?? "",
    kind:      "playbook",
  };
  _entries.set(playbook.id, entry);
  idx.add(entry);
}

/**
 * Re-index all learnings in bulk — used at startup to rebuild from persisted store.
 */
export async function rebuildIndex(
  learnings: Learning[],
  playbooks: Playbook[]
): Promise<void> {
  const Doc = await getIndex();
  _searchIndex = null;   // reset
  _entries.clear();

  const idx = await ensureIndex();

  for (const learning of learnings) {
    await indexLearning(learning);
  }
  for (const playbook of playbooks) {
    await indexPlaybook(playbook);
  }
}
