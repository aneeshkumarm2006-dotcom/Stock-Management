/**
 * Stamp `Property.currency` from each property's country.
 *
 * Background
 * ----------
 * The PM ledger stores unit-less integer cents. Until `Property.currency`
 * existed there was no record of what currency an amount was denominated in —
 * everything was implicitly `Organization.defaultCurrency`. For an org running
 * buildings in both Canada and the United States that is wrong: a Montreal
 * building's rent is CAD, a Florida building's is USD, and totals that add them
 * together are meaningless.
 *
 * This script proposes `CA → CAD` / `US → USD` from `address.country`.
 *
 * !! READ THIS BEFORE --apply !!
 * -----------------------------
 * Setting a currency REINTERPRETS existing amounts — it does not convert them.
 * If the Florida property's rents were keyed in as CAD-equivalents rather than
 * real US dollars, stamping it USD will inflate every one of those figures by
 * the FX rate on screen. Only someone who knows how the books were kept can
 * answer that. So:
 *
 *   - Properties left unset keep behaving exactly as before (they inherit the
 *     org currency). Doing nothing is safe.
 *   - Run --scan first and confirm each property's real booking currency with
 *     the client before writing.
 *   - --only-country lets you stamp the unambiguous majority (e.g. the Canadian
 *     properties in a CAD-booking org, which is a no-op in value terms) and
 *     leave the questionable ones for a human.
 *
 * Safety
 * ------
 * - Preview by default. Pass --apply to write.
 * - Never overwrites a currency that is already set (pass --overwrite to force).
 * - Idempotent: a second run finds nothing to do.
 * - Every change is written to the activity log.
 *
 * Usage (run from `site/`):
 *   npx --yes tsx scripts/backfill-property-currency.ts --scan
 *   npx --yes tsx scripts/backfill-property-currency.ts                      # preview all
 *   npx --yes tsx scripts/backfill-property-currency.ts --only-country=CA    # preview Canadians
 *   npx --yes tsx scripts/backfill-property-currency.ts --only-country=CA --apply
 *   npx --yes tsx scripts/backfill-property-currency.ts --id=<propId> --currency=USD --apply
 */
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose, { Types } from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import { Property } from '../lib/db/models/pm/Property';
import { Organization } from '../lib/db/models/pm/Organization';
import { ActivityLogEntry } from '../lib/db/models/pm/ActivityLogEntry';
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

/** Normalize the free-text country field to the two codes we map from. */
function countryCode(raw: string | undefined | null): 'US' | 'CA' | null {
  const c = (raw ?? '').trim().toUpperCase();
  if (['US', 'USA', 'U.S.', 'U.S.A.', 'UNITED STATES'].includes(c)) return 'US';
  if (['CA', 'CAN', 'CANADA'].includes(c)) return 'CA';
  return null;
}

const CURRENCY_BY_CODE: Record<'US' | 'CA', PmCurrency> = {
  US: 'USD',
  CA: 'CAD',
};

interface PropLite {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  propertyName: string;
  currency?: PmCurrency | null;
  address?: { city?: string; state?: string; zip?: string; country?: string };
}

function describe(p: PropLite): string {
  const a = p.address ?? {};
  return `"${p.propertyName}" — country=${a.country ?? '(none)'}, state=${a.state ?? ''}, currency=${p.currency ?? '(unset)'}`;
}

async function stamp(
  p: PropLite,
  next: PmCurrency,
  apply: boolean,
): Promise<void> {
  console.log(`  → ${describe(p)}  ⇒  ${next}`);
  if (!apply) return;
  await Property.updateOne(
    { _id: p._id, organizationId: p.organizationId },
    { $set: { currency: next } },
  );
  await ActivityLogEntry.create({
    organizationId: p.organizationId,
    parentType: 'Property',
    parentId: p._id,
    eventType: 'Backfill — property currency set',
    actorUserId: null,
    payload: {
      from: p.currency ?? null,
      to: next,
      derivedFrom: p.address?.country ?? null,
    },
  });
}

async function main() {
  loadEnvLocal();
  const apply = process.argv.includes('--apply');
  const doScan = process.argv.includes('--scan');
  const overwrite = process.argv.includes('--overwrite');
  const idArg = argValue('--id');
  const currencyArg = argValue('--currency') as PmCurrency | undefined;
  const onlyCountry = argValue('--only-country')?.toUpperCase();

  if (currencyArg && currencyArg !== 'USD' && currencyArg !== 'CAD') {
    throw new Error(`--currency must be USD or CAD, got "${currencyArg}"`);
  }

  if (process.env.MONGODB_DNS_SERVERS) {
    dns.setServers(
      process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()),
    );
  }

  await connectToDatabase();
  console.log(
    `✓ connected${apply ? '' : ' (preview — pass --apply to write)'}`,
  );

  // Single-property mode: explicit currency, no heuristic.
  if (idArg) {
    if (!Types.ObjectId.isValid(idArg)) {
      throw new Error(`--id is not a valid ObjectId: ${idArg}`);
    }
    if (!currencyArg) {
      throw new Error('--id requires --currency=USD|CAD (no guessing here).');
    }
    const p = await Property.findById(idArg).lean<PropLite | null>();
    if (!p) throw new Error(`No property found with _id ${idArg}.`);
    await stamp(p, currencyArg, apply);
    console.log(
      apply
        ? `✓ currency set to ${currencyArg}.`
        : `Would set currency to ${currencyArg}. Re-run with --apply to write.`,
    );
    await mongoose.disconnect();
    return;
  }

  const all = await Property.find({}).lean<PropLite[]>();
  const orgs = await Organization.find({})
    .select({ _id: 1, defaultCurrency: 1 })
    .lean<Array<{ _id: Types.ObjectId; defaultCurrency?: PmCurrency }>>();
  const orgCurrency = new Map(
    orgs.map((o) => [String(o._id), o.defaultCurrency ?? 'USD']),
  );

  interface Candidate {
    p: PropLite;
    next: PmCurrency;
    code: 'US' | 'CA';
  }
  const candidates: Candidate[] = [];
  const skipped: string[] = [];

  for (const p of all) {
    if (p.currency && !overwrite) {
      skipped.push(`${describe(p)} — already set (pass --overwrite to change)`);
      continue;
    }
    const code = countryCode(p.address?.country);
    if (!code) {
      skipped.push(`${describe(p)} — country not US/CA, cannot derive`);
      continue;
    }
    if (onlyCountry && code !== onlyCountry) continue;
    candidates.push({ p, next: CURRENCY_BY_CODE[code], code });
  }

  if (doScan) {
    console.log(`\nScanning ${all.length} property(ies):\n`);
    for (const { p, next } of candidates) {
      const org = orgCurrency.get(String(p.organizationId)) ?? 'USD';
      const effect =
        next === org
          ? 'no visible change (matches org currency)'
          : `⚠ REINTERPRETS amounts as ${next} (org books in ${org})`;
      console.log(`  • ${describe(p)}  ⇒  ${next}   [${effect}]`);
    }
    if (skipped.length) {
      console.log(`\nSkipped:`);
      for (const s of skipped) console.log(`  – ${s}`);
    }
    console.log(
      '\nConfirm the ⚠ rows with the client before applying — stamping a currency reinterprets existing amounts, it does not convert them.',
    );
    await mongoose.disconnect();
    return;
  }

  console.log(
    `${apply ? 'Stamping' : 'Previewing'} ${candidates.length} property(ies)…`,
  );
  for (const { p, next } of candidates) {
    await stamp(p, next, apply);
  }
  console.log(
    apply
      ? `\n✓ Done. Set currency on ${candidates.length} property(ies).`
      : `\n${candidates.length} property(ies) would be stamped. Re-run with --apply to write.`,
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exitCode = 1;
});
