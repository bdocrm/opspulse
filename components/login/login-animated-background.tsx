"use client";

import { useEffect, useRef } from "react";

type ParticleKind = "dot" | "plus" | "line";

type Particle = {
  className: string;
  kind: ParticleKind;
};

const desktopParticles: Particle[] = [
  { kind: "dot", className: "left-[8%] top-[14%] [--particle-delay:-3s] [--particle-duration:19s] [--particle-x:28px] [--particle-y:-44px]" },
  { kind: "plus", className: "left-[22%] top-[9%] [--particle-delay:-12s] [--particle-duration:27s] [--particle-x:-22px] [--particle-y:-58px]" },
  { kind: "line", className: "left-[38%] top-[20%] [--particle-delay:-7s] [--particle-duration:23s] [--particle-x:36px] [--particle-y:-34px]" },
  { kind: "dot", className: "right-[17%] top-[13%] [--particle-delay:-15s] [--particle-duration:29s] [--particle-x:-38px] [--particle-y:-62px]" },
  { kind: "dot", className: "right-[6%] top-[31%] [--particle-delay:-1s] [--particle-duration:17s] [--particle-x:-20px] [--particle-y:-42px]" },
  { kind: "plus", className: "left-[12%] top-[44%] [--particle-delay:-18s] [--particle-duration:26s] [--particle-x:44px] [--particle-y:-52px]" },
  { kind: "line", className: "right-[28%] top-[46%] [--particle-delay:-9s] [--particle-duration:21s] [--particle-x:-32px] [--particle-y:-48px]" },
  { kind: "dot", className: "left-[31%] bottom-[28%] [--particle-delay:-5s] [--particle-duration:18s] [--particle-x:24px] [--particle-y:-56px]" },
  { kind: "dot", className: "right-[9%] bottom-[24%] [--particle-delay:-14s] [--particle-duration:25s] [--particle-x:-42px] [--particle-y:-36px]" },
  { kind: "plus", className: "left-[7%] bottom-[12%] [--particle-delay:-8s] [--particle-duration:22s] [--particle-x:34px] [--particle-y:-48px]" },
  { kind: "line", className: "left-[48%] bottom-[9%] hidden xl:block [--particle-delay:-20s] [--particle-duration:30s] [--particle-x:-26px] [--particle-y:-70px]" },
  { kind: "dot", className: "right-[37%] top-[8%] hidden xl:block [--particle-delay:-6s] [--particle-duration:24s] [--particle-x:30px] [--particle-y:-46px]" },
  { kind: "plus", className: "right-[4%] bottom-[8%] hidden xl:block [--particle-delay:-17s] [--particle-duration:28s] [--particle-x:-34px] [--particle-y:-64px]" },
  { kind: "dot", className: "left-[53%] top-[36%] hidden xl:block [--particle-delay:-11s] [--particle-duration:20s] [--particle-x:38px] [--particle-y:-40px]" },
];

const compactParticles: Particle[] = [
  { kind: "dot", className: "left-[10%] top-[13%] [--particle-delay:-4s] [--particle-duration:22s] [--particle-x:20px] [--particle-y:-36px]" },
  { kind: "plus", className: "right-[14%] top-[24%] [--particle-delay:-13s] [--particle-duration:28s] [--particle-x:-18px] [--particle-y:-44px]" },
  { kind: "line", className: "left-[18%] bottom-[24%] [--particle-delay:-8s] [--particle-duration:25s] [--particle-x:24px] [--particle-y:-42px]" },
  { kind: "dot", className: "right-[9%] bottom-[14%] [--particle-delay:-17s] [--particle-duration:30s] [--particle-x:-20px] [--particle-y:-38px]" },
  { kind: "dot", className: "left-[48%] top-[8%] [--particle-delay:-1s] [--particle-duration:20s] [--particle-x:18px] [--particle-y:-32px]" },
];

function DataParticle({ particle }: { particle: Particle }) {
  return (
    <span className={`login-data-particle absolute ${particle.className}`}>
      {particle.kind === "plus" ? (
        <span className="text-xs font-light leading-none text-blue-100/80">+</span>
      ) : particle.kind === "line" ? (
        <span className="block h-px w-4 bg-blue-100/70 shadow-[0_0_6px_rgba(147,197,253,0.28)]" />
      ) : (
        <span className="block h-1.5 w-1.5 rounded-full border border-blue-100/70 bg-blue-300/55 shadow-[0_0_10px_rgba(96,165,250,0.38)]" />
      )}
    </span>
  );
}

export function LoginAnimatedBackground({ compact = false }: { compact?: boolean }) {
  const parallaxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (compact) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(pointer: fine)");
    const desktopViewport = window.matchMedia("(min-width: 1024px)");
    if (reducedMotion.matches || !finePointer.matches || !desktopViewport.matches) return;

    const layer = parallaxRef.current;
    if (!layer) return;

    let frameId: number | null = null;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;

    const render = () => {
      currentX += (targetX - currentX) * 0.08;
      currentY += (targetY - currentY) * 0.08;
      layer.style.setProperty("--login-parallax-x", `${currentX.toFixed(2)}px`);
      layer.style.setProperty("--login-parallax-y", `${currentY.toFixed(2)}px`);

      if (Math.abs(targetX - currentX) > 0.05 || Math.abs(targetY - currentY) > 0.05) {
        frameId = window.requestAnimationFrame(render);
      } else {
        frameId = null;
      }
    };

    const scheduleRender = () => {
      if (frameId === null) frameId = window.requestAnimationFrame(render);
    };

    const handlePointerMove = (event: PointerEvent) => {
      targetX = ((event.clientX / window.innerWidth) - 0.5) * 20;
      targetY = ((event.clientY / window.innerHeight) - 0.5) * 14;
      scheduleRender();
    };

    const resetParallax = () => {
      targetX = 0;
      targetY = 0;
      scheduleRender();
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("blur", resetParallax);
    document.documentElement.addEventListener("pointerleave", resetParallax);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("blur", resetParallax);
      document.documentElement.removeEventListener("pointerleave", resetParallax);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [compact]);

  const particles = compact ? compactParticles : desktopParticles;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className={`login-grid-motion absolute inset-0 ${compact ? "opacity-[0.08] [background-image:linear-gradient(rgba(64,148,217,0.5)_1px,transparent_1px),linear-gradient(90deg,rgba(64,148,217,0.5)_1px,transparent_1px)] [background-size:44px_44px]" : "opacity-10 [background-image:linear-gradient(rgba(255,255,255,0.55)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.55)_1px,transparent_1px)] [background-size:44px_44px]"}`} />

      <div className="login-data-sweep absolute -bottom-[15%] -left-[30%] top-[-15%] w-[18%] bg-gradient-to-r from-transparent via-blue-300/[0.055] to-transparent blur-2xl" />

      <div ref={parallaxRef} className="login-parallax-layer absolute inset-0">
        {compact ? (
          <>
            <div className="login-glow-motion absolute -left-40 top-[18%] h-80 w-80 rounded-full bg-blue-500/10 blur-3xl" />
            <div className="login-glow-motion absolute -bottom-48 right-[-8rem] h-80 w-80 rounded-full bg-orange-400/[0.05] blur-3xl [animation-delay:-8s]" />
          </>
        ) : (
          <>
            <div className="login-glow-motion absolute -left-28 top-1/4 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
            <div className="login-glow-motion absolute right-[2%] top-[4%] h-64 w-64 rounded-full bg-indigo-500/[0.08] blur-3xl [animation-delay:-5s]" />
            <div className="login-glow-motion absolute -bottom-32 right-10 h-80 w-80 rounded-full bg-orange-500/[0.07] blur-3xl [animation-delay:-8s]" />
          </>
        )}
      </div>

      {!compact && (
        <svg className="login-connection-lines absolute inset-0 hidden h-full w-full xl:block" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M8 18 L24 11 L39 22" />
          <path d="M69 14 L84 31 L73 47" />
          <path d="M14 70 L32 78 L49 67" />
          <path className="login-connection-trace" d="M8 18 L24 11 L39 22" />
          <path className="login-connection-trace" d="M69 14 L84 31 L73 47" />
          <path className="login-connection-trace" d="M14 70 L32 78 L49 67" />
        </svg>
      )}

      <div className="absolute inset-0">
        {particles.map((particle, index) => <DataParticle key={`${particle.kind}-${index}`} particle={particle} />)}
      </div>
    </div>
  );
}
