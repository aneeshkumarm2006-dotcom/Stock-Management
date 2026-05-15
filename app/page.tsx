import { redirect } from 'next/navigation';

// The app has no marketing/landing surface — the root path just sends users
// into the product. Auth is enforced by middleware: unauthenticated visitors
// hitting /dashboard are bounced to /login by the `authorized` callback.
export default function Home() {
  redirect('/dashboard');
}
