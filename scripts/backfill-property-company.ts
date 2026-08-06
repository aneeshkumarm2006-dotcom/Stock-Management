/**
 * Assign each Property to the CompanyAccount that owns it.
 *
 * Background
 * ----------
 * `Property.companyAccountId` is the link that makes "all the buildings this
 * company owns" answerable. It drives Group-by-Company on the properties list
 * and, more importantly, decides which buildings a company-wide cost (a blanket
 * insurance premium) is split across. Without it, a company-scoped amount has
 * nowhere to go but the company's own books.
 *
 * !! NO HEURISTIC BY DEFAULT !!
 * -----------------------------
 * Property names encode the intended grouping (`IMMEUBLES GREENE …`,
 * `RAMCO DEV …`), which makes prefix-matching tempting. It is not offered
 * unless you explicitly ask for `--propose-from-name`, and even then every
 * proposal is annotated as INFERRED and must be confirmed. Deriving a data
 * relationship from a display string is precisely the shape of the earlier
 * incident where a partial address PATCH silently wiped every property's
 * country. Assign them one at a time, or use the "Assign buildings" panel in
 * Settings → Companies, which is the same operation with the client's eyes on
 * it.
 *
 * Currency
 * --------
 * A company-wide cost can only be split across buildings that book in the SAME
 * currency — the ledger never converts on write. So this refuses to put a
 * property into a company whose resolved currency differs, unless you pass
 * --force. Getting this wrong doesn't corrupt anything, it just means the
 * property is silently excluded from every split, which is worse: it looks like
 * it worked.
 *
 * Safety
 * ------
 * - Preview by default. Pass --apply to write.
 * - Never overwrites an existing assignment (pass --overwrite to force).
 * - Idempotent: a second run finds nothing to do.
 * - Fully reversible: the field is new, so `$unset` restores the prior state.
 * - Every change is written to the activity log.
 *
 * Usage (run from `site/`):
 *   npx --yes tsx scripts/backfill-property-company.ts --scan
 *   npx --yes tsx scripts/backfill-property-company.ts --id=<propId> --company=<companyId>
 *   npx --yes tsx scripts/backfill-property-company.ts --id=<propId> --company=<companyId> --apply
 *   npx --yes tsx scripts/backfill-property-company.ts --scan --propose-from-name
 */
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose, { Types } from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import { Property } from '../lib/db/models/pm/Property';
import { CompanyAccount } from '../lib/db/models/pm/CompanyAccount';
import { Organization } from '../lib/db/models/pm/Organization';
import { ActivityLogEntry } from '../lib/db/models/pm/ActivityLogEntry';
import {
  resolveCompanyCurrency,
  resolvePropertyCurrency,
} from '../lib/pm/currency';
import type { PmCurrency } from '../types/pm';

function loadEnvLocal() {
  try {
    for (const line of readFileSync(resolve('.env.local'), 'utf8').split(
      /\r?\n/,
    )) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[1] && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2];
      }
    }
  } catch {
    // .env.local optional when running in CI
  }
}

function argValue(flag: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : undefined;
}

interface PropLite {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  propertyName?: string;
  currency?: PmCurrency | null;
  companyAccountId?: Types.ObjectId | null;
  active?: boolean;
  address?: { country?: string };
}

interface CompanyLite {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name?: string;
  currency?: PmCurrency | null;
  active?: boolean;
}

async function stamp(
  p: PropLite,
  company: CompanyLite,
  apply: boolean,
): Promise<void> {
  console.log(
    `  → ${p.propertyName ?? '(unnamed)'}  ⇒  ${company.name ?? '(unnamed company)'}`,
  );
  if (!apply) return;
  await Property.updateOne(
    { _id: p._id, organizationId: p.organizationId },
    { $set: { companyAccountId: company._id } },
  );
  await ActivityLogEntry.create({
    organizationId: p.organizationId,
    parentType: 'Property',
    parentId: p._id,
    eventType: 'Backfill — property company assigned',
    actorUserId: null,
    payload: {
      from: p.companyAccountId ? String(p.companyAccountId) : null,
      to: String(company._id),
    },
  });
}

async function main() {
  loadEnvLocal();
  const apply = process.argv.includes('--apply');
  const doScan = process.argv.includes('--scan');
  const overwrite = process.argv.includes('--overwrite');
  const force = process.argv.includes('--force');
  const proposeFromName = process.argv.includes('--propose-from-name');
  const idArg = argValue('--id');
  const companyArg = argValue('--company');

  if (process.env.MONGODB_DNS_SERVERS) {
    dns.setServers(
      process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()),
    );
  }

  await connectToDatabase();
  console.log(
    `✓ connected${apply ? '' : ' (preview — pass --apply to write)'}`,
  );

  const [props, companies, orgs] = await Promise.all([
    Property.find({}).sort({ propertyName: 1 }).lean<PropLite[]>(),
    CompanyAccount.find({}).sort({ name: 1 }).lean<CompanyLite[]>(),
    Organization.find({})
      .select({ _id: 1, defaultCurrency: 1 })
      .lean<Array<{ _id: Types.ObjectId; defaultCurrency?: PmCurrency }>>(),
  ]);

  const orgCurrency = new Map(
    orgs.map((o) => [String(o._id), o.defaultCurrency ?? null]),
  );
  const companyById = new Map(companies.map((c) => [String(c._id), c]));

  const propCurrency = (p: PropLite): PmCurrency =>
    resolvePropertyCurrency(
      p.currency,
      orgCurrency.get(String(p.organizationId)) ?? null,
    );
  const compCurrency = (c: CompanyLite): PmCurrency =>
    resolveCompanyCurrency(
      c.currency,
      orgCurrency.get(String(c.organizationId)) ?? null,
    );

  if (doScan || (!idArg && !apply)) {
    console.log('\n=== Companies ===');
    for (const c of companies) {
      const owned = props.filter(
        (p) => String(p.companyAccountId ?? '') === String(c._id),
      );
      console.log(
        `  ${String(c._id)}  ${c.name ?? '(unnamed)'}  [${compCurrency(c)}]  ${owned.length} building(s)${c.active === false ? '  (inactive)' : ''}`,
      );
    }

    console.log('\n=== Properties ===');
    for (const p of props) {
      const current = p.companyAccountId
        ? (companyById.get(String(p.companyAccountId))?.name ??
          '(unknown company)')
        : '—';
      let note = '';
      if (proposeFromName) {
        // Offered only on request, and never trusted. The prefix is a display
        // convention, not a foreign key.
        const name = (p.propertyName ?? '').toUpperCase();
        const guess = companies.find((c) =>
          name.startsWith((c.name ?? '').toUpperCase().slice(0, 8)),
        );
        if (guess) {
          note = `   ⚠ INFERRED — confirm with client: ${guess.name}`;
        }
      }
      console.log(
        `  ${String(p._id)}  ${p.propertyName ?? '(unnamed)'}  [${propCurrency(p)}]  country=${p.address?.country ?? '?'}  currently: ${current}${p.active === false ? '  (archived)' : ''}${note}`,
      );
    }
    console.log(
      '\nAssign with:  --id=<propId> --company=<companyId> --apply',
    );
    await mongoose.disconnect();
    return;
  }

  if (!idArg || !companyArg) {
    throw new Error(
      'Assigning requires BOTH --id=<propertyId> and --company=<companyId>. Run --scan to list them.',
    );
  }
  if (!Types.ObjectId.isValid(idArg)) {
    throw new Error(`--id is not a valid ObjectId: ${idArg}`);
  }
  if (!Types.ObjectId.isValid(companyArg)) {
    throw new Error(`--company is not a valid ObjectId: ${companyArg}`);
  }

  const p = props.find((x) => String(x._id) === idArg);
  if (!p) throw new Error(`No property found with _id ${idArg}.`);
  const company = companyById.get(companyArg);
  if (!company) throw new Error(`No company found with _id ${companyArg}.`);

  if (String(p.organizationId) !== String(company.organizationId)) {
    throw new Error(
      'Property and company belong to different organizations — refusing.',
    );
  }

  if (p.companyAccountId && !overwrite) {
    const currentName =
      companyById.get(String(p.companyAccountId))?.name ?? '(unknown)';
    console.log(
      `Already assigned to ${currentName}. Pass --overwrite to reassign.`,
    );
    await mongoose.disconnect();
    return;
  }

  const pc = propCurrency(p);
  const cc = compCurrency(company);
  if (pc !== cc && !force) {
    console.log(
      `‼ Currency mismatch: property books ${pc}, company books ${cc}.\n` +
        '  A company-wide cost is never converted, so this building would be\n' +
        '  silently excluded from every split — which looks like it worked.\n' +
        '  Give the building its own company, or pass --force if you are sure.',
    );
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  await stamp(p, company, apply);
  console.log(
    apply
      ? `\n✓ Done. ${p.propertyName ?? 'Property'} now belongs to ${company.name}.`
      : `\nWould assign. Re-run with --apply to write.`,
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('backfill-property-company failed:', err);
  process.exitCode = 1;
});
