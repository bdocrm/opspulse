"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
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
import { LoginAnimatedBackground } from "@/components/login/login-animated-background";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type FieldErrors = {
  email?: string;
  password?: string;
};

type LoginStatus = "idle" | "submitting" | "success";

type AnimationStyle = CSSProperties & {
  "--login-delay": string;
};

const animationTiming = {
  logo: 0,
  badge: 80,
  headlineFirstLine: 150,
  headlineSecondLine: 260,
  description: 330,
  featureStart: 420,
  featureStep: 80,
  brandFooter: 660,
  pageFooter: 740,
  successRedirect: 620,
} as const;

function entranceDelay(delay: number): AnimationStyle {
  return { "--login-delay": `${delay}ms` };
}

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
  const [loginStatus, setLoginStatus] = useState<LoginStatus>("idle");
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const loading = loginStatus === "submitting";
  const loginLocked = loginStatus !== "idle";

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loginLocked || submittingRef.current) return;

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
    setLoginStatus("submitting");
    try {
      const result = await signIn("credentials", {
        email: email.trim(),
        password,
        redirect: false,
      });

      if (!result?.ok || result.error) {
        setAuthError("Incorrect email or password. Please try again.");
        setLoginStatus("idle");
        passwordRef.current?.focus();
        return;
      }

      setLoginStatus("success");
      if (!prefersReducedMotion) {
        await new Promise((resolve) => window.setTimeout(resolve, animationTiming.successRedirect));
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setAuthError("We could not sign you in right now. Please try again.");
      setLoginStatus("idle");
    } finally {
      submittingRef.current = false;
    }
  };

  const updateCapsLock = (event: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLockOn(event.getModifierState("CapsLock"));
  };

  return (
    <main className="relative min-h-[100svh] overflow-hidden bg-slate-100 text-slate-950 transition-colors duration-300 dark:bg-slate-950 dark:text-slate-50 motion-reduce:transition-none">
      <div className="absolute inset-0 lg:hidden">
        <LoginAnimatedBackground compact />
      </div>

      <div className="absolute right-4 top-4 z-30 sm:right-6 sm:top-6">
        <ThemeToggle className="rounded-xl border border-slate-200/80 bg-white/80 text-slate-700 shadow-sm backdrop-blur transition-colors hover:bg-white dark:border-white/10 dark:bg-slate-900/75 dark:text-slate-200 dark:hover:bg-slate-800 motion-reduce:transition-none" />
      </div>

      <div className="relative z-10 grid min-h-[100svh] lg:grid-cols-[minmax(0,1.35fr)_minmax(420px,0.9fr)]">
        <section className="relative hidden overflow-hidden bg-[#111c3d] px-10 py-10 text-white lg:flex xl:px-16 xl:py-12" aria-labelledby="platform-heading">
          <LoginAnimatedBackground />

          <div className="relative mx-auto flex w-full max-w-3xl flex-col">
            <div className="flex flex-1 items-center py-8 xl:py-10">
              <div className="w-full max-w-2xl">
                <div className="login-enter-up" style={entranceDelay(animationTiming.logo)}>
                  <div className="relative h-[68px] w-[250px] overflow-hidden rounded-xl border border-white/25 bg-white/95 shadow-lg shadow-black/15">
                    <Image src="/ops.png" alt="OpsView" width={225} height={123} className="absolute left-1/2 top-1/2 h-auto w-[225px] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain" priority />
                  </div>
                </div>

                <div className="mt-10 space-y-9 xl:mt-12">
                  <div className="space-y-5">
                    <div className="login-enter-up inline-flex items-center gap-2 rounded-full border border-blue-300/20 bg-blue-400/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-blue-100" style={entranceDelay(animationTiming.badge)}>
                      <span className="login-badge-pulse h-1.5 w-1.5 rounded-full bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.22)]" />
                      Operational intelligence, unified
                    </div>
                    <div className="space-y-4">
                      <h2 id="platform-heading" className="max-w-xl text-4xl font-semibold leading-[1.12] tracking-tight xl:text-5xl">
                        <span className="login-enter-up block" style={entranceDelay(animationTiming.headlineFirstLine)}>Operations performance,</span>
                        <span className="login-enter-up block" style={entranceDelay(animationTiming.headlineSecondLine)}>clearly in view.</span>
                      </h2>
                      <p className="login-enter-up max-w-xl text-base leading-7 text-blue-100/75 xl:text-lg" style={entranceDelay(animationTiming.description)}>
                        Monitor. Analyze. Improve. OpsView brings campaign performance and operational reporting into one secure workspace.
                      </p>
                    </div>
                  </div>

                  <div className="grid max-w-2xl gap-3 xl:grid-cols-3">
                    {platformHighlights.map(({ icon: Icon, title, description }, index) => (
                      <div
                        key={title}
                        className="group login-enter-up rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-sm transition-[transform,border-color,background-color,box-shadow] duration-200 ease-out hover:-translate-y-[3px] hover:border-blue-300/25 hover:bg-white/[0.09] hover:shadow-[0_8px_24px_rgba(64,148,217,0.08)] motion-reduce:transform-none motion-reduce:transition-none"
                        style={entranceDelay(animationTiming.featureStart + (index * animationTiming.featureStep))}
                      >
                        <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-blue-400/15 text-blue-200 transition-[transform,box-shadow] duration-200 ease-out group-hover:scale-105 group-hover:shadow-[0_0_18px_rgba(96,165,250,0.12)] motion-reduce:transform-none motion-reduce:transition-none">
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

            <div className="login-enter-up flex items-center justify-between border-t border-white/10 pt-5 text-xs text-blue-100/55" style={entranceDelay(animationTiming.brandFooter)}>
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                Secure role-based access
              </span>
              <span>Operations Performance &amp; Monitoring Platform</span>
            </div>
          </div>
        </section>

        <section className="flex min-h-[100svh] items-center justify-center px-4 py-20 transition-colors duration-300 sm:px-8 lg:bg-white/65 lg:px-10 lg:py-12 lg:backdrop-blur-xl dark:lg:bg-slate-950/75 motion-reduce:transition-none" aria-labelledby="login-heading">
          <div className="w-full max-w-[430px]">
            <div className="login-enter-up mb-7 flex justify-center lg:hidden" style={entranceDelay(animationTiming.logo)}>
              <div className="relative h-16 w-[230px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700">
                <Image src="/ops.png" alt="OpsView" width={210} height={114} className="absolute left-1/2 top-1/2 h-auto w-[210px] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain" priority />
              </div>
            </div>

            <div className="login-card-enter">
            <div className={`rounded-[20px] border border-slate-200/90 bg-white p-6 shadow-[0_24px_70px_-32px_rgba(15,23,42,0.38)] transition-[background-color,border-color,opacity,transform] duration-300 sm:p-8 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30 motion-reduce:transition-none ${loginStatus === "success" ? "login-card-success" : ""}`}>
              <div className="mb-7 space-y-2">
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                  <LockKeyhole className="h-5 w-5" aria-hidden="true" />
                </div>
                <h1 id="login-heading" className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-[1.75rem] dark:text-white">Welcome back</h1>
                <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">Sign in to access your OpsView workspace.</p>
              </div>

              <form onSubmit={handleSubmit} noValidate className={`space-y-5 ${authError ? "login-error-shake" : ""}`}>
                <div>
                  <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Email Address</label>
                  <div className="group relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400 transition-colors duration-200 group-focus-within:text-blue-500 dark:group-focus-within:text-blue-400 motion-reduce:transition-none" aria-hidden="true" />
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
                      aria-invalid={Boolean(fieldErrors.email || authError)}
                      aria-describedby={fieldErrors.email ? "email-error" : authError ? "auth-error" : undefined}
                      className={`h-12 rounded-xl bg-white pl-10 text-[15px] shadow-sm transition-[border-color,box-shadow] duration-200 placeholder:text-slate-400 focus-visible:border-blue-500 focus-visible:ring-blue-500/20 dark:bg-slate-950/70 dark:focus-visible:border-blue-400 dark:focus-visible:ring-blue-400/20 motion-reduce:transition-none ${authError ? "border-red-300 dark:border-red-800" : "border-slate-300 dark:border-slate-700"}`}
                    />
                  </div>
                  <p id="email-error" className={`mt-1.5 min-h-5 text-xs font-medium text-red-600 dark:text-red-400 ${fieldErrors.email ? "login-error-enter" : ""}`} aria-live="polite">{fieldErrors.email ?? ""}</p>
                </div>

                <div>
                  <label htmlFor="password" className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Password</label>
                  <div className="group relative">
                    <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400 transition-colors duration-200 group-focus-within:text-blue-500 dark:group-focus-within:text-blue-400 motion-reduce:transition-none" aria-hidden="true" />
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
                      aria-invalid={Boolean(fieldErrors.password || authError)}
                      aria-describedby={fieldErrors.password ? "password-error" : capsLockOn ? "caps-lock-warning" : authError ? "auth-error" : undefined}
                      className={`h-12 rounded-xl bg-white pl-10 pr-12 text-[15px] shadow-sm transition-[border-color,box-shadow] duration-200 placeholder:text-slate-400 focus-visible:border-blue-500 focus-visible:ring-blue-500/20 dark:bg-slate-950/70 dark:focus-visible:border-blue-400 dark:focus-visible:ring-blue-400/20 motion-reduce:transition-none ${authError ? "border-red-300 dark:border-red-800" : "border-slate-300 dark:border-slate-700"}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      className="absolute right-1 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-[color,background-color,transform] duration-200 hover:bg-slate-100 hover:text-slate-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 dark:hover:bg-slate-800 dark:hover:text-slate-200 motion-reduce:transform-none motion-reduce:transition-none"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                    >
                      <span key={showPassword ? "password-visible" : "password-hidden"} className="login-icon-pop">
                        {showPassword ? <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" /> : <Eye className="h-[18px] w-[18px]" aria-hidden="true" />}
                      </span>
                    </button>
                  </div>
                  <div className="mt-1.5 min-h-5" aria-live="polite">
                    {fieldErrors.password ? (
                      <p id="password-error" className="login-error-enter text-xs font-medium text-red-600 dark:text-red-400">{fieldErrors.password}</p>
                    ) : capsLockOn ? (
                      <p id="caps-lock-warning" className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                        <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> Caps Lock is ON
                      </p>
                    ) : null}
                  </div>
                </div>

                {authError && (
                  <div id="auth-error" role="alert" aria-live="assertive" className="login-error-enter flex gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100">
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
                  disabled={loginLocked}
                  aria-busy={loading}
                  aria-live="polite"
                  className={`h-12 w-full rounded-xl text-[15px] font-semibold text-white shadow-lg transition-[background-color,box-shadow,filter,transform] duration-150 ease-out hover:-translate-y-px hover:brightness-105 active:translate-y-0 active:scale-[0.98] focus-visible:ring-blue-500 motion-reduce:transform-none motion-reduce:transition-none ${loginStatus === "success" ? "bg-emerald-600 shadow-emerald-600/20 hover:bg-emerald-600" : "bg-blue-600 shadow-blue-600/20 hover:bg-blue-700 hover:shadow-blue-600/35 dark:bg-blue-500 dark:hover:bg-blue-400"}`}
                >
                  {loginStatus === "success" ? (
                    <span className="login-icon-pop inline-flex items-center"><CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />Access Granted</span>
                  ) : loading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Signing in...</>
                  ) : "Sign In"}
                </Button>
              </form>

              <div className="mt-6 flex items-center justify-center gap-2 border-t border-slate-100 pt-5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <CheckCircle2 className="login-status-pulse h-3.5 w-3.5 text-emerald-500" aria-hidden="true" /> Protected workspace access
              </div>
            </div>
            </div>

            <footer className="login-enter-up mt-6 text-center text-xs text-slate-500 dark:text-slate-500" style={entranceDelay(animationTiming.pageFooter)}>
              OpsView &copy; {new Date().getFullYear()} <span aria-hidden="true">&bull;</span> Developed by Business Development Team
            </footer>
          </div>
        </section>
      </div>
    </main>
  );
}
