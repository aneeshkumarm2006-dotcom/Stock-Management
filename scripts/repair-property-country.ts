/**
 * One-shot data fix: restore `address.country` on Property rows whose country
 * was silently reset to the schema default ('US') by the OLD "edit an address
 * field" flow.
 *
 * Background
 * ----------
 * The property detail Summary editor PATCHes only the address fields the user
 * changed (line1/city/state/zip — it has NO Country field). The old PATCH
 * handler did `Object.assign(doc, { address: <partial> })`, which REPLACED the
 * whole `address` subdocument and reset every field not sent back to its schema
 * default. AddressSchema.country defaults to 'US', so editing any address field
 * on a Canadian property flipped its country 'CA' → 'US'. The dashboard's
 * Outstanding Balances card groups on address.country, so those properties
 * jumped into the United States column.
 *
 * The route fix (merge partial address instead of replacing) stops this from
 * recurring, but already-corrupted rows still read 'US'. This script repairs
 * them. Because the Summary editor exposes no Country field, users cannot fix
 * this themselves through the UI.
 *
 * How we identify a corrupted row (conservative — we never flip a genuinely-US
 * property): country normalizes to "United States" AND the postal code matches
 * the Canadian format (A1A 1A1). A US ZIP (\d{5}(-\d{4})?) never matches, so
 * legitimately-US rows are left untouched. Rows flagged this way are Canadian
 * properties whose country was reset.
 *
 * Safety
 * ------
 * - Preview by default. Pass --apply to write.
 * - --scan lists every candidate without writing.
 * - --id=<propertyId> targets one property explicitly (skips the heuristic;
 *   still requires a Canadian postal code unless --force is also passed).
 * - Idempotent: once country is 'CA' a re-run finds nothing to do.
 * - Every change is written to the activity log.
 *
 * Usage (run from `site/`):
 *   npx --yes tsx scripts/repair-property-country.ts --scan
 *   npx --yes tsx scripts/repair-property-country.ts                 # preview all candidates
 *   npx --yes tsx scripts/repair-property-country.ts --apply         # fix all candidates
 *   npx --yes tsx scripts/repair-property-country.ts --id=<propId>           # preview one
 *   npx --yes tsx scripts/repair-property-country.ts --id=<propId> --apply   # fix one
 */
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose, { Types } from 'mongoose';
import { connectToDatabase } from '../lib/db/mongoose';
import { Property } from '../lib/db/models/pm/Property';
import { ActivityLogEntry } from '../lib/db/models/pm/ActivityLogEntry';

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

// Mirror of the dashboard's normalizeCountry: does this value count as US?
function isUnitedStates(raw: string | undefined | null): boolean {
  const c = (raw ?? '').trim().toUpperCase();
  return ['US', 'USA', 'U.S.', 'U.S.A.', 'UNITED STATES'].includes(c);
}

// Canadian postal code: A1A 1A1 (space/hyphen optional). Matches the pattern
// used by AddressFields. A US ZIP never matches this.
const CA_POSTAL = /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/;

// Canadian province/territory codes. These have ZERO overlap with US state
// codes, so a province code in `state` is an unambiguous Canada signal — it
// survives even when the bug blanked the zip (as on "IMMEUBLES GREENE Metro
// 1280 Ave Greene", whose zip + city were wiped but state=QC remained).
const CA_PROVINCES = new Set([
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
]);

// A property is a Canadian row that lost its country when EITHER its postal code
// is Canadian-format OR its province code is Canadian. Both signals are
// impossible for a genuine US address, so we never mis-flag a real US property.
function looksCanadian(
  zip: string | undefined | null,
  state?: string | undefined | null,
): boolean {
  if (CA_POSTAL.test((zip ?? '').trim())) return true;
  return CA_PROVINCES.has((state ?? '').trim().toUpperCase());
}

interface PropLite {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  propertyName: string;
  address?: {
    line1?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
}

function describe(p: PropLite): string {
  const a = p.address ?? {};
  return `"${p.propertyName}" — country=${a.country ?? '(none)'}, zip=${a.zip ?? '(none)'}, city=${a.city ?? ''}, state=${a.state ?? ''}`;
}

/** Preview or apply the country fix for one property. Returns whether it was
 *  (or would be) changed, plus a reason when skipped. */
async function repair(
  p: PropLite,
  apply: boolean,
  force: boolean,
): Promise<{ changed: boolean; reason?: string }> {
  const country = p.address?.country;
  if (!isUnitedStates(country)) {
    return { changed: false, reason: `country is "${country ?? '(none)'}", not US — nothing to do.` };
  }
  if (!force && !looksCanadian(p.address?.zip, p.address?.state)) {
    return {
      changed: false,
      reason: `no Canadian signal (zip "${p.address?.zip ?? '(none)'}", state "${p.address?.state ?? '(none)'}") — skipping (pass --force with --id to override).`,
    };
  }

  console.log(`  ⚠ ${describe(p)}`);
  if (!apply) return { changed: true };

  await Property.updateOne(
    { _id: p._id, organizationId: p.organizationId },
    { $set: { 'address.country': 'CA' } },
  );
  await ActivityLogEntry.create({
    organizationId: p.organizationId,
    parentType: 'Property',
    parentId: p._id,
    eventType: 'Data repair — address.country restored to CA',
    actorUserId: null,
    payload: { from: country, to: 'CA', zip: p.address?.zip ?? null },
  });
  return { changed: true };
}

/** Every property whose country reads US but whose zip is a Canadian postal
 *  code — i.e. Canadian properties reset by the old edit-address bug. */
async function findCandidates(): Promise<PropLite[]> {
  const usProps = await Property.find({
    'address.country': { $in: ['US', 'USA', 'U.S.', 'U.S.A.', 'United States', 'UNITED STATES'] },
  }).lean<PropLite[]>();
  return usProps.filter((p) => looksCanadian(p.address?.zip, p.address?.state));
}

async function main() {
  loadEnvLocal();
  const apply = process.argv.includes('--apply');
  const doScan = process.argv.includes('--scan');
  const force = process.argv.includes('--force');
  const idArg = argValue('--id');

  if (process.env.MONGODB_DNS_SERVERS) {
    dns.setServers(
      process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()),
    );
  }

  await connectToDatabase();
  console.log(`✓ connected${apply ? '' : ' (preview — pass --apply to write)'}`);

  // Single-property mode.
  if (idArg) {
    if (!Types.ObjectId.isValid(idArg)) {
      throw new Error(`--id is not a valid ObjectId: ${idArg}`);
    }
    const p = await Property.findById(idArg).lean<PropLite | null>();
    if (!p) throw new Error(`No property found with _id ${idArg}.`);
    console.log(`Target: ${describe(p)}`);
    const res = await repair(p, apply, force);
    console.log(
      res.changed
        ? apply
          ? '✓ country set to CA.'
          : 'Would set country to CA. Re-run with --apply to write.'
        : `Nothing to do: ${res.reason}`,
    );
    await mongoose.disconnect();
    return;
  }

  // Scan / bulk mode.
  const candidates = await findCandidates();
  if (doScan) {
    console.log(`Scanning… found ${candidates.length} likely-corrupted property(ies):`);
    for (const p of candidates) console.log(`  • ${describe(p)}`);
    if (candidates.length > 0) {
      console.log('\nRe-run without --scan to preview, or with --apply to fix them all.');
    } else {
      console.log('✓ No corrupted properties found.');
    }
    await mongoose.disconnect();
    return;
  }

  console.log(
    `${apply ? 'Repairing' : 'Previewing'} ${candidates.length} candidate(s)…`,
  );
  let changed = 0;
  for (const p of candidates) {
    const res = await repair(p, apply, force);
    if (res.changed) changed++;
  }
  console.log(
    apply
      ? `\n✓ Done. Restored country to CA on ${changed} property(ies). The Outstanding Balances card will group them under Canada on next load.`
      : `\n${changed} property(ies) would be fixed. Re-run with --apply to write.`,
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Repair failed:', err);
  process.exitCode = 1;
});
