"use strict";

// Linear scans preserve the verifier's plain-text matching without catastrophic
// backtracking on pages containing thousands of unmatched '<' characters.
// Fold only ASCII: Unicode lowercasing can change string length and tag offsets.
const lowerASCII = input => input.replace(/[A-Z]/g, char => char.toLowerCase());
function stripTags(input) {
  const parts = []; let cursor = 0, scan = 0;
  while (true) {
    const open = input.indexOf("<", scan);
    if (open < 0) break;
    const close = input.indexOf(">", open + 1);
    if (close < 0) break;
    scan = close + 1;
    if (close === open + 1) continue;
    parts.push(input.slice(cursor, open), " "); cursor = close + 1;
  }
  parts.push(input.slice(cursor)); return parts.join("");
}

function withoutBody(input, tag) {
  const lower = lowerASCII(input), parts = [], opening = "<" + tag, closing = "</" + tag + ">";
  let cursor = 0, scan = 0;
  while (true) {
    const open = lower.indexOf(opening, scan);
    if (open < 0) break;
    scan = open + opening.length;
    if (/[a-z0-9_]/i.test(input[scan] || "")) continue;
    const end = input.indexOf(">", scan);
    if (end < 0) break;
    const close = lower.indexOf(closing, end + 1);
    if (close < 0) break;
    parts.push(input.slice(cursor, open), " "); cursor = close + closing.length; scan = cursor;
  }
  parts.push(input.slice(cursor)); return parts.join("");
}

function title(input) {
  const lower = lowerASCII(input), open = lower.indexOf("<title");
  if (open < 0) return "";
  const end = input.indexOf(">", open + 6);
  if (end < 0) return "";
  const close = lower.indexOf("</title>", end + 1);
  return close < 0 ? "" : stripTags(input.slice(end + 1, close)).trim();
}

function text(input) { return stripTags(withoutBody(withoutBody(input, "script"), "style")); }

module.exports = { title, text };
