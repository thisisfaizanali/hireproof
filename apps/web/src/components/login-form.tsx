"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DEMO_USERS, LoginInput, SessionUser } from "@hireproof/shared";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ROLE_LABEL, homeFor } from "@/lib/roles";

// Quick logins exist only on the demo deployment.
const SHOW_DEMO = process.env.NEXT_PUBLIC_DEMO_LOGINS === "true";
const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "";

const UNREACHABLE =
  "Cannot reach the server. Check your connection and try again.";
const SERVER_ERROR = "Something went wrong on our side. Try again in a moment.";

const STARTING =
  "The server is still starting. Wait a few seconds, then sign in again.";
const WAKING_NOTE =
  "Starting the server. The first load after a quiet spell can take up to a minute.";

// Asks the API if it is awake. The line only shows when the answer takes more
// than two seconds, so a warm server never flashes it.
function useServerWaking() {
  const [waking, setWaking] = useState(false);
  useEffect(() => {
    let stopped = false;
    const timer = setTimeout(() => setWaking(true), 2000);
    void (async () => {
      while (!stopped) {
        try {
          const res = await fetch("/api/health", { cache: "no-store" });
          if (res.ok) break;
        } catch {
          // Not reachable yet; ask again.
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      clearTimeout(timer);
      if (!stopped) setWaking(false);
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  return waking;
}

type FieldErrors = { email?: string; password?: string };

export function LoginForm() {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const waking = useServerWaking();

  async function signIn(values: { email: string; password: string }) {
    setFormError(null);

    const parsed = LoginInput.safeParse(values);
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FieldErrors;
        errors[key] ??= issue.message;
      }
      setFieldErrors(errors);
      (errors.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    setFieldErrors({});
    setPending(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = await res.json().catch(() => null);

      if (res.ok) {
        router.replace(homeFor(SessionUser.parse(body).role));
        return;
      }
      // The web server answers with a bodyless error when the API is down.
      setFormError(
        [502, 503, 504].includes(res.status)
          ? STARTING
          : body === null
            ? UNREACHABLE
            : res.status >= 500
              ? SERVER_ERROR
              : (body.error ?? SERVER_ERROR),
      );
    } catch {
      setFormError(UNREACHABLE);
    }
    setPending(false);
  }

  function demoSignIn(demoEmail: string) {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    void signIn({ email: demoEmail, password: DEMO_PASSWORD });
  }

  return (
    <div
      className={
        SHOW_DEMO
          ? "grid gap-10 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:gap-16"
          : "max-w-sm"
      }
    >
      <section aria-labelledby="signin-title" className="flex flex-col gap-6">
        <h1 id="signin-title">Sign in</h1>
        {waking && (
          <p role="status" className="text-sm text-muted-foreground">
            {WAKING_NOTE}
          </p>
        )}
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void signIn({ email, password });
          }}
        >
          <Field data-invalid={!!fieldErrors.email}>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              ref={emailRef}
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={!!fieldErrors.email}
              aria-describedby={fieldErrors.email ? "email-error" : undefined}
            />
            <FieldError id="email-error">{fieldErrors.email}</FieldError>
          </Field>
          <Field data-invalid={!!fieldErrors.password}>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              ref={passwordRef}
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={!!fieldErrors.password}
              aria-describedby={
                fieldErrors.password ? "password-error" : undefined
              }
            />
            <FieldError id="password-error">{fieldErrors.password}</FieldError>
          </Field>
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </section>

      {SHOW_DEMO && (
        <section
          aria-labelledby="demo-title"
          className="flex flex-col gap-3 md:border-l md:border-border md:pl-16"
        >
          <h2 id="demo-title">Demo accounts</h2>
          <p className="text-sm text-muted-foreground">
            Fictional users for trying each role. Select one to sign in.
          </p>
          <ul className="flex flex-col gap-2">
            {DEMO_USERS.map((user) => (
              <li key={user.email}>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => demoSignIn(user.email)}
                  className="h-auto min-h-11 w-full justify-between gap-4 py-2 text-left"
                >
                  <span className="font-medium">{user.name}</span>
                  <span className="text-right font-normal text-muted-foreground">
                    {user.client ?? ROLE_LABEL[user.role]}
                    {user.client ? `, ${ROLE_LABEL[user.role]}` : ""}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
