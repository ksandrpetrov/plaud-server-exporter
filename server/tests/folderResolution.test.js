import assert from "node:assert/strict";
import test from "node:test";
import { buildFolderResolutionContext } from "../src/plaud/folderResolution.js";

const TAGS = [
  { id: "all", name: "All files", system_folder_type: "all" },
  { id: "unf", name: "Unfiled", is_unfiled: true },
  { id: "dev", name: "SocServ Dev" },
];

test("buildFolderResolutionContext keeps All files tag in default mode", () => {
  const ctx = buildFolderResolutionContext(TAGS);
  assert.equal(ctx.tagById.has("all"), true);
  assert.equal(ctx.tagById.has("dev"), true);
  assert.equal(ctx.unfiledIds.has("unf"), true);
  assert.equal(ctx.allFilesIds.has("all"), true);
});

test("buildFolderResolutionContext excludes All files meta tag when requested", () => {
  const ctx = buildFolderResolutionContext(TAGS, {
    excludeAllFilesMetaTags: true,
  });
  assert.equal(ctx.tagById.has("all"), false);
  assert.equal(ctx.tagById.has("dev"), true);
  assert.equal(ctx.unfiledIds.has("unf"), true);
  // Meta-tag ids stay in allFilesIds even when dropped from tagById.
  assert.equal(ctx.allFilesIds.has("all"), true);
});

test("buildFolderResolutionContext tolerates null tags", () => {
  const ctx = buildFolderResolutionContext(null);
  assert.equal(ctx.tagById.size, 0);
  assert.equal(ctx.unfiledIds.size, 0);
  assert.equal(ctx.allFilesIds.size, 0);
});
