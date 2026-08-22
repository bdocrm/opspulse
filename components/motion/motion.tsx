import * as React from "react";
import { cn } from "@/lib/utils";
import { motionClass } from "@/lib/motion";

type MotionElementProps = React.HTMLAttributes<HTMLDivElement> & {
  delay?: number;
};

type MotionStyle = React.CSSProperties & { "--motion-delay"?: string };

function withDelay(style: React.CSSProperties | undefined, delay = 0): MotionStyle {
  return { ...style, "--motion-delay": `${delay}ms` };
}

export const AnimatedPage = React.forwardRef<HTMLDivElement, MotionElementProps>(
  ({ className, delay, style, ...props }, ref) => (
    <div ref={ref} className={cn(motionClass.page, className)} style={withDelay(style, delay)} {...props} />
  )
);
AnimatedPage.displayName = "AnimatedPage";

export const AnimatedSection = React.forwardRef<HTMLDivElement, MotionElementProps>(
  ({ className, delay, style, ...props }, ref) => (
    <div ref={ref} className={cn(motionClass.fadeUp, className)} style={withDelay(style, delay)} {...props} />
  )
);
AnimatedSection.displayName = "AnimatedSection";

export const AnimatedCard = React.forwardRef<HTMLDivElement, MotionElementProps>(
  ({ className, delay, style, ...props }, ref) => (
    <div ref={ref} className={cn(motionClass.card, className)} style={withDelay(style, delay)} {...props} />
  )
);
AnimatedCard.displayName = "AnimatedCard";

export const AnimatedList = React.forwardRef<HTMLDivElement, MotionElementProps>(
  ({ className, delay, style, ...props }, ref) => (
    <div ref={ref} className={cn(motionClass.staggerContainer, className)} style={withDelay(style, delay)} {...props} />
  )
);
AnimatedList.displayName = "AnimatedList";
