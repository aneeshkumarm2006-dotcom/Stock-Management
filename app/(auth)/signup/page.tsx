// Signup — name/email/password (RHF + Zod). POSTs /api/auth/register (creates
// the User; no email verification per PDR §4), then runs the programmatic
// Credentials sign-in from the browser so the session cookie is issued on the
// response, and routes to /stock/dashboard. The signIn server event (auth.ts)
// provisions the default Settings doc.
// Refs: PDR.md §4; site/design/signup; tokens.md; app/api/auth/register.
"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AlertCircle, Eye, EyeOff, Info, Loader2 } from "lucide-react";
import { zodResolver } from "@/lib/utils/zodResolver";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AuthBrand, GoogleButton, OrDivider } from "@/components/auth/AuthShared";

// Mirrors the server contract in app/api/auth/register/route.ts.
const signupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(120, "Name is too long"),
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});
type SignupValues = z.infer<typeof signupSchema>;

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/stock/dashboard";

  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  async function onSubmit(values: SignupValues) {
    setFormError(null);

    let res: Response;
    try {
      res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
    } catch {
      setFormError("Network error. Please try again.");
      return;
    }

    if (res.status === 409) {
      setError("email", {
        type: "conflict",
        message: "An account with this email already exists",
      });
      return;
    }

    if (!res.ok) {
      // Surface server-side Zod field issues when present, else a generic msg.
      const data = (await res.json().catch(() => null)) as {
        issues?: Record<string, string[]>;
      } | null;
      const issues = data?.issues;
      if (issues) {
        (Object.keys(issues) as (keyof SignupValues)[]).forEach((field) => {
          const msg = issues[field]?.[0];
          if (msg) setError(field, { type: "server", message: msg });
        });
        return;
      }
      setFormError("Could not create your account. Please try again.");
      return;
    }

    // Account created — sign in from the browser so the cookie is set here.
    const signInRes = await signIn("credentials", {
      email: values.email,
      password: values.password,
      redirect: false,
    });

    if (!signInRes || signInRes.error) {
      // Account exists but auto sign-in failed — send them to login.
      router.push("/login");
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <div className="rounded-md border border-border/40 bg-surface p-8 shadow-2xl md:p-10">
      <AuthBrand tagline="Institutional-grade portfolio management" />

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
          <Label htmlFor="name" className="ml-1">
            Full Name
          </Label>
          <Input
            id="name"
            type="text"
            autoComplete="name"
            placeholder="John Doe"
            aria-invalid={Boolean(errors.name)}
            {...register("name")}
          />
          {errors.name && (
            <p className="ml-1 text-xs text-error">{errors.name.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email" className="ml-1">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="name@company.com"
            aria-invalid={Boolean(errors.email)}
            {...register("email")}
          />
          {errors.email && (
            <p className="ml-1 text-xs text-error">{errors.email.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password" className="ml-1">
            Password
          </Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="••••••••"
              className="pr-12"
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
          {errors.password ? (
            <p className="ml-1 text-xs text-error">
              {errors.password.message}
            </p>
          ) : (
            <p className="ml-1 mt-1.5 flex items-center gap-1 text-xs text-fg-muted">
              <Info className="h-3.5 w-3.5" />
              Minimum 8 characters
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
              Creating account…
            </>
          ) : (
            "Create account"
          )}
        </Button>
      </form>

      <OrDivider />

      <GoogleButton callbackUrl={callbackUrl} disabled={isSubmitting} />

      <p className="mt-8 text-center text-sm text-fg-muted">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-semibold text-primary transition-all hover:underline"
        >
          Log in
        </Link>
      </p>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-fg-muted" />
        </div>
      }
    >
      <SignupForm />
    </Suspense>
  );
}
