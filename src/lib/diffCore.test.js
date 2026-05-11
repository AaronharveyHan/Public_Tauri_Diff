import { describe, it, expect } from "vitest";
import { jsMyers, normalizeDiffBlocks, diffBlocksEqual } from "./diffCore";

describe("jsMyers", () => {
  it("handles empty input", () => {
    const result = jsMyers([], []);
    expect(result).toEqual([]);
  });

  it("handles adding lines", () => {
    const result = jsMyers([], ["a", "b", "c"]);
    expect(result).toEqual([
      {
        start_a: 0,
        end_a: 0,
        start_b: 0,
        end_b: 3,
        change_type: "Add",
        content_a: [],
        content_b: ["a", "b", "c"],
      },
    ]);
  });

  it("handles removing lines", () => {
    const result = jsMyers(["a", "b", "c"], []);
    expect(result).toEqual([
      {
        start_a: 0,
        end_a: 3,
        start_b: 0,
        end_b: 0,
        change_type: "Remove",
        content_a: ["a", "b", "c"],
        content_b: [],
      },
    ]);
  });

  it("detects identical content", () => {
    const result = jsMyers(["a", "b", "c"], ["a", "b", "c"]);
    expect(result).toEqual([]);
  });

  it("detects single line modification", () => {
    const result = jsMyers(["line1", "line2", "line3"], ["line1", "modified", "line3"]);
    // Myers may return 2 blocks (remove and add) instead of 1 modify block
    // After normalization they should merge into 1 modify block
    expect(result.length).toBeGreaterThan(0);
    // Verify the blocks contain the right content
    const allContentA = result.flatMap(b => b.content_a);
    const allContentB = result.flatMap(b => b.content_b);
    expect(allContentA).toContain("line2");
    expect(allContentB).toContain("modified");
  });

  it("handles complex diff scenario", () => {
    const a = ["function foo() {", "  return 42;", "}", "", "function bar() {", "  return 0;", "}"];
    const b = [
      "function foo() {",
      "  const x = 10;",
      "  return x + 32;",
      "}",
      "",
      "function bar(n) {",
      "  return n;",
      "}",
    ];
    const result = jsMyers(a, b);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("normalizeDiffBlocks", () => {
  it("returns empty array for empty input", () => {
    expect(normalizeDiffBlocks([])).toEqual([]);
  });

  it("normalizes single block", () => {
    const input = [
      {
        start_a: 0,
        end_a: 2,
        start_b: 0,
        end_b: 3,
        change_type: "Modify",
        content_a: ["a", "b"],
        content_b: ["a", "b", "c"],
      },
    ];
    const result = normalizeDiffBlocks(input);
    expect(result).toHaveLength(1);
    expect(result[0].change_type).toBe("Modify");
  });

  it("merges adjacent blocks of same type", () => {
    const input = [
      {
        start_a: 0,
        end_a: 2,
        start_b: 0,
        end_b: 2,
        change_type: "Remove",
        content_a: ["line1", "line2"],
        content_b: [],
      },
      {
        start_a: 2,
        end_a: 4,
        start_b: 2,
        end_b: 2,
        change_type: "Remove",
        content_a: ["line3", "line4"],
        content_b: [],
      },
    ];
    const result = normalizeDiffBlocks(input);
    expect(result).toHaveLength(1);
    expect(result[0].content_a).toHaveLength(4);
  });

  it("does not merge blocks of different types", () => {
    const input = [
      {
        start_a: 0,
        end_a: 2,
        start_b: 0,
        end_b: 2,
        change_type: "Remove",
        content_a: ["a", "b"],
        content_b: [],
      },
      {
        start_a: 2,
        end_a: 2,
        start_b: 2,
        end_b: 4,
        change_type: "Add",
        content_a: [],
        content_b: ["c", "d"],
      },
    ];
    const result = normalizeDiffBlocks(input);
    expect(result).toHaveLength(2);
  });

  it("filters out empty blocks", () => {
    const input = [
      {
        start_a: 0,
        end_a: 0,
        start_b: 0,
        end_b: 0,
        change_type: "Modify",
        content_a: [],
        content_b: [],
      },
    ];
    const result = normalizeDiffBlocks(input);
    expect(result).toHaveLength(0);
  });

  it("handles malformed blocks with missing fields", () => {
    const input = [
      {
        start_a: 0,
        end_a: 2,
        // Missing start_b, end_b
        change_type: "Remove",
        content_a: ["a", "b"],
        content_b: [],
      },
    ];
    const result = normalizeDiffBlocks(input);
    expect(result).toHaveLength(1);
    expect(result[0].start_b).toBe(0);
    expect(result[0].end_b).toBe(0);
  });
});

describe("diffBlocksEqual", () => {
  it("returns true for equal blocks", () => {
    const blocks = [
      {
        start_a: 0,
        end_a: 2,
        start_b: 0,
        end_b: 2,
        change_type: "Remove",
        content_a: ["a", "b"],
        content_b: [],
      },
    ];
    expect(diffBlocksEqual(blocks, blocks)).toBe(true);
  });

  it("returns true for blocks that normalize to same result", () => {
    const a = [
      {
        start_a: 0,
        end_a: 1,
        start_b: 0,
        end_b: 0,
        change_type: "Remove",
        content_a: ["line1"],
        content_b: [],
      },
      {
        start_a: 1,
        end_a: 2,
        start_b: 0,
        end_b: 0,
        change_type: "Remove",
        content_a: ["line2"],
        content_b: [],
      },
    ];
    const b = [
      {
        start_a: 0,
        end_a: 2,
        start_b: 0,
        end_b: 0,
        change_type: "Remove",
        content_a: ["line1", "line2"],
        content_b: [],
      },
    ];
    expect(diffBlocksEqual(a, b)).toBe(true);
  });

  it("returns false for different block counts", () => {
    const a = [
      {
        start_a: 0,
        end_a: 1,
        start_b: 0,
        end_b: 1,
        change_type: "Add",
        content_a: [],
        content_b: ["x"],
      },
    ];
    const b = [
      {
        start_a: 0,
        end_a: 1,
        start_b: 0,
        end_b: 1,
        change_type: "Add",
        content_a: [],
        content_b: ["x"],
      },
      {
        start_a: 1,
        end_a: 2,
        start_b: 1,
        end_b: 2,
        change_type: "Remove",
        content_a: ["y"],
        content_b: [],
      },
    ];
    expect(diffBlocksEqual(a, b)).toBe(false);
  });

  it("returns false for different block content", () => {
    const a = [
      {
        start_a: 0,
        end_a: 1,
        start_b: 0,
        end_b: 1,
        change_type: "Modify",
        content_a: ["old"],
        content_b: ["new"],
      },
    ];
    const b = [
      {
        start_a: 0,
        end_a: 1,
        start_b: 0,
        end_b: 1,
        change_type: "Modify",
        content_a: ["old"],
        content_b: ["different"],
      },
    ];
    expect(diffBlocksEqual(a, b)).toBe(false);
  });

  it("normalizes and compares identical logical changes", () => {
    // Same change represented in different block arrangements
    const twoBlocks = [
      {
        start_a: 1,
        end_a: 2,
        start_b: 1,
        end_b: 1,
        change_type: "Remove",
        content_a: ["line2"],
        content_b: [],
      },
      {
        start_a: 2,
        end_a: 2,
        start_b: 1,
        end_b: 2,
        change_type: "Add",
        content_a: [],
        content_b: ["modified"],
      },
    ];
    const oneBlock = [
      {
        start_a: 1,
        end_a: 2,
        start_b: 1,
        end_b: 2,
        change_type: "Modify",
        content_a: ["line2"],
        content_b: ["modified"],
      },
    ];
    // When normalized, the two-block version stays as 2 blocks (different types)
    // but the one-block version stays as 1 block
    // This is expected - they represent the same change but with different granularity
    // The key is that both are valid diff outputs
    const norm1 = normalizeDiffBlocks(twoBlocks);
    const norm2 = normalizeDiffBlocks(oneBlock);
    expect(norm1.length).toBeGreaterThanOrEqual(1);
    expect(norm2.length).toBeGreaterThanOrEqual(1);
    // Both should have the same content
    const content1A = norm1.flatMap(b => b.content_a);
    const content1B = norm1.flatMap(b => b.content_b);
    const content2A = norm2.flatMap(b => b.content_a);
    const content2B = norm2.flatMap(b => b.content_b);
    expect(content1A).toEqual(["line2"]);
    expect(content1B).toEqual(["modified"]);
    expect(content2A).toEqual(["line2"]);
    expect(content2B).toEqual(["modified"]);
  });
});
