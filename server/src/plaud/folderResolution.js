/**
 * Build the lookup context Plaud needs to resolve a recording's folder
 * segment: a tag-id → tag map, the set of "Unfiled" filetag ids, and the set
 * of "All files" meta-tag ids.
 *
 * Three call sites inlined the same three calls verbatim
 * (`recordingsApi.enrichFilesWithFolderSegments`, `recordingsApi.listAllRecordings`,
 * `liveTreeReadModel.loadPlaudLiveSyncTree`). The live tree drops the "All files"
 * meta tag from `tagById`/`unfiledIds` while still counting its ids in
 * `allFilesIds`, so the helper supports that via `excludeAllFilesMetaTags`.
 */
import {
  buildTagByIdMap,
  collectAllFilesFiletagIds,
  collectUnfiledFiletagIds,
  isAllFilesMetaTag,
} from "./plaudFolders.js";

/**
 * @typedef {{
 *   tagById: Map<string, object>;
 *   unfiledIds: Set<string>;
 *   allFilesIds: Set<string>;
 * }} FolderResolutionContext
 */

/**
 * @param {object[] | null | undefined} tags
 * @param {{ excludeAllFilesMetaTags?: boolean }} [options]
 * @returns {FolderResolutionContext}
 */
export function buildFolderResolutionContext(
  tags,
  { excludeAllFilesMetaTags = false } = {}
) {
  const list = Array.isArray(tags) ? tags : [];
  // allFilesIds is always derived from the unfiltered list so the meta-tag's
  // ids stay recognised even when its tag object is dropped from tagById.
  const allFilesIds = new Set(collectAllFilesFiletagIds(list));
  const relevant = excludeAllFilesMetaTags
    ? list.filter((tag) => !isAllFilesMetaTag(tag))
    : list;
  const tagById = buildTagByIdMap(relevant);
  const unfiledIds = new Set(collectUnfiledFiletagIds(relevant));
  return { tagById, unfiledIds, allFilesIds };
}
