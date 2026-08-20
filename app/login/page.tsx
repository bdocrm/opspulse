"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Eye,
  EyeOff,
  LineChart,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type FieldErrors = {
  email?: string;
  password?: string;
};

const platformHighlights = [
  {
    icon: Activity,
    title: "Performance monitoring",
    description: "Track operational results against the goals that matter.",
  },
  {
    icon: BarChart3,
    title: "Campaign analytics",
    description: "Keep every campaign visible in one dependable workspace.",
  },
  {
    icon: LineChart,
    title: "Operational insights",
    description: "Turn current performance data into focused action.",
  },
] as const;

function validateEmail(value: string) {
  const email = value.trim();
  if (!email) return "Email address is required.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
  return undefined;
}

function validatePassword(value: string) {
  return value ? undefined : "Password is required.";
}

export default function LoginPage() {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [authError, setAuthError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading || submittingRef.current) return;

    const nextErrors = {
      email: validateEmail(email),
      password: validatePassword(password),
    };
    setFieldErrors(nextErrors);
    setAuthError("");

    if (nextErrors.email || nextErrors.password) {
      if (nextErrors.email) emailRef.current?.focus();
      else passwordRef.current?.focus();
      return;
    }

    submittingRef.current = true;
    setLoading(true);
    try {
      const result = await signIn("credentials", {
        email: email.trim(),
        password,
        redirect: false,
      });

      if (!result?.ok || result.error) {
        setAuthError("Incorrect email or password. Please try again.");
        passwordRef.current?.focus();
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setAuthError("We could not sign you in right now. Please try again.");
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const updateCapsLock = (event: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLockOn(event.getModifierState("CapsLock"));
  };

  return (
    <main className="relative min-h-[100svh] overflow-hidden bg-slate-100 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -right-32 -top-40 h-[28rem] w-[28rem] rounded-full bg-blue-500/10 blur-3xl dark:bg-blue-500/15" />
        <div className="absolute -bottom-52 left-1/3 h-[30rem] w-[30rem] rounded-full bg-orange-400/5 blur-3xl" />
      </div>

      <div className="absolute right-4 top-4 z-30 sm:right-6 sm:top-6">
        <ThemeToggle className="rounded-xl border border-slate-200/80 bg-white/80 text-slate-700 shadow-sm backdrop-blur transition-colors hover:bg-white dark:border-white/10 dark:bg-slate-900/75 dark:text-slate-200 dark:hover:bg-slate-800 motion-reduce:transition-none" />
      </div>

      <div className="relative z-10 grid min-h-[100svh] lg:grid-cols-[minmax(0,1.35fr)_minmax(420px,0.9fr)]">
        <section className="relative hidden overflow-hidden bg-[#111c3d] px-10 py-10 text-white lg:flex xl:px-16 xl:py-12" aria-labelledby="platform-heading">
          <div aria-hidden="true" className="absolute inset-0 opacity-[0.16] [background-image:linear-gradient(rgba(255,255,255,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.12)_1px,transparent_1px)] [background-size:44px_44px]" />
          <div aria-hidden="true" className="absolute -left-28 top-1/4 h-72 w-72 rounded-full bg-blue-500/25 blur-3xl" />
          <div aria-hidden="true" className="absolute -bottom-32 right-10 h-80 w-80 rounded-full bg-orange-500/10 blur-3xl" />

          <div className="relative mx-auto flex w-full max-w-3xl flex-col">
            <div className="flex flex-1 items-center py-8 xl:py-10">
              <div className="w-full max-w-2xl">
                <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-200">
                  <div className="relative h-[68px] w-[250px] overflow-hidden rounded-xl border border-white/25 bg-white/95 shadow-lg shadow-black/15">
                    <Image src="/ops.png" alt="OpsView" width={225} height={123} className="absolute left-1/2 top-1/2 h-auto w-[225px] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain" priority />
                  </div>
                </div>

                <div className="mt-10 space-y-9 xl:mt-12">
                  <div className="space-y-5 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-200">
                    <div className="inline-flex items-center gap-2 rounded-full border border-blue-300/20 bg-blue-400/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-blue-100">
                      <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                      Operational intelligence, unified
                    </div>
                    <div className="space-y-4">
                      <h2 id="platform-heading" className="max-w-xl text-4xl font-semibold leading-[1.12] tracking-tight xl:text-5xl">
                        Operations performance, clearly in view.
                      </h2>
                      <p className="max-w-xl text-base leading-7 text-blue-100/75 xl:text-lg">
                        Monitor. Analyze. Improve. OpsView brings campaign performance and operational reporting into one secure workspace.
                      </p>
                    </div>
                  </div>

                  <div className="grid max-w-2xl gap-3 xl:grid-cols-3">
                    {platformHighlights.map(({ icon: Icon, title, description }) => (
                      <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-sm transition-colors duration-200 hover:bg-white/[0.09] motion-reduce:transition-none">
                        <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-blue-400/15 text-blue-200">
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </div>
                        <h2 className="text-sm font-semibold">{title}</h2>
                        <p className="mt-1.5 text-xs leading-5 text-blue-100/60">{description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-white/10 pt-5 text-xs text-blue-100/55">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                Secure role-based access
              </span>
              <span>Operations Performance &amp; Monitoring Platform</span>
            </div>
          </div>
        </section>

        <section className="flex min-h-[100svh] items-center justify-center px-4 py-20 sm:px-8 lg:bg-white/65 lg:px-10 lg:py-12 lg:backdrop-blur-xl dark:lg:bg-slate-950/75" aria-labelledby="login-heading">
          <div className="w-full max-w-[430px]">
            <div className="mb-7 flex justify-center lg:hidden motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
              <div className="relative h-16 w-[230px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700">
                <Image src="/ops.png" alt="OpsView" width={210} height={114} className="absolute left-1/2 top-1/2 h-auto w-[210px] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain" priority />
              </div>
            </div>

            <div className="rounded-[20px] border border-slate-200/90 bg-white p-6 shadow-[0_24px_70px_-32px_rgba(15,23,42,0.38)] sm:p-8 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-200">
              <div className="mb-7 space-y-2">
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                  <LockKeyhole className="h-5 w-5" aria-hidden="true" />
                </div>
                <h1 id="login-heading" className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-[1.75rem] dark:text-white">Welcome back</h1>
                <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">Sign in to access your OpsView workspace.</p>
              </div>

              <form onSubmit={handleSubmit} noValidate className="space-y-5">
                <div>
                  <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Email Address</label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <Input
                      ref={emailRef}
                      id="email"
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="name@company.com"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        if (fieldErrors.email) setFieldErrors((current) => ({ ...current, email: undefined }));
                        if (authError) setAuthError("");
                      }}
                      onBlur={() => setFieldErrors((current) => ({ ...current, email: validateEmail(email) }))}
                      aria-invalid={Boolean(fieldErrors.email)}
                      aria-describedby={fieldErrors.email ? "email-error" : undefined}
                      className="h-12 rounded-xl border-slate-300 bg-white pl-10 text-[15px] shadow-sm transition-[border-color,box-shadow] duration-200 placeholder:text-slate-400 focus-visible:border-blue-500 focus-visible:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950/70 dark:focus-visible:border-blue-400 dark:focus-visible:ring-blue-400/20 motion-reduce:transition-none"
                    />
                  </div>
                  <p id="email-error" className="mt-1.5 min-h-5 text-xs font-medium text-red-600 dark:text-red-400" aria-live="polite">{fieldErrors.email ?? ""}</p>
                </div>

                <div>
                  <label htmlFor="password" className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Password</label>
                  <div className="relative">
                    <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <Input
                      ref={passwordRef}
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        if (fieldErrors.password) setFieldErrors((current) => ({ ...current, password: undefined }));
                        if (authError) setAuthError("");
                      }}
                      onBlur={() => {
                        setCapsLockOn(false);
                        setFieldErrors((current) => ({ ...current, password: validatePassword(password) }));
                      }}
                      onKeyDown={updateCapsLock}
                      onKeyUp={updateCapsLock}
                      aria-invalid={Boolean(fieldErrors.password)}
                      aria-describedby={fieldErrors.password ? "password-error" : capsLockOn ? "caps-lock-warning" : undefined}
                      className="h-12 rounded-xl border-slate-300 bg-white pl-10 pr-12 text-[15px] shadow-sm transition-[border-color,box-shadow] duration-200 placeholder:text-slate-400 focus-visible:border-blue-500 focus-visible:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950/70 dark:focus-visible:border-blue-400 dark:focus-visible:ring-blue-400/20 motion-reduce:transition-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      className="absolute right-1 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 dark:hover:bg-slate-800 dark:hover:text-slate-200 motion-reduce:transition-none"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" /> : <Eye className="h-[18px] w-[18px]" aria-hidden="true" />}
                    </button>
                  </div>
                  <div className="mt-1.5 min-h-5" aria-live="polite">
                    {fieldErrors.password ? (
                      <p id="password-error" className="text-xs font-medium text-red-600 dark:text-red-400">{fieldErrors.password}</p>
                    ) : capsLockOn ? (
                      <p id="caps-lock-warning" className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                        <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> Caps Lock is ON
                      </p>
                    ) : null}
                  </div>
                </div>

                {authError && (
                  <div role="alert" aria-live="assertive" className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-semibold">Unable to sign in</p>
                      <p className="mt-0.5 text-xs leading-5 text-red-700 dark:text-red-300">{authError}</p>
                    </div>
                  </div>
                )}

                <Button
                  type="submit"
                  size="lg"
                  disabled={loading}
                  aria-busy={loading}
                  className="h-12 w-full rounded-xl bg-blue-600 text-[15px] font-semibold text-white shadow-lg shadow-blue-600/20 transition-[background-color,box-shadow,transform] duration-200 hover:bg-blue-700 hover:shadow-blue-600/30 active:translate-y-px focus-visible:ring-blue-500 dark:bg-blue-500 dark:hover:bg-blue-400 motion-reduce:transform-none motion-reduce:transition-none"
                >
                  {loading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Signing in...</>
                  ) : "Sign In"}
                </Button>
              </form>

              <div className="mt-6 flex items-center justify-center gap-2 border-t border-slate-100 pt-5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" /> Protected workspace access
              </div>
            </div>

            <footer className="mt-6 text-center text-xs text-slate-500 dark:text-slate-500">
              OpsView &copy; {new Date().getFullYear()} <span aria-hidden="true">&bull;</span> Developed by Business Development Team
            </footer>
          </div>
        </section>
      </div>
    </main>
  );
}
