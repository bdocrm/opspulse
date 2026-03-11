"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ThemeToggle } from "@/components/layout/theme-toggle";

const style = `
  @keyframes slideUpFade {
    from {
      opacity: 0;
      transform: translateY(30px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes shimmer {
    0% {
      background-position: -1000px 0;
    }
    100% {
      background-position: 1000px 0;
    }
  }

  @keyframes float {
    0%, 100% {
      transform: translateY(0px);
    }
    50% {
      transform: translateY(-10px);
    }
  }

  @keyframes glow {
    0%, 100% {
      box-shadow: 0 0 20px rgba(59, 130, 246, 0.3), 0 0 40px rgba(59, 130, 246, 0.1);
    }
    50% {
      box-shadow: 0 0 30px rgba(59, 130, 246, 0.5), 0 0 60px rgba(59, 130, 246, 0.2);
    }
  }

  .animate-slideup {
    animation: slideUpFade 0.7s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .animate-slideup-delay-1 {
    animation: slideUpFade 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s backwards;
  }

  .animate-slideup-delay-2 {
    animation: slideUpFade 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s backwards;
  }

  .animate-slideup-delay-3 {
    animation: slideUpFade 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) 0.45s backwards;
  }

  .logo-float {
    animation: float 3s ease-in-out infinite;
  }

  .focus-text {
    background: linear-gradient(135deg, #3b82f6, #8b5cf6, #ec4899);
    background-size: 300% 300%;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: shimmer 4s ease-in-out infinite;
    font-size: 1.25rem;
    font-weight: 600;
    letter-spacing: 0.5px;
  }

  .input-field {
    background: rgba(255, 255, 255, 0.95);
    border: 2px solid rgba(59, 130, 246, 0.2);
    border-radius: 12px;
    padding: 12px 16px;
    font-size: 0.95rem;
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    backdrop-filter: blur(10px);
  }

  .input-field:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.15), inset 0 0 0 1px rgba(59, 130, 246, 0.1);
    outline: none;
    background: rgba(255, 255, 255, 1);
  }

  .input-field::placeholder {
    color: rgba(100, 116, 139, 0.6);
  }

  .login-card {
    background: rgba(255, 255, 255, 0.98);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(59, 130, 246, 0.15);
    border-radius: 20px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15), 0 0 40px rgba(59, 130, 246, 0.1);
  }

  .login-btn {
    background: linear-gradient(135deg, #3b82f6, #2563eb);
    border: 0;
    border-radius: 12px;
    padding: 12px 24px;
    font-weight: 600;
    font-size: 1rem;
    color: white;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    box-shadow: 0 10px 25px -5px rgba(59, 130, 246, 0.3);
  }

  .login-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 15px 40px -5px rgba(59, 130, 246, 0.4);
  }

  .login-btn:active {
    transform: translateY(0);
  }

  .login-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }
`;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Invalid email or password");
    } else {
      router.push("/dashboard");
    }
  };

  return (
    <>
      <style>{style}</style>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center px-4 relative overflow-hidden">
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl"></div>
        </div>

        <div className="absolute top-4 right-4 animate-slideup z-10">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-md space-y-8 relative z-10">
          {/* Logo */}
          <div className="flex justify-center animate-slideup">
            <div className="logo-float">
              <Image
                src="/ops.png"
                alt="OpsPulse"
                width={240}
                height={240}
                className="h-60 w-60 object-contain drop-shadow-2xl"
                priority
              />
            </div>
          </div>

          {/* Login Card */}
          <div className="login-card animate-slideup-delay-2 p-8 space-y-6">
            <div className="text-center space-y-3">
              <h1 className="text-3xl font-bold text-slate-900">Welcome Back</h1>
              <p className="focus-text text-base">
                Enter your credentials to continue
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-semibold text-slate-700">
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  placeholder="admin@opspulse.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="input-field w-full text-slate-900"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-semibold text-slate-700">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="input-field w-full text-slate-900"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 animate-pulse">
                  <p className="text-sm text-red-600 font-medium">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="login-btn w-full"
              >
                {loading ? "Signing in..." : "Sign In"}
              </button>
            </form>
          </div>

          {/* Footer */}
          <p className="text-center text-xs text-blue-200 animate-slideup-delay-2">
            Developed by Business Dev Team
          </p>
        </div>
      </div>
    </>
  );
}
