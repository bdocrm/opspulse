import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("motion-skeleton rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
