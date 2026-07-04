import { clipTelegramText, escapeHtml } from "./format.js";
import { clipRichMarkdown } from "../richFormat.js";
import { EMOJI_FILES, EMOJI_TREE, EMOJI_WARNING } from "./copyStyle.js";
import {
  formatNumberEmoji,
  formatTreeFolderItemLine,
  formatTreeFolderItemRichMarkdown,
  parseTreeFilePickNumber,
  stripLeadingDateFromTreeTitle,
  treeFilePickOutOfRangeHtml,
  treeListNumberPrefix,
} from "./treeFormat.js";

export {
  formatNumberEmoji,
  treeListNumberPrefix,
  formatTreeFolderItemLine,
  formatTreeFolderItemRichMarkdown,
  stripLeadingDateFromTreeTitle,
  parseTreeFilePickNumber,
  treeFilePickOutOfRangeHtml,
};

export const FILES_TREE_EMPTY =
  `${EMOJI_TREE} <b>Дерево записей</b>\n\n` +
  "Записей пока нет. Нажми 🔄 Синхронизировать.";

export function filesTreeRootHtml(root) {
  if (!root?.total) {
    return FILES_TREE_EMPTY;
  }
  const folderCount = (root.folders || []).length;
  const lines = [
    `${EMOJI_TREE} <b>Дерево записей</b>`,
    `Всего файлов: ${root.total}, папок: ${folderCount}.`,
    "",
  ];
  for (const f of root.folders || []) {
    const label = escapeHtml(f.folder || "");
    lines.push(`${EMOJI_FILES} <b>${label}</b> — ${f.count} записей`);
  }
  lines.push("", "Выбери папку, чтобы открыть список файлов.");
  return clipTelegramText(lines.join("\n"));
}

/**
 * @param {import("../vaultTree.js").SyncIndexTreeRoot} root
 * @returns {string}
 */
export function filesTreeRootRichMarkdown(root) {
  if (!root?.total) {
    return clipRichMarkdown(
      `# ${EMOJI_TREE} Дерево записей\n\nЗаписей пока нет. Нажми 🔄 Синхронизировать.`
    );
  }
  const folderCount = (root.folders || []).length;
  const rows = (root.folders || []).map(
    (f) => `- **${f.folder || ""}** — ${f.count} записей`
  );
  const md = [
    `# ${EMOJI_TREE} Дерево записей`,
    "",
    `Всего файлов: **${root.total}**, папок: **${folderCount}**.`,
    "",
    ...rows,
    "",
    "Выбери папку, чтобы открыть список файлов.",
  ].join("\n");
  return clipRichMarkdown(md);
}

export function filesTreeFolderHtml(folderPage) {
  const folderLabel = escapeHtml(folderPage?.folder || "");
  if (!folderPage?.exists) {
    return [
      `${EMOJI_FILES} <b>${folderLabel || "Папка"}</b>`,
      "",
      "В этой папке пока нет файлов.",
    ].join("\n");
  }
  const totalPages = Math.max(1, Number(folderPage.totalPages) || 1);
  const curPage = Math.min(
    Math.max(1, Number(folderPage.page) || 1),
    totalPages
  );
  const pageSize = Math.max(1, Number(folderPage.pageSize) || 30);
  const pageSuffix =
    totalPages > 1 ? ` — стр. ${curPage} из ${totalPages}` : "";

  const lines = [
    `${EMOJI_FILES} <b>${folderLabel}</b> (всего ${folderPage.total})${pageSuffix}`,
    "",
  ];

  let lineNum = 0;
  for (const item of folderPage.items || []) {
    lineNum += 1;
    const plain = formatTreeFolderItemLine({
      lineNum,
      date: item.date,
      title: item.title,
    });
    lines.push(escapeHtml(plain));
  }

  const startIdx = (curPage - 1) * pageSize;
  const shownTo = startIdx + (folderPage.items?.length || 0);
  const hidden = Math.max(0, folderPage.total - shownTo);
  if (hidden > 0) {
    const rangeFrom = startIdx + 1;
    lines.push(
      "",
      `… ещё ${hidden} (показано ${rangeFrom}–${shownTo} из ${folderPage.total})`
    );
  }

  const raw = lines.join("\n");
  const clipped = clipTelegramText(raw);
  if (clipped.endsWith("…") && clipped.length < raw.length) {
    return `${clipped}\n\n${EMOJI_WARNING} Список обрезан — листай страницы.`;
  }
  return clipped;
}

/**
 * @param {object} folderPage
 * @returns {string}
 */
export function filesTreeFolderRichMarkdown(folderPage) {
  const folderLabel = String(folderPage?.folder || "Папка");
  if (!folderPage?.exists) {
    return clipRichMarkdown(
      `# ${EMOJI_FILES} ${folderLabel}\n\nВ этой папке пока нет файлов.`
    );
  }
  const totalPages = Math.max(1, Number(folderPage.totalPages) || 1);
  const curPage = Math.min(
    Math.max(1, Number(folderPage.page) || 1),
    totalPages
  );
  const pageSize = Math.max(1, Number(folderPage.pageSize) || 30);
  const pageSuffix =
    totalPages > 1 ? ` — стр. ${curPage} из ${totalPages}` : "";

  const itemLines = [];
  let lineNum = 0;
  for (const item of folderPage.items || []) {
    lineNum += 1;
    itemLines.push(
      formatTreeFolderItemRichMarkdown({
        lineNum,
        date: item.date,
        title: item.title,
      })
    );
  }

  const startIdx = (curPage - 1) * pageSize;
  const shownTo = startIdx + (folderPage.items?.length || 0);
  const hidden = Math.max(0, folderPage.total - shownTo);

  const parts = [
    `# ${EMOJI_FILES} ${folderLabel}`,
    "",
    `Всего **${folderPage.total}**${pageSuffix}`,
    "",
    ...itemLines,
  ];
  if (hidden > 0) {
    const rangeFrom = startIdx + 1;
    parts.push(
      "",
      `… ещё ${hidden} (показано ${rangeFrom}–${shownTo} из ${folderPage.total})`
    );
  }

  let md = parts.join("\n");
  const clipped = clipRichMarkdown(md);
  if (clipped.endsWith("…") && clipped.length < md.length) {
    md = `${clipped}\n\n> ${EMOJI_WARNING} Список обрезан — листай страницы.`;
    return clipRichMarkdown(md);
  }
  return clipped;
}
