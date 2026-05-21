// Org bootstrap. Auto-provisions a one-user Organization + Admin membership
// on first PM access; seeds default taxonomies. Idempotent and safe under
// concurrent invocations.
// Refs: PROPERTY_TODO.md Phase 0 §Org settings.
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { User } from '@/lib/db/models/User';
import { Organization } from '@/lib/db/models/pm/Organization';
import { OrgMembership } from '@/lib/db/models/pm/OrgMembership';
import { seedDefaults } from '@/lib/pm/seed';

function slugFromEmail(email: string, fallback: string): string {
  const local = email.split('@')[0] ?? fallback;
  const base = local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return base || fallback;
}

async function uniqueSlug(base: string): Promise<string> {
  // Try plain first; on collision, append a short suffix. Bounded so we don't
  // loop forever if the DB is unreachable — caller will surface the error.
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const existing = await Organization.exists({ slug: candidate });
    if (!existing) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Returns the orgId + roles for the given user, creating the org on first
 * call. The first user in an org is the owner and gets the `Admin` +
 * `PropertyManager` roles.
 */
export async function getOrCreateOrgForUser(userId: string): Promise<{
  orgId: string;
  roles: string[];
}> {
  await connectToDatabase();

  const uid = new Types.ObjectId(userId);

  // 1. Try to read an existing membership first — the happy path on every
  //    request after the first.
  const existing = await OrgMembership.findOne({ userId: uid, active: true })
    .lean()
    .exec();
  if (existing) {
    return {
      orgId: String(existing.organizationId),
      roles: existing.roles,
    };
  }

  // 2. First-call bootstrap. Build a slug from the user's email and resolve
  //    a name.
  const user = await User.findById(uid).lean().exec();
  if (!user) {
    throw new Error(`User ${userId} not found while bootstrapping org`);
  }
  const slugBase = slugFromEmail(user.email, String(uid).slice(-6));
  const slug = await uniqueSlug(slugBase);
  const name = `${user.name?.trim() || user.email}'s Workspace`;

  const org = await Organization.create({
    name,
    slug,
    ownerUserId: uid,
  });

  await OrgMembership.create({
    organizationId: org._id,
    userId: uid,
    roles: ['Admin', 'PropertyManager'],
    joinedAt: new Date(),
  });

  await seedDefaults(org._id);

  return { orgId: String(org._id), roles: ['Admin', 'PropertyManager'] };
}

export default getOrCreateOrgForUser;
