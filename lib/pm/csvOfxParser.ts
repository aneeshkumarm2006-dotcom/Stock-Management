// CSV + OFX bank-feed parser (DECISIONS.md [G-S-33]). Phase 9 ships a
// minimal in-process parser — no third-party dep — that covers:
//   - CSV: caller hands us a column-name mapping
//     { date, description, amount } pointing at the CSV header labels.
//     Amounts are parsed as decimals (negative = debit) and rounded to
//     cents.
//   - OFX 2.x: regex pulls `<STMTTRN>...</STMTTRN>` blocks. We extract
//     DTPOSTED, NAME / MEMO (preferring NAME), TRNAMT, and FITID.
//
// Both parsers return the same row shape; the API route inserts them
// into BankFeedTransaction with `status='Unmatched'`.

export interface ParsedBankFeedRow {
  txnDate: Date;
  description: string;
  amountCents: number;
  externalRef?: string | null;
}

export interface CsvColumnMapping {
  date: string;
  description: string;
  amount: string;
  /** Optional column carrying a stable external ref (e.g. FITID). */
  externalRef?: string;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === ',') {
        out.push(cur);
        cur = '';
      } else if (ch === '"') {
        inQuote = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

function toCentsSigned(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[$,\s]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function parseCsvDate(raw: string): Date | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  // Try ISO first.
  const iso = new Date(trimmed);
  if (!Number.isNaN(iso.getTime())) return iso;
  // MM/DD/YYYY fallback.
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return new Date(Date.UTC(year, month - 1, day));
  }
  return null;
}

/** Parse a CSV string against the supplied column mapping. Drops rows
 *  with missing/unparseable date or amount. */
export function parseCsv(
  text: string,
  mapping: CsvColumnMapping,
): ParsedBankFeedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]!);
  const idxOf = (label: string) =>
    header.findIndex(
      (h) => h.trim().toLowerCase() === label.trim().toLowerCase(),
    );

  const dateIdx = idxOf(mapping.date);
  const descIdx = idxOf(mapping.description);
  const amtIdx = idxOf(mapping.amount);
  const refIdx = mapping.externalRef ? idxOf(mapping.externalRef) : -1;
  if (dateIdx < 0 || descIdx < 0 || amtIdx < 0) {
    throw new Error(
      `CSV header missing required columns. Expected: ${mapping.date}, ${mapping.description}, ${mapping.amount}.`,
    );
  }

  const out: ParsedBankFeedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]!);
    const date = parseCsvDate(cols[dateIdx] ?? '');
    if (!date) continue;
    const amountCents = toCentsSigned(cols[amtIdx] ?? '0');
    if (amountCents === 0) continue;
    const description = (cols[descIdx] ?? '').trim();
    if (!description) continue;
    out.push({
      txnDate: date,
      description,
      amountCents,
      externalRef:
        refIdx >= 0 && cols[refIdx]?.trim()
          ? cols[refIdx]!.trim()
          : null,
    });
  }
  return out;
}

function ofxField(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<\r\n]*)`, 'i');
  const m = block.match(re);
  return m ? (m[1] ?? '').trim() : null;
}

function parseOfxDate(raw: string | null): Date | null {
  if (!raw) return null;
  // OFX dates: YYYYMMDD[HHMMSS][.MMM][offset]. We accept just the date prefix.
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  return new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
  );
}

/** Parse an OFX 2.x statement. Pulls every <STMTTRN>…</STMTTRN> block;
 *  ignores everything else. Returns rows in document order. */
export function parseOfx(text: string): ParsedBankFeedRow[] {
  const out: ParsedBankFeedRow[] = [];
  const re = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const block = m[1] ?? '';
    const txnDate = parseOfxDate(ofxField(block, 'DTPOSTED'));
    const amount = Number(ofxField(block, 'TRNAMT') ?? '');
    const fitId = ofxField(block, 'FITID');
    const name = ofxField(block, 'NAME');
    const memo = ofxField(block, 'MEMO');
    const description = (name || memo || '').trim();
    if (!txnDate || !Number.isFinite(amount) || !description) continue;
    out.push({
      txnDate,
      description,
      amountCents: Math.round(amount * 100),
      externalRef: fitId || null,
    });
  }
  return out;
}
