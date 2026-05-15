// Login — email/password (RHF + Zod) + Continue with Google. On success the
// Credentials sign-in sets the session cookie on the browser response, then we
// route to `callbackUrl` (default /dashboard). The signIn server event
// (auth.ts) provisions the default Settings doc on first login.
// Refs: PDR.md §4; site/design/login; tokens.md; Stage 3 (auth.ts).
"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AlertCircle, AtSign, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { zodResolver } from "@/lib/utils/zodResolver";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AuthBrand, GoogleButton, OrDivider } from "@/components/auth/AuthShared";

const loginSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
type LoginValues = z.infer<typeof loginSchema>;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const [showPassword, setShowPassword] = useState(false);
  // Pre-populate from an Auth.js redirect (e.g. failed Google link) or from a
  // rejected Credentials attempt.
  const [formError, setFormError] = useState<string | null>(
    searchParams.get("error") ? "Could not sign you in. Please try again." : null,
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginValues) {
    setFormError(null);
    const res = await signIn("credentials", {
      email: values.email,
      password: values.password,
      redirect: false,
    });

    if (!res || res.error) {
      setFormError("Invalid email or password");
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <>
      <div className="rounded-md border border-border/40 bg-surface p-8 shadow-2xl md:p-10">
        <AuthBrand tagline="Terminal Access" />

        {formError && (
          <div
            role="alert"
            className="mb-6 flex items-center gap-2 rounded-md border border-error/40 bg-error-container/20 px-4 py-3"
          >
            <AlertCircle className="h-5 w-5 shrink-0 text-error" />
            <p className="text-sm font-medium text-error">{formError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="email" className="ml-1">
              Email
            </Label>
            <div className="relative">
              <AtSign className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-fg-muted" />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="name@company.com"
                className="pl-10"
                aria-invalid={Boolean(errors.email)}
                {...register("email")}
              />
            </div>
            {errors.email && (
              <p className="ml-1 text-xs text-error">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="ml-1">
              Password
            </Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-fg-muted" />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                className="pl-10 pr-12"
                aria-invalid={Boolean(errors.password)}
                {...register("password")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted transition-colors hover:text-fg"
              >
                {showPassword ? (
                  <EyeOff className="h-5 w-5" />
                ) : (
                  <Eye className="h-5 w-5" />
                )}
              </button>
            </div>
            {errors.password && (
              <p className="ml-1 text-xs text-error">
                {errors.password.message}
              </p>
            )}
          </div>

          <Button
            type="submit"
            size="lg"
            disabled={isSubmitting}
            className="h-12 w-full"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>

        <OrDivider />

        <GoogleButton callbackUrl={callbackUrl} disabled={isSubmitting} />

        <footer className="mt-8 border-t border-border/40 pt-6 text-center">
          <p className="text-sm text-fg-muted">
            Don&apos;t have an account?{" "}
            <Link
              href="/signup"
              className="ml-1 font-bold text-primary transition-all hover:underline"
            >
              Sign up
            </Link>
          </p>
        </footer>
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-fg-muted" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
