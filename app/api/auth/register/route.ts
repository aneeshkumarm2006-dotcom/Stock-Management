// Custom signup: validate, normalize email, enforce uniqueness, hash password,
// create the User document. No email verification (minimal by design, PDR §4).
// The client (signup page, Stage 7) performs the programmatic Credentials
// sign-in once this returns 201 — Auth.js sign-in must run from the browser so
// the session cookie is issued on the user's response.
// Refs: PDR.md §4; Tech_Stack.md §Authentication, §Security Notes.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { connectToDatabase } from '@/lib/db/mongoose';
import { User } from '@/lib/db/models/User';
import { hashPassword } from '@/lib/auth/password';

// Mongoose + bcrypt need the Node runtime (not Edge).
export const runtime = 'nodejs';

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { name, email, password } = parsed.data;

  try {
    await connectToDatabase();

    const existing = await User.findOne({ email }).select('_id').lean();
    if (existing) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 },
      );
    }

    const passwordHash = await hashPassword(password);
    const user = await User.create({ email, name, passwordHash });

    return NextResponse.json(
      { id: String(user._id), email: user.email, name: user.name },
      { status: 201 },
    );
  } catch (err) {
    // Unique-index race: a concurrent signup won the email between our check
    // and insert. Surface as a clean conflict rather than a 500.
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: number }).code === 11000
    ) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 },
      );
    }
    console.error('register: failed to create user', err);
    return NextResponse.json(
      { error: 'Could not create account' },
      { status: 500 },
    );
  }
}
