import { redirect } from 'next/navigation';

// Any path that doesn't match a defined route falls through to this 404
// boundary. Rather than show a dead-end page, send the user to the dashboard.
// Unauthenticated users never reach here for protected paths — middleware's
// `authorized` callback redirects them to /login first.
export default function NotFound() {
  redirect('/dashboard');
}
