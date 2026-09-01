"use client";

import { CSSProperties, ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface CountUpProps {
  value: number;
  duration?: number;
  className?: string;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  format?: (value: number) => string;
}

export function CountUp({ value, duration = 800, className, decimals = 0, prefix = "", suffix = "", format }: CountUpProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const previousValue = useRef(0);
  const hasAnimated = useRef(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const startValue = hasAnimated.current ? previousValue.current : 0;

    if (reducedMotion || duration <= 0 || startValue === value) {
      setDisplayValue(value);
      previousValue.current = value;
      hasAnimated.current = true;
      return;
    }

    let animationFrame = 0;
    const startedAt = performance.now();
    const update = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const interpolatedValue = startValue + (value - startValue) * easedProgress;
      setDisplayValue(Number(interpolatedValue.toFixed(decimals)));

      if (progress < 1) animationFrame = requestAnimationFrame(update);
      else {
        previousValue.current = value;
        hasAnimated.current = true;
      }
    };

    animationFrame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animationFrame);
  }, [decimals, duration, value]);

  const render = (input: number) =>
    format
      ? format(input)
      : `${prefix}${input.toLocaleString(undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })}${suffix}`;
  const formattedValue = render(displayValue);
  const accessibleValue = render(value);

  return (
    <>
      <span className={cn("tabular-nums", className)} aria-hidden="true">
        {formattedValue}
      </span>
      <span className="sr-only">{accessibleValue}</span>
    </>
  );
}

interface ViewportRevealGroupProps {
  children: ReactNode;
  className?: string;
  initialDelay?: number;
}

export function ViewportRevealGroup({ children, className, initialDelay = 0 }: ViewportRevealGroupProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const hasInitialized = useRef(false);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    const items = Array.from(group.querySelectorAll<HTMLElement>("[data-reveal-item]"));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion || !("IntersectionObserver" in window)) {
      items.forEach((item) => item.setAttribute("data-revealed", "true"));
      return;
    }

    let observer: IntersectionObserver | undefined;
    const observeItems = () => {
      observer = new IntersectionObserver(
        (entries) => {
          const visibleEntries = entries
            .filter((entry) => entry.isIntersecting)
            .sort(
              (first, second) =>
                first.boundingClientRect.top - second.boundingClientRect.top ||
                first.boundingClientRect.left - second.boundingClientRect.left
            );

          visibleEntries.forEach((entry, index) => {
            const item = entry.target as HTMLElement;
            item.style.setProperty("--reveal-delay", `${Math.min(index, 5) * 40}ms`);
            item.setAttribute("data-revealed", "true");
            observer?.unobserve(item);
          });
        },
        { rootMargin: "0px 0px 72px", threshold: 0.08 }
      );

      items.forEach((item) => observer?.observe(item));
    };

    const delay = hasInitialized.current ? 0 : initialDelay;
    hasInitialized.current = true;
    const timer = window.setTimeout(observeItems, delay);

    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [children, initialDelay]);

  return (
    <div ref={groupRef} className={className}>
      {children}
    </div>
  );
}

type MotionDelayStyle = CSSProperties & { "--motion-delay": string };

export function motionDelay(delay: number): MotionDelayStyle {
  return { "--motion-delay": `${delay}ms` };
}
