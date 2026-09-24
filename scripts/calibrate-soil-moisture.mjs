// One-off soil-moisture climatology (spec §3.5). Fetches two full years of
// hourly deep soil moisture per forecast cell from Open-Meteo's Historical
// Forecast API, for the two models that publish it, and writes the 5th and 95th
// percentiles to src/data/soilMoistureCalibration.ts. Plain Node ESM, no
// dependencies. Run with `npm run calibrate:soil`; `--parse-only` stops after
// reading the crag list.
//
// Pacing: a two-year hourly request is billed as roughly 50 calls (Open-Meteo
// counts every two weeks of data as one call), and the free tier allows 600 a
// minute, so requests are spaced 6 seconds apart rather than back to back.
import { readFileSync, writeFileSync } from 'node:fs';

const CRAGS_FILE = 'src/data/crags.ts';
const OUT_FILE = 'src/data/soilMoistureCalibration.ts';
const MODELS = {
  ecmwf_ifs025: 'soil_moisture_28_to_100cm',
  icon_seamless: 'soil_moisture_27_to_81cm',
};
const MIN_DAYS = 300;
const SLEEP_MS = 6000;
const RETRY_AFTER_429_MS = 60000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- 1. Crags ---------------------------------------------------------------

function parseCrags(source) {
  const seedsStart = source.indexOf('const SEEDS');
  const seedsEnd = source.indexOf('export const CRAGS');
  const seeds = source.slice(seedsStart, seedsEnd);
  const idCount = (seeds.match(/^ {4}id: '/gm) ?? []).length;
  const blocks = seeds.split(/^ {4}id: '/m).slice(1);
  const crags = blocks.map((block) => {
    const id = block.slice(0, block.indexOf("'"));
    const num = (field) => {
      const m = block.match(new RegExp(`^ {4}${field}: (-?[0-9.]+),`, 'm'));
      return m ? Number(m[1]) : NaN;
    };
    return { id, lat: num('lat'), lon: num('lon'), elevationM: num('elevationM') };
  });
  return { crags, idCount };
}

const { crags, idCount } = parseCrags(readFileSync(CRAGS_FILE, 'utf8'));
console.log(`Parsed ${crags.length} crags (${idCount} ids in SEEDS):`);
for (const c of crags) console.log(`  ${c.id.padEnd(28)} ${c.lat}, ${c.lon}, ${c.elevationM}m`);
const broken = crags.filter((c) => !c.id || [c.lat, c.lon, c.elevationM].some(Number.isNaN));
if (crags.length !== idCount || broken.length > 0) {
  console.error(`Parse check failed: ${broken.map((c) => c.id).join(', ') || 'count mismatch'}`);
  process.exit(1);
}
if (process.argv.includes('--parse-only')) process.exit(0);

// --- 2. Cells (same rule as src/api/dedupe.ts) --------------------------------

const round3 = (n) => Math.round(n * 1000) / 1000;
const cells = new Map();
for (const c of crags) {
  const lat = round3(c.lat);
  const lon = round3(c.lon);
  const key = `${lat},${lon}`;
  if (!cells.has(key)) cells.set(key, { key, lat, lon, elevationM: c.elevationM, cragIds: [] });
  cells.get(key).cragIds.push(c.id);
}
console.log(`\n${cells.size} unique cells`);

// --- 3. Requests -----------------------------------------------------------------

const thisYear = new Date().getFullYear();
const startDate = `${thisYear - 2}-01-01`;
const endDate = `${thisYear - 1}-12-31`;

function url(cell, model) {
  const params = new URLSearchParams({
    latitude: String(cell.lat),
    longitude: String(cell.lon),
    elevation: String(cell.elevationM),
    start_date: startDate,
    end_date: endDate,
    hourly: MODELS[model],
    models: model,
    timezone: 'Europe/London',
  });
  return `https://historical-forecast-api.open-meteo.com/v1/forecast?${params}`;
}

/** Non-null hourly values for one cell and model, or null if the request failed. */
async function fetchValues(cell, model) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url(cell, model));
    if (res.status === 429 && attempt === 0) {
      console.warn(`  429 for ${cell.key} ${model} - waiting 60s and retrying once`);
      await sleep(RETRY_AFTER_429_MS);
      continue;
    }
    if (!res.ok) {
      console.warn(`  HTTP ${res.status} for ${cell.key} ${model} - skipping`);
      return null;
    }
    const body = await res.json();
    const raw = body.hourly?.[MODELS[model]] ?? [];
    return raw.filter((v) => v != null);
  }
  return null;
}

function percentile(sorted, p) {
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const cellList = [...cells.values()];
const results = new Map(); // cell key -> { model -> { p5, p95 } }
const probeValues = new Map(); // model -> values for the first cell, reused in the full run

console.log(`\nTest request for ${cellList[0].key} (${cellList[0].cragIds.join(', ')}), ${startDate} to ${endDate}:`);
const models = [];
for (const model of Object.keys(MODELS)) {
  const values = await fetchValues(cellList[0], model);
  const days = values ? values.length / 24 : 0;
  console.log(`  ${model}: ${values ? values.length : 'request failed'} non-null hourly values (${days.toFixed(0)} days)`);
  if (days < MIN_DAYS) {
    console.log(`  -> skipping ${model} in the full run: under ${MIN_DAYS} days of archive`);
  } else {
    models.push(model);
    probeValues.set(model, values);
  }
  await sleep(SLEEP_MS);
}
if (models.length === 0) {
  console.error('No model has a usable archive - nothing to write.');
  process.exit(1);
}

for (const [i, cell] of cellList.entries()) {
  for (const model of models) {
    let values;
    if (i === 0) {
      values = probeValues.get(model);
    } else {
      values = await fetchValues(cell, model);
      await sleep(SLEEP_MS);
    }
    if (!values || values.length === 0) continue;
    const sorted = [...values].sort((a, b) => a - b);
    if (!results.has(cell.key)) results.set(cell.key, {});
    results.get(cell.key)[model] = { p5: percentile(sorted, 0.05), p95: percentile(sorted, 0.95) };
  }
  console.log(`  [${i + 1}/${cellList.length}] ${cell.key} done`);
}

// --- 4. Output -------------------------------------------------------------------

const r4 = (n) => Math.round(n * 10000) / 10000;
const byCrag = {};
const rows = [];
const narrow = [];
for (const cell of cellList) {
  const perModel = results.get(cell.key);
  if (!perModel) continue;
  for (const id of cell.cragIds) {
    byCrag[id] = {};
    for (const [model, { p5, p95 }] of Object.entries(perModel)) {
      byCrag[id][model] = { p5: r4(p5), p95: r4(p95) };
      rows.push([id, model, p5, p95]);
      if (p95 - p5 < 0.02) narrow.push(`${id} ${model}`);
    }
  }
}

const today = new Date().toISOString().slice(0, 10);
const body = Object.entries(byCrag)
  .map(([id, perModel]) => {
    const inner = Object.entries(perModel)
      .map(([model, { p5, p95 }]) => `${model}: { p5: ${p5}, p95: ${p95} }`)
      .join(', ');
    return `  '${id}': { ${inner} },`;
  })
  .join('\n');

writeFileSync(
  OUT_FILE,
  `// GENERATED by scripts/calibrate-soil-moisture.mjs on ${today} from Open-Meteo's
// Historical Forecast API, ${startDate}-${endDate}. Do not edit by hand - re-run the script.
import type { SoilMoistureCalibration } from '../model/seepage';

export const SOIL_MOISTURE_CALIBRATION: Record<string, Partial<Record<'ecmwf_ifs025' | 'icon_seamless', SoilMoistureCalibration>>> = {
${body}
};
`,
);

console.log(`\nWrote ${OUT_FILE}\n`);
console.log('crag                          model          p5      p95');
for (const [id, model, p5, p95] of rows) {
  console.log(`${id.padEnd(30)}${model.padEnd(15)}${p5.toFixed(4)}  ${p95.toFixed(4)}`);
}
const missing = crags.filter((c) => !byCrag[c.id]).map((c) => c.id);
if (missing.length > 0) console.warn(`\nNo calibration for: ${missing.join(', ')} (the app falls back to the default)`);
if (narrow.length > 0) {
  console.warn(`\nWarning - p95 minus p5 under 0.02 for: ${narrow.join(', ')}`);
  console.warn('The app ignores these and uses the default range (soilMoistureCalibrationFor in dayAggregate.ts).');
}
