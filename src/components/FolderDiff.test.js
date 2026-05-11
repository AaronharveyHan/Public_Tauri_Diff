/**
 * FolderDiff Integration Tests - v0.7
 * Tests the folder diff functionality end-to-end
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

// Lazy-load Tauri invoke for testing
let _invoke = null;
async function getInvoke() {
  if (_invoke) return _invoke;
  try {
    const mod = await import("@tauri-apps/api/core");
    _invoke = mod.invoke;
  } catch (e) {
    console.error("Failed to load Tauri invoke:", e);
    throw new Error("Tauri API not available");
  }
  return _invoke;
}

describe('Folder Diff (v0.7)', () => {
  let tempDir;
  let dirA;
  let dirB;

  beforeAll(() => {
    // Create temporary directories
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-diff-'));
    dirA = path.join(tempDir, 'a');
    dirB = path.join(tempDir, 'b');

    fs.ensureDirSync(dirA);
    fs.ensureDirSync(dirB);

    // Create test files in A
    fs.writeFileSync(path.join(dirA, 'file1.txt'), 'Hello World\nFoo Bar');
    fs.writeFileSync(path.join(dirA, 'file2.txt'), 'Same content');
    fs.writeFileSync(path.join(dirA, 'only_in_a.txt'), 'This is only in A');

    // Create subdirectory in A
    fs.ensureDirSync(path.join(dirA, 'subdir'));
    fs.writeFileSync(path.join(dirA, 'subdir', 'nested.txt'), 'Nested file');

    // Create test files in B
    fs.writeFileSync(path.join(dirB, 'file1.txt'), 'Hello World\nFoo Bar\nExtra Line');
    fs.writeFileSync(path.join(dirB, 'file2.txt'), 'Same content');
    fs.writeFileSync(path.join(dirB, 'only_in_b.txt'), 'This is only in B');

    // Create subdirectory in B
    fs.ensureDirSync(path.join(dirB, 'subdir'));
    fs.writeFileSync(path.join(dirB, 'subdir', 'nested.txt'), 'Nested file');
  });

  afterAll(() => {
    // Cleanup
    if (fs.existsSync(tempDir)) {
      fs.removeSync(tempDir);
    }
  });

  it('should compare two directories and return tree structure', async () => {
    const invoke = await getInvoke();
    const result = await invoke('diff_folders', {
      path_a: dirA,
      path_b: dirB,
    });

    expect(result).toBeDefined();
    expect(result.type).toBe('directory');
    expect(result.data.children).toBeDefined();
    expect(result.data.children.length).toBeGreaterThan(0);
  });

  it('should detect identical files', async () => {
    const invoke = await getInvoke();
    const result = await invoke('diff_folders', {
      path_a: dirA,
      path_b: dirB,
    });

    const file2Node = result.data.children.find(
      (child) => child.type === 'file' && child.data.name === 'file2.txt'
    );

    expect(file2Node).toBeDefined();
    expect(file2Node.data.status).toBe('identical');
  });

  it('should detect modified files', async () => {
    const invoke = await getInvoke();
    const result = await invoke('diff_folders', {
      path_a: dirA,
      path_b: dirB,
    });

    const file1Node = result.data.children.find(
      (child) => child.type === 'file' && child.data.name === 'file1.txt'
    );

    expect(file1Node).toBeDefined();
    expect(file1Node.data.status).toBe('modified');
    expect(file1Node.data.blocks).toBeDefined();
    expect(file1Node.data.blocks.length).toBeGreaterThan(0);
  });

  it('should detect added files', async () => {
    const invoke = await getInvoke();
    const result = await invoke('diff_folders', {
      path_a: dirA,
      path_b: dirB,
    });

    const addedNode = result.data.children.find(
      (child) => child.type === 'file' && child.data.name === 'only_in_b.txt'
    );

    expect(addedNode).toBeDefined();
    expect(addedNode.data.status).toBe('added');
    expect(addedNode.data.path_a).toBeNull();
    expect(addedNode.data.path_b).toBeDefined();
  });

  it('should detect removed files', async () => {
    const invoke = await getInvoke();
    const result = await invoke('diff_folders', {
      path_a: dirA,
      path_b: dirB,
    });

    const removedNode = result.data.children.find(
      (child) => child.type === 'file' && child.data.name === 'only_in_a.txt'
    );

    expect(removedNode).toBeDefined();
    expect(removedNode.data.status).toBe('removed');
    expect(removedNode.data.path_a).toBeDefined();
    expect(removedNode.data.path_b).toBeNull();
  });

  it('should recursively handle subdirectories', async () => {
    const invoke = await getInvoke();
    const result = await invoke('diff_folders', {
      path_a: dirA,
      path_b: dirB,
    });

    const subdirNode = result.data.children.find(
      (child) => child.type === 'directory' && child.data.name === 'subdir'
    );

    expect(subdirNode).toBeDefined();
    expect(subdirNode.type).toBe('directory');
    expect(subdirNode.data.children).toBeDefined();
  });

  it('should calculate directory summary', async () => {
    const invoke = await getInvoke();
    const result = await invoke('diff_folders', {
      path_a: dirA,
      path_b: dirB,
    });

    const summary = result.data.summary;
    expect(summary).toBeDefined();
    expect(summary.total_files).toBeGreaterThan(0);
    expect(summary.modified_files).toBeGreaterThanOrEqual(0);
    expect(summary.added_files).toBeGreaterThanOrEqual(0);
    expect(summary.removed_files).toBeGreaterThanOrEqual(0);
    expect(summary.identical_files).toBeGreaterThanOrEqual(0);
  });

  it('should handle empty directories', async () => {
    const invoke = await getInvoke();
    const emptyA = path.join(tempDir, 'empty_a');
    const emptyB = path.join(tempDir, 'empty_b');

    fs.ensureDirSync(emptyA);
    fs.ensureDirSync(emptyB);

    const result = await invoke('diff_folders', {
      path_a: emptyA,
      path_b: emptyB,
    });

    expect(result).toBeDefined();
    expect(result.type).toBe('directory');
    expect(result.data.children.length).toBe(0);
    expect(result.data.summary.total_files).toBe(0);
  });

  it('should return error for non-existent paths', async () => {
    const invoke = await getInvoke();
    try {
      await invoke('diff_folders', {
        path_a: '/nonexistent/path/a',
        path_b: '/nonexistent/path/b',
      });
      expect.fail('Should have thrown error');
    } catch (err) {
      expect(err).toBeDefined();
      expect(err.message).toContain('does not exist');
    }
  });

  it('should include file sizes in nodes', async () => {
    const invoke = await getInvoke();
    const result = await invoke('diff_folders', {
      path_a: dirA,
      path_b: dirB,
    });

    const fileNode = result.data.children.find(
      (child) => child.type === 'file'
    );

    expect(fileNode).toBeDefined();
    if (fileNode.data.status === 'identical' || fileNode.data.status === 'modified') {
      expect(fileNode.data.size_a).toBeDefined();
      expect(fileNode.data.size_b).toBeDefined();
      expect(typeof fileNode.data.size_a).toBe('number');
      expect(typeof fileNode.data.size_b).toBe('number');
    }
  });

  it('should handle large directory structures efficiently', async () => {
    const invoke = await getInvoke();
    const largeDir = path.join(tempDir, 'large');
    fs.ensureDirSync(largeDir);

    // Create 100 files in subdirectories
    for (let i = 0; i < 10; i++) {
      const subdir = path.join(largeDir, `dir${i}`);
      fs.ensureDirSync(subdir);
      for (let j = 0; j < 10; j++) {
        fs.writeFileSync(
          path.join(subdir, `file${j}.txt`),
          `Content ${i}-${j}`
        );
      }
    }

    const start = Date.now();
    const result = await invoke('diff_folders', {
      path_a: largeDir,
      path_b: largeDir,  // Same directory for identical result
    });
    const elapsed = Date.now() - start;

    expect(result).toBeDefined();
    expect(elapsed).toBeLessThan(5000); // Should complete within 5 seconds
  });
});
