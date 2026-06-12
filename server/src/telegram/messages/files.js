import {
  clipTelegramText,
  escapeHtml,
  formatBytes,
  formatDateTimeLocal,
} from "./format.js";
import { clipRichMarkdown } from "../richFormat.js";
import {
  formatNumberEmoji,
  formatTreeFolderItemLine,
  parseTreeFilePickNumber,
  stripLeadingDateFromTreeTitle,
  treeFilePickOutOfRangeHtml,
  treeListNumberPrefix,
} from "./treeFormat.js";

export {
  formatNumberEmoji,
  treeListNumberPrefix,
  formatTreeFolderItemLine,
  stripLeadingDateFromTreeTitle,
  parseTreeFilePickNumber,
  treeFilePickOutOfRangeHtml,
};

export const FILES_MENU_HEADER = "📁 <b>Файлы</b>\n\nВыбери, что показать:";
export const FILES_TREE_EMPTY =
  "🌳 <b>Дерево синка</b>\n\nПока пусто. Запусти синк через 🔄.";
export const FILES_STATS_EMPTY =
  "📊 <b>Сводка vault</b>\n\nПапка ещё не создана.";

export function filesMenuHtml() {
  return FILES_MENU_HEADER;
}

export function filesTreeRootHtml(root) {
  if (!root?.total) {
    return FILES_TREE_EMPTY;
  }
  const folderCount = (root.folders || []).length;
  const lines = [
    `🌳 <b>Дерево синка</b>`,
    `Всего файлов: ${root.total}, папок: ${folderCount}.`,
    "",
  ];
  for (const f of root.folders || []) {
    const label = escapeHtml(f.folder || "");
    lines.push(`📁 <b>${label}</b> — ${f.count} записей`);
  }
  lines.push("", "Выбери папку, чтобы открыть список файлов.");
  return clipTelegramText(lines.join("\n"));
}

export function filesTreeFolderHtml(folderPage) {
  const folderLabel = escapeHtml(folderPage?.folder || "");
  if (!folderPage?.exists) {
    return [
      `📁 <b>${folderLabel || "Папка"}</b>`,
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
    `📁 <b>${folderLabel}</b> (всего ${folderPage.total})${pageSuffix}`,
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

  return clipTelegramText(lines.join("\n"));
}

/**
 * @param {import("../vaultTree.js").SyncIndexTreeRoot} root
 * @returns {string}
 */
export function filesTreeRootRichMarkdown(root) {
  if (!root?.total) {
    return clipRichMarkdown(
      "# 🌳 Дерево синка\n\nПока пусто. Запусти синк через 🔄."
    );
  }
  const rows = (root.folders || []).map(
    (f) => `| ${f.folder || ""} | ${f.count} |`
  );
  const table = ["| Папка | Записей |", "| --- | --- |", ...rows].join("\n");
  return clipRichMarkdown(
    `# 🌳 Дерево синка\n\n**${root.total}** файлов в **${(root.folders || []).length}** папках.\n\n${table}\n\nВыбери папку, чтобы открыть список файлов.`
  );
}

/**
 * @param {object} folderPage
 * @returns {string}
 */
export function filesTreeFolderRichMarkdown(folderPage) {
  const folderLabel = folderPage?.folder || "Папка";
  if (!folderPage?.exists) {
    return clipRichMarkdown(
      `# 📁 ${folderLabel}\n\nВ этой папке пока нет файлов.`
    );
  }
  const totalPages = Math.max(1, Number(folderPage.totalPages) || 1);
  const curPage = Math.min(
    Math.max(1, Number(folderPage.page) || 1),
    totalPages
  );
  const pageSuffix =
    totalPages > 1 ? ` — стр. ${curPage} из ${totalPages}` : "";
  const lines = [`# 📁 ${folderLabel} (${folderPage.total})${pageSuffix}`, ""];
  let lineNum = 0;
  for (const item of folderPage.items || []) {
    lineNum += 1;
    const title = stripLeadingDateFromTreeTitle(item.date, item.title || "");
    const date = item.date ? ` _${item.date}_` : "";
    lines.push(`${lineNum}. **${title}**${date}`);
  }
  return clipRichMarkdown(lines.join("\n"));
}

export function filesStatsHtml(stats) {
  if (!stats?.exists) {
    return FILES_STATS_EMPTY;
  }

  const lines = [
    "📊 <b>Сводка vault</b>",
    "",
    `📂 Корень: ${escapeHtml(stats.subfolder)}/`,
    `📄 Файлов .md: ${stats.totalCount ?? 0}`,
    `💾 Суммарный размер: ${formatBytes(stats.totalBytes ?? 0)}`,
  ];

  if (stats.lastMtime) {
    lines.push(
      `🕘 Последнее изменение: ${escapeHtml(formatDateTimeLocal(stats.lastMtime))}`
    );
  }

  if (stats.scanTruncated) {
    lines.push("", "⚠️ Сканирование обрезано по лимиту файлов.");
  }

  const recent = stats.recent || [];
  if (recent.length > 0) {
    lines.push("", "Последние 10:");
    for (const file of recent) {
      const name = escapeHtml(file.relativePath);
      const size = formatBytes(file.size);
      lines.push(`  • ${name} (${size})`);
    }
  } else if (stats.totalCount === 0) {
    lines.push("", "Файлов .md пока нет.");
  }

  return clipTelegramText(lines.join("\n"));
}

/**
 * @param {object} stats
 * @returns {string}
 */
export function filesStatsRichMarkdown(stats) {
  if (!stats?.exists) {
    return clipRichMarkdown("# 📊 Сводка vault\n\nПапка ещё не создана.");
  }
  const rows = [
    "| | |",
    "| --- | --- |",
    `| Файлов .md | ${stats.totalCount ?? 0} |`,
    `| Размер | ${formatBytes(stats.totalBytes ?? 0)} |`,
  ];
  if (stats.lastMtime) {
    rows.push(
      `| Последнее изменение | ${formatDateTimeLocal(stats.lastMtime)} |`
    );
  }
  let md = `# 📊 Сводка vault\n\n**${stats.subfolder}/**\n\n${rows.join("\n")}`;
  if (stats.scanTruncated) {
    md += "\n\n> ⚠️ Сканирование обрезано по лимиту файлов.";
  }
  const recent = stats.recent || [];
  if (recent.length > 0) {
    const recentRows = recent.map(
      (file) => `| ${file.relativePath} | ${formatBytes(file.size)} |`
    );
    md += `\n\n<details open>\n<summary>Последние ${recent.length}</summary>\n\n| Файл | Размер |\n| --- | --- |\n${recentRows.join("\n")}\n\n</details>`;
  } else if (stats.totalCount === 0) {
    md += "\n\nФайлов .md пока нет.";
  }
  return clipRichMarkdown(md);
}
