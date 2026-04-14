import { beforeEach, describe, it } from "vitest";
import { equal } from "node:assert";

import {
  createLearning,
  updateLearning,
  archiveLearning,
  queryLearnings,
  computeSummary,
  computeHealth,
  clearStore,
} from "../src/helpers.js";

describe("helpers", () => {
  beforeEach(() => clearStore());

  it("creates a learning", async () => {
    const lr = await createLearning({
      title: "Test learning",
      body: "Something important.",
      source: "incident",
      priority: "high",
    });
    equal(lr.id.startsWith("lrn_"), true);
    equal(lr.title, "Test learning");
    equal(lr.status, "active");
  });

  it("updates a learning", async () => {
    const lr = await createLearning({ title: "A", body: "B", source: "manual" });
    const updated = await updateLearning({ id: lr.id, title: "A updated" });
    equal(updated?.title, "A updated");
  });

  it("archives a learning", async () => {
    const lr = await createLearning({ title: "A", body: "B", source: "manual" });
    const archived = await archiveLearning(lr.id);
    equal(archived?.status, "archived");
  });

  it("queries learnings by text", async () => {
    await createLearning({ title: "Foo bar", body: "Something", source: "incident" });
    await createLearning({ title: "Baz", body: "Unrelated", source: "manual" });
    const results = queryLearnings({ query: "foo" });
    equal(results.length, 1);
    equal(results[0].title, "Foo bar");
  });

  it("queries learnings by source", async () => {
    await createLearning({ title: "A", body: "B", source: "incident" });
    await createLearning({ title: "C", body: "D", source: "manual" });
    const results = queryLearnings({ sources: ["incident"] });
    equal(results.length, 1);
    equal(results[0].source, "incident");
  });

  it("computes summary", async () => {
    await createLearning({ title: "A", body: "B", source: "incident", priority: "high" });
    await createLearning({ title: "C", body: "D", source: "manual", priority: "low" });
    const summary = computeSummary();
    equal(summary.totalLearnings, 2);
    equal(summary.recentCount, 2);
  });

  it("computes health — degraded when empty", () => {
    const health = computeHealth();
    equal(health.status, "degraded");
  });

  it("computes health — ok when learnings exist", async () => {
    await createLearning({ title: "A", body: "B", source: "incident" });
    const health = computeHealth();
    equal(health.status, "ok");
  });
});
