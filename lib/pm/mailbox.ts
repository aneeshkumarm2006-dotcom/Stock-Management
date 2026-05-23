// Sender-mailbox resolution (BR-CC-5, DECISIONS.md [G-B-21]).
// Lookup order: per-property override → org default. Phase 6 callers pull
// the chosen mailbox from this helper instead of reaching into the
// Organization document directly.
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Organization } from '@/lib/db/models/pm/Organization';

export interface MailboxLookupInput {
  orgId: string | Types.ObjectId;
  propertyId?: string | Types.ObjectId | null;
}

/** Resolve the From mailbox for a given org / optional property scope.
 *  Returns null when no default is configured — Compose must surface a
 *  warning in that case. */
export async function resolveSenderMailbox(
  input: MailboxLookupInput,
): Promise<string | null> {
  await connectToDatabase();
  const org = await Organization.findById(input.orgId)
    .select('senderMailbox')
    .lean<{ senderMailbox?: {
      defaultFrom?: string;
      perPropertyOverrides?: Map<string, string> | Record<string, string>;
    } }>();
  if (!org?.senderMailbox) return null;

  const overrides = org.senderMailbox.perPropertyOverrides;
  if (input.propertyId && overrides) {
    const key = String(input.propertyId);
    // Mongoose `Map` deserialises to a `Map`; raw .lean() may return a plain
    // object depending on the driver — handle both.
    if (overrides instanceof Map) {
      const v = overrides.get(key);
      if (v) return v;
    } else if (typeof overrides === 'object') {
      const v = (overrides as Record<string, string>)[key];
      if (v) return v;
    }
  }
  return org.senderMailbox.defaultFrom ?? null;
}
