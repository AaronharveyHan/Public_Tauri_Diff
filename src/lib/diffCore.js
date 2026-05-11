// Shared diff core helpers.
// Both Rust and JS use Myers O(ND) algorithm for consistent output.

function previousEqualAnchor(edits, start, key) {
  for (let i = start - 1; i >= 0; i--) {
    if (edits[i].t === "eq") {
      return edits[i][key] + 1;
    }
  }
  return 0;
}

/**
 * Myers O(ND) line diff algorithm.
 * Efficient for small/medium diffs, consistent with Rust implementation.
 */
export function jsMyers(a, b) {
  const n = a.length;
  const m = b.length;

  if (n === 0 && m === 0) return [];
  if (n === 0) {
    return [{
      start_a: 0,
      end_a: 0,
      start_b: 0,
      end_b: m,
      change_type: "Add",
      content_a: [],
      content_b: [...b],
    }];
  }
  if (m === 0) {
    return [{
      start_a: 0,
      end_a: n,
      start_b: 0,
      end_b: 0,
      change_type: "Remove",
      content_a: [...a],
      content_b: [],
    }];
  }

  const max = n + m;
  const off = max;
  const v = new Array(2 * max + 1).fill(-1);
  v[off + 1] = 0;
  const snaps = [];

  outer: for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && v[k - 1 + off] < v[k + 1 + off]))
        ? v[k + 1 + off]
        : v[k - 1 + off] + 1;
      let y = x - k;

      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }

      v[k + off] = x;
      if (x >= n && y >= m) {
        snaps.push([...v]);
        break outer;
      }
    }

    snaps.push([...v]);
  }

  const edits = [];
  let x = n;
  let y = m;

  for (let d = snaps.length - 1; d >= 0; d--) {
    const sv = snaps[d];
    const k = x - y;
    const pk = (k === -d || (k !== d && (sv[k + 1 + off] ?? -1) > (sv[k - 1 + off] ?? -1)))
      ? k + 1
      : k - 1;

    const pv = d > 0 ? snaps[d - 1] : sv;
    const px = pv[pk + off] ?? 0;
    const py = px - pk;

    let cx = x;
    let cy = y;

    while (cx > px + 1 && cy > py + 1) {
      cx--;
      cy--;
      edits.push({ t: "eq", x: cx, y: cy });
    }

    if (d > 0) {
      if (pk === k - 1) edits.push({ t: "del", x: px });
      else edits.push({ t: "ins", y: py });
    }

    while (cx > px && cy > py) {
      cx--;
      cy--;
      edits.push({ t: "eq", x: cx, y: cy });
    }

    x = px;
    y = py;
    if (x <= 0 && y <= 0) break;
  }

  edits.reverse();

  const blocks = [];
  let i = 0;

  while (i < edits.length) {
    if (edits[i].t === "eq") {
      i++;
      continue;
    }

    const start = i;
    while (i < edits.length && edits[i].t !== "eq") i++;

    const run = edits.slice(start, i);
    const dels = run.filter((e) => e.t === "del").map((e) => e.x);
    const ins = run.filter((e) => e.t === "ins").map((e) => e.y);

    const ancA = previousEqualAnchor(edits, start, "x");
    const ancB = previousEqualAnchor(edits, start, "y");

    blocks.push({
      start_a: dels.length ? dels[0] : ancA,
      end_a: dels.length ? dels[dels.length - 1] + 1 : ancA,
      start_b: ins.length ? ins[0] : ancB,
      end_b: ins.length ? ins[ins.length - 1] + 1 : ancB,
      change_type: dels.length === 0 ? "Add" : ins.length === 0 ? "Remove" : "Modify",
      content_a: dels.map((idx) => a[idx]),
      content_b: ins.map((idx) => b[idx]),
    });
  }

  return blocks;
}

function normalizeOne(block) {
  const contentA = Array.isArray(block.content_a) ? block.content_a : [];
  const contentB = Array.isArray(block.content_b) ? block.content_b : [];

  const startA = Number.isInteger(block.start_a) ? block.start_a : 0;
  const endA = Number.isInteger(block.end_a) ? block.end_a : startA + contentA.length;
  const startB = Number.isInteger(block.start_b) ? block.start_b : 0;
  const endB = Number.isInteger(block.end_b) ? block.end_b : startB + contentB.length;

  const changeType = block.change_type || (contentA.length === 0 ? "Add" : contentB.length === 0 ? "Remove" : "Modify");

  return {
    start_a: startA,
    end_a: Math.max(startA, endA),
    start_b: startB,
    end_b: Math.max(startB, endB),
    change_type: changeType,
    content_a: [...contentA],
    content_b: [...contentB],
  };
}

export function normalizeDiffBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return [];

  const sorted = blocks
    .map(normalizeOne)
    .filter((b) => b.end_a > b.start_a || b.end_b > b.start_b)
    .sort((l, r) => (l.start_a - r.start_a) || (l.start_b - r.start_b));

  const merged = [];

  for (const block of sorted) {
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push(block);
      continue;
    }

    const sameType = prev.change_type === block.change_type;
    const touchA = prev.end_a >= block.start_a;
    const touchB = prev.end_b >= block.start_b;

    if (sameType && touchA && touchB) {
      prev.end_a = Math.max(prev.end_a, block.end_a);
      prev.end_b = Math.max(prev.end_b, block.end_b);
      prev.content_a.push(...block.content_a);
      prev.content_b.push(...block.content_b);
    } else {
      merged.push(block);
    }
  }

  return merged;
}

export function diffBlocksEqual(a, b) {
  const left = normalizeDiffBlocks(a);
  const right = normalizeDiffBlocks(b);
  if (left.length !== right.length) return false;

  for (let i = 0; i < left.length; i++) {
    if (JSON.stringify(left[i]) !== JSON.stringify(right[i])) return false;
  }
  return true;
}
