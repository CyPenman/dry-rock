// Pulls emailed reports (spec §8.1) back out of saved emails. Every report
// email carries one "DRYROCK-REPORT-V1 {...json...}" line (src/api/reports.ts);
// this finds each one in the given files - pasted email text, .eml files, or a
// Gmail Takeout .mbox - and writes them as one JSON array, oldest first,
// de-duplicated. Plain Node ESM, no dependencies.
//
//   npm run extract:reports -- inbox.mbox [more files...] > reports.json
import { readFileSync } from 'node:fs';

const MARKER = 'DRYROCK-REPORT-V1';

/** Undo quoted-printable (soft line breaks and =XX bytes), which mbox and .eml bodies often use. */
function decodeQuotedPrintable(text) {
  if (!/=\r?\n|=[0-9A-F]{2}/.test(text)) return text;
  const joined = text.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < joined.length; i++) {
    const hex = joined.slice(i + 1, i + 3);
    if (joined[i] === '=' && /^[0-9A-F]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(joined[i], 'utf8'));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

/** The balanced {...} starting at `start`, respecting strings. */
function jsonObjectAt(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

export function extractReports(rawText) {
  const text = decodeHtmlEntities(decodeQuotedPrintable(rawText));
  const reports = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(MARKER, from);
    if (at < 0) break;
    from = at + MARKER.length;
    const brace = text.indexOf('{', from);
    const json = brace >= 0 ? jsonObjectAt(text, brace) : null;
    if (!json) continue;
    try {
      reports.push(JSON.parse(json));
    } catch {
      console.error(`skipped an unreadable report near character ${at}`);
    }
  }
  return reports;
}

function reportKey(r) {
  return r.kind === 'observation' ? `observation:${r.observation?.id}` : `feedback:${r.sentAtSec}:${r.message}`;
}

function reportTime(r) {
  return r.kind === 'observation' ? r.observation?.observedAtSec ?? 0 : r.sentAtSec ?? 0;
}

if (process.argv[1]?.endsWith('extract-reports.mjs')) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: npm run extract:reports -- <file> [file...] > reports.json');
    process.exit(1);
  }
  const byKey = new Map();
  for (const file of files) for (const r of extractReports(readFileSync(file, 'utf8'))) byKey.set(reportKey(r), r);
  const all = [...byKey.values()].sort((a, b) => reportTime(a) - reportTime(b));
  console.error(`${all.length} reports (${all.filter((r) => r.kind === 'observation').length} observations)`);
  process.stdout.write(JSON.stringify(all, null, 2) + '\n');
}
