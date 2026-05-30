export function treeListNumberPrefix(n) {
  const i = Math.floor(Number(n) || 0);
  if (i < 1) return "";
  return `${formatNumberEmoji(i)} -`;
}

export function stripLeadingDateFromTreeTitle(date, title) {
  const d = String(date || "").trim();
  let t = String(title || "").trim();
  if (!d || !t) return t;
  if (t === d) return "";

  const stripPrefix = (prefix) => {
    if (t.startsWith(prefix)) t = t.slice(prefix.length).trim();
  };

  stripPrefix(`${d} | `);
  stripPrefix(`${d}|`);
  stripPrefix(`${d} — `);
  stripPrefix(`${d} - `);
  stripPrefix(`${d}—`);
  stripPrefix(`${d}-`);

  return t;
}

export function formatTreeFolderItemLine({ lineNum, date, title }) {
  const prefix = treeListNumberPrefix(lineNum);
  const datePart = String(date || "").trim() || "—";
  const label = stripLeadingDateFromTreeTitle(datePart, title);
  if (!label) return `${prefix} ${datePart}`;
  return `${prefix} ${datePart} | ${label}`;
}

export function parseTreeFilePickNumber(text) {
  const s = String(text || "");
  const m = /^(\d+)$/.exec(s);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

export function treeFilePickOutOfRangeHtml(pick, shown) {
  return `🌳 Нет файла №${formatNumberEmoji(pick)} на этой странице (показано ${shown}).`;
}

const DIGIT_EMOJI = [
  "0\uFE0F\u20E3",
  "1\uFE0F\u20E3",
  "2\uFE0F\u20E3",
  "3\uFE0F\u20E3",
  "4\uFE0F\u20E3",
  "5\uFE0F\u20E3",
  "6\uFE0F\u20E3",
  "7\uFE0F\u20E3",
  "8\uFE0F\u20E3",
  "9\uFE0F\u20E3",
];

export function formatNumberEmoji(n) {
  const i = Math.floor(Number(n));
  if (!Number.isFinite(i) || i < 0) return "";
  return String(i)
    .split("")
    .map((d) => DIGIT_EMOJI[Number(d)] ?? d)
    .join("");
}
