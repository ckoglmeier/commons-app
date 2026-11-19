import { Worker } from "node:worker_threads";
// Keep the external parser in Next's deployment trace. The worker loads it
// through Node rather than a bundler-transformed require.resolve module ID.
import "xlsx";
import { inflateRawSync } from "node:zlib";

export const SOURCE_FILE_BYTES = 1024 * 1024, SOURCE_TEXT_CHARS = 30000;
export class SourceReadError extends Error {}
/** Preflight before decompression: bound archive entries and expansion. */
export function validateWorkbookArchive(data: Uint8Array) {
  const buffer = Buffer.from(data);
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new SourceReadError("That Excel file is unreadable or encrypted. Upload an unencrypted .xlsx workbook.");
  const count = buffer.readUInt16LE(end + 10), offset = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || !count || count > 512) throw new SourceReadError("Use a workbook with fewer archive entries.");
  let cursor = offset, expanded = 0;
  const entries = new Set<string>(), ranges: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new SourceReadError("That Excel archive is damaged.");
    const flags = buffer.readUInt16LE(cursor + 8), compressed = buffer.readUInt32LE(cursor + 20), size = buffer.readUInt32LE(cursor + 24);
    const method = buffer.readUInt16LE(cursor + 10), local = buffer.readUInt32LE(cursor + 42);
    const nameLength = buffer.readUInt16LE(cursor + 28), extra = buffer.readUInt16LE(cursor + 30), comment = buffer.readUInt16LE(cursor + 32);
    if (cursor + 46 + nameLength + extra + comment > end) throw new SourceReadError("That Excel archive is damaged.");
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    expanded += size;
    if (flags & 65 || /(?:vbaProject|macros|\.bin$)/i.test(name)) throw new SourceReadError("Use an unencrypted .xlsx workbook without macros.");
    if (size > 2 * 1024 * 1024 || expanded > 4 * 1024 * 1024 || size > Math.max(100000, compressed * 100)) throw new SourceReadError("This workbook expands beyond the supported size. Export a smaller worksheet.");
    if (entries.has(name) || local + 30 > offset || buffer.readUInt32LE(local) !== 0x04034b50 || ![0, 8].includes(method) || buffer.readUInt16LE(local + 6) !== flags || buffer.readUInt16LE(local + 8) !== method) throw new SourceReadError("That Excel archive is damaged or unsupported.");
    entries.add(name);
    const localName = buffer.readUInt16LE(local + 26), start = local + 30 + localName + buffer.readUInt16LE(local + 28), stop = start + compressed;
    if (stop > offset || start > stop || buffer.subarray(local + 30, local + 30 + localName).toString("utf8") !== name || ranges.some(([a, b]) => local < b && stop > a)) throw new SourceReadError("That Excel archive is damaged.");
    ranges.push([local, stop]);
    if (!(flags & 8) && (buffer.readUInt32LE(local + 18) !== compressed || buffer.readUInt32LE(local + 22) !== size)) throw new SourceReadError("That Excel archive is damaged.");
    // Do not trust declared expansion sizes: bound actual inflation before SheetJS.
    try {
      const data = buffer.subarray(start, stop);
      const actual = method === 0 ? data.length : inflateRawSync(data, { maxOutputLength: 2 * 1024 * 1024 }).length;
      if (actual !== size) throw new Error("Size mismatch");
    } catch { throw new SourceReadError("That workbook is damaged or expands beyond the supported size. Export a smaller worksheet."); }
    cursor += 46 + nameLength + extra + comment;
  }
  if (!entries.has("[Content_Types].xml") || !entries.has("xl/workbook.xml")) throw new SourceReadError("Choose an .xlsx workbook, rather than another archive format.");
}

// Disposable worker: formulas and links are data; a hard deadline also stops synchronous parsing.
const workbookWorker = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
try {
  const XLSX = require('node:module').createRequire(workerData.base)('xlsx');
  const workbook = XLSX.read(Buffer.from(workerData.data), { type:'buffer', cellDates:false, cellNF:true, cellText:true, cellStyles:true, bookVBA:false });
  if (workbook.SheetNames.length > 12) throw Error('Use at most 12 worksheets.');
  const limitations = new Set(), blocks = []; let cells = 0;
  for (let i=0;i<workbook.SheetNames.length;i++) {
    const name = workbook.SheetNames[i], sheet = workbook.Sheets[name];
    if (workbook.Workbook?.Sheets?.[i]?.Hidden) { limitations.add('Hidden sheets, rows and columns were excluded.'); continue; }
    if (!sheet?.['!ref']) continue;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    if (range.e.r >= 300 || range.e.c >= 32) throw Error('Use at most 300 rows and 32 columns per worksheet. Export a smaller sheet.');
    const columns = [];
    for (let c=0;c<=range.e.c;c++) {
      if (sheet['!cols']?.[c]?.hidden) { limitations.add('Hidden sheets, rows and columns were excluded.'); continue; }
      columns.push(c);
    }
    const rows = ['Worksheet: '+JSON.stringify(name), 'Columns: '+columns.map(c=>XLSX.utils.encode_col(c)).join(' | ')];
    for (let r=0;r<=range.e.r;r++) {
      if (sheet['!rows']?.[r]?.hidden) { limitations.add('Hidden sheets, rows and columns were excluded.'); continue; }
      const values = columns.map(c => {
        if (++cells > 5000) throw Error('Use at most 5,000 visible cells. Export a smaller sheet.');
        const address = XLSX.utils.encode_cell({r,c}), cell = sheet[address];
        if (!cell) return address+'=""';
        if (cell.l) limitations.add('Workbook hyperlinks were not opened.');
        let value = '';
        if (cell.f) {
          limitations.add('Formulas were not run. Available cached values are used and may be stale; missing cached values stay unknown.');
          if (cell.v === undefined || cell.v === null || cell.t === 'z') return address+'="[formula value unavailable]"';
        }
        if (cell.t === 'e') value = '[cell error: '+String(cell.w ?? cell.v)+']';
        else if (cell.t === 'n' && XLSX.SSF.is_date(cell.z ?? '')) {
          const parsed = XLSX.SSF.parse_date_code(cell.v, {date1904: Boolean(workbook.Workbook?.WBProps?.date1904)});
          if (!parsed) throw Error('An Excel date or time could not be interpreted. Export it as text.');
          const timeOnly = /[hs]/i.test(cell.z ?? '') && !/[dy]/i.test(cell.z ?? '');
          const clock = (parsed.H%12 || 12)+':'+String(parsed.M).padStart(2,'0')+' '+(parsed.H>=12?'PM':'AM');
          const date = String(parsed.y).padStart(4,'0')+'-'+String(parsed.m).padStart(2,'0')+'-'+String(parsed.d).padStart(2,'0');
          value = timeOnly ? clock : date+( /[hs]/i.test(cell.z ?? '') ? ' '+clock : '');
          limitations.add('Spreadsheet dates/times retain workbook-local meaning; no timezone is inferred.');
        } else value = String(cell.w ?? cell.v ?? '');
        return address+'='+JSON.stringify(value);
      });
      rows.push('Row '+(r+1)+': '+values.join(' | '));
    }
    blocks.push(rows.join('\n'));
  }
  const text = blocks.join('\n\n');
  if (!text.trim()) throw Error('No readable visible worksheets were found.');
  if (text.length > 30000) throw Error('The extracted workbook exceeds 30,000 characters. Export a smaller worksheet; nothing was truncated.');
  parentPort.postMessage({text,limitations:[...limitations]});
} catch(error) { parentPort.postMessage({error:error.message}); }
`;
let activeParsers = 0;
export async function extractCoordinatorSource(file: File): Promise<{ text: string; limitations: string[] }> {
  if (!file.size || file.size > SOURCE_FILE_BYTES) throw new SourceReadError("Choose a nonempty file up to 1 MB.");
  if (!/\.(md|markdown|txt|xlsx)$/i.test(file.name)) throw new SourceReadError("Attach Markdown (.md), plain text (.txt), or Excel (.xlsx).");
  const data = new Uint8Array(await file.arrayBuffer());
  if (!/\.xlsx$/i.test(file.name)) {
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); } catch { throw new SourceReadError("Use a UTF-8 Markdown or text file."); }
    if (text.includes("\0") || !text.trim()) throw new SourceReadError("That file did not contain readable text.");
    if (text.length > SOURCE_TEXT_CHARS) throw new SourceReadError("Use up to 30,000 characters. Nothing was truncated; choose a smaller file.");
    return { text, limitations: ["Source text is unverified. Embedded instructions, HTML and links are not executed or opened."] };
  }
  validateWorkbookArchive(data);
  if (activeParsers >= 2) throw new SourceReadError("Other files are processing. Your message is unchanged; try again shortly.");
  activeParsers++;
  try { return await new Promise((resolve, reject) => {
    const worker = new Worker(workbookWorker, { eval: true, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 64 }, workerData: { data, base: process.cwd() + "/package.json" } });
    let settled = false;
    const finish = (error?: Error, result?: { text: string; limitations: string[] }) => { if (settled) return; settled = true; clearTimeout(timer); void worker.terminate(); if (error) reject(error); else resolve(result!); };
    const timer = setTimeout(() => finish(new SourceReadError("This workbook took too long to read. Export a smaller sheet.")), 3000);
    worker.once("message", result => result.error ? finish(new SourceReadError(/^(Use at most |No readable visible |An Excel date or time |The extracted workbook )/.test(result.error) ? result.error : "That workbook could not be read. Try a smaller unencrypted .xlsx file.")) : finish(undefined, result));
    worker.once("error", () => finish(new SourceReadError("That workbook could not be read. Try a smaller unencrypted .xlsx file.")));
    worker.once("exit", code => { if (code !== 0) finish(new SourceReadError("Workbook parsing stopped. Your message is unchanged.")); });
  }); } finally { activeParsers--; }
}
