/**
 * Read-only report of every date-only value whose DISPLAYED day changes now
 * that the accounting screens render through `formatDateOnly`.
 *
 * THE BUG BEING FIXED. Date-only fields are stored as UTC midnight. The
 * General Ledger, the recurring-transactions list and several other pages
 * rendered them with `new Date(x).toLocaleDateString()`, which resolves in the
 * VIEWER's timezone — so for anyone west of GMT every one of them showed the
 * previous calendar day. That is why August rent, stored on 2026-08-01, read
 * "7/31/2026".
 *
 * WHY THIS REPORT EXISTS. Correcting the rendering necessarily moves some rows
 * FORWARD by a day on screen, because they were being displayed a day early all
 * along. Nothing in the database changes — but a client who has been reading
 * "the mortgage posts on the 15th" will now see the 16th, and deserves to be
 * told which day is actually stored rather than discovering it in a report.
 *
 * So: for each date-only field, this prints what the screen USED to say, what
 * it says now, and how many rows are affected. Anything genuinely on the wrong
 * day is then a deliberate, separate correction — this script never writes.
 *
 *   npx --yes tsx scripts/audit-date-display-shift.ts
 *   npx --yes tsx scripts/audit-date-display-shift.ts --tz=America/Toronto --limit=20
 */
import dns from "node:dns";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import mongoose, { Types } from "mongoose";
import { connectToDatabase } from "../lib/db/mongoose";

function loadEnvLocal() {
  try {
    const raw = readFileSync(resolvePath(".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[1] && process.env[m[1]] === undefined)
        process.env[m[1]] = m[2];
    }
  } catch {
    /* optional */
  }
}

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith("--" + name + "="));
  return hit ? hit.slice(name.length + 3) : null;
}

/** The client is in Montreal; that is the timezone whose reading changed. */
const TZ = arg("tz") ?? "America/Toronto";
const LIMIT = Number(arg("limit") ?? "8");
const ORG_ID = arg("org");

/** What the OLD code showed: the calendar day of this instant in `TZ`. */
function dayInZone(d: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD, which sorts and compares cleanly.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** What the NEW code shows: the stored calendar day, timezone-independent. */
function storedDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface FieldSpec {
  collection: string;
  /** Dotted path to a Date. */
  field: string;
  /** Field to show alongside, for recognising the row. */
  label: string;
  note?: string;
}

const FIELDS: FieldSpec[] = [
  {
    collection: "pm_journal_entries",
    field: "date",
    label: "memo",
    note: "General ledger",
  },
  {
    collection: "pm_bills",
    field: "invoiceDate",
    label: "memo",
    note: "Bills / expenses",
  },
  {
    collection: "pm_recurring_transactions",
    field: "nextDate",
    label: "memo",
    note: "Recurring transactions — next date",
  },
  { collection: "pm_bill_payments", field: "paymentDate", label: "refNo" },
  { collection: "pm_leases", field: "startDate", label: "leaseNumber" },
  { collection: "pm_leases", field: "endDate", label: "leaseNumber" },
  {
    collection: "pm_leases",
    field: "primaryRent.nextDueDate",
    label: "leaseNumber",
    note: "Rent cursor — drives which month posts",
  },
  { collection: "pm_deposits", field: "date", label: "memo" },
  { collection: "pm_recurring_tasks", field: "nextDate", label: "title" },
];

function get(doc: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, k) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[k]
          : undefined,
      doc,
    );
}

async function main() {
  loadEnvLocal();
  const servers = process.env.MONGODB_DNS_SERVERS;
  if (servers) dns.setServers(servers.split(",").map((s) => s.trim()));
  await connectToDatabase();
  const db = mongoose.connection.db;
  if (!db) throw new Error("No database connection.");

  console.log("READ-ONLY — this script never writes.");
  console.log("Viewer timezone assumed: " + TZ);
  console.log("Org: " + (ORG_ID ?? "all organizations"));
  console.log(
    '\n"Was" = what the screen showed before the fix. ' +
      '"Now" = the day actually stored.\n',
  );

  const orgFilter = ORG_ID
    ? { organizationId: new Types.ObjectId(ORG_ID) }
    : {};

  let grandShifted = 0;
  let grandTotal = 0;

  for (const spec of FIELDS) {
    const docs = await db
      .collection(spec.collection)
      .find({ ...orgFilter, [spec.field]: { $type: "date" } })
      .project({ [spec.field]: 1, [spec.label]: 1 })
      .toArray();
    if (docs.length === 0) continue;

    const shifted: Array<{ was: string; now: string; label: string }> = [];
    for (const doc of docs) {
      const value = get(doc as Record<string, unknown>, spec.field);
      if (!(value instanceof Date)) continue;
      const was = dayInZone(value, TZ);
      const now = storedDay(value);
      if (was !== now) {
        shifted.push({
          was,
          now,
          label: String(
            get(doc as Record<string, unknown>, spec.label) ?? doc._id,
          ),
        });
      }
    }

    grandTotal += docs.length;
    grandShifted += shifted.length;

    const header =
      spec.collection +
      "." +
      spec.field +
      (spec.note ? "  (" + spec.note + ")" : "");
    console.log(header);
    console.log(
      "  " +
        shifted.length +
        " of " +
        docs.length +
        " rows now read one day later.",
    );
    for (const s of shifted.slice(0, LIMIT)) {
      console.log(
        "    was " +
          s.was +
          "  ->  now " +
          s.now +
          "   " +
          s.label.slice(0, 52),
      );
    }
    if (shifted.length > LIMIT) {
      console.log("    … and " + (shifted.length - LIMIT) + " more");
    }
    console.log();
  }

  console.log("-".repeat(64));
  console.log(
    grandShifted +
      " of " +
      grandTotal +
      " date values display differently after the fix.",
  );
  console.log(
    "No data was changed. A row whose stored day is genuinely wrong needs a\n" +
      "deliberate correction — decide those case by case rather than in bulk.",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
