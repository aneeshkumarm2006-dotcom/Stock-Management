// Org membership listing — returns active users for the current org as
// picker fodder. Powers the Phase 5 Project-lead + Task-assignee selectors.
// Self-only auth: any authenticated org member can list members for their
// own org (no role gate). Returns name + email + roles for display.
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { OrgMembership } from '@/lib/db/models/pm/OrgMembership';
import { User } from '@/lib/db/models/User';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';

export const runtime = 'nodejs';

export async function GET() {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  await connectToDatabase();
  const memberships = await OrgMembership.find({
    organizationId: new Types.ObjectId(ctx.orgId),
    active: true,
  })
    .lean<
      Array<{
        _id: Types.ObjectId;
        userId: Types.ObjectId;
        roles: string[];
      }>
    >();

  if (memberships.length === 0) return NextResponse.json([]);

  const users = await User.find({
    _id: { $in: memberships.map((m) => m.userId) },
  })
    .select('_id name email')
    .lean<
      Array<{ _id: Types.ObjectId; name: string; email: string }>
    >();

  const userMap = new Map(users.map((u) => [String(u._id), u]));

  return NextResponse.json(
    memberships
      .map((m) => {
        const u = userMap.get(String(m.userId));
        if (!u) return null;
        return {
          id: String(u._id),
          name: u.name,
          email: u.email,
          roles: m.roles,
        };
      })
      .filter(Boolean),
  );
}
