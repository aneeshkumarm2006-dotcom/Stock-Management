// Auth.js GET/POST handler (sign-in, callback, sign-out, session, csrf, etc.).
// Refs: Tech_Stack.md §Folder Structure, §Authentication.
import { handlers } from '@/auth';

// Mongoose needs the Node runtime (not Edge).
export const runtime = 'nodejs';

export const { GET, POST } = handlers;
