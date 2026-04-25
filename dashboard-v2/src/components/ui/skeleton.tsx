import { cn } from "@/lib/utils";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-gradient-to-r from-ink-100 via-ink-200 to-ink-100 bg-[length:400%_100%]",
        className,
      )}
      style={{
        animation: "skeleton-shine 1.6s ease-in-out infinite",
      }}
      {...props}
    />
  );
}
