import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-ink-200 bg-ink-50 text-ink-700",
        brand: "border-brand-200 bg-brand-50 text-brand-700",
        success: "border-emerald-200 bg-emerald-50 text-emerald-700",
        warning: "border-amber-200 bg-amber-50 text-amber-700",
        danger: "border-red-200 bg-red-50 text-red-700",
        info: "border-cyan-200 bg-cyan-50 text-cyan-700",
        fire: "border-orange-300 bg-gradient-to-r from-orange-50 to-amber-50 text-orange-700 shadow-sm",
        outline: "border-ink-300 bg-transparent text-ink-700",
        score: "border-transparent bg-brand-600 text-white font-mono font-semibold",
      },
      size: {
        sm: "px-2 py-0 text-[10.5px]",
        md: "px-2.5 py-0.5 text-xs",
        lg: "px-3 py-1 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({ className, variant, size, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size, className }))} {...props}>
      {dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            variant === "success" && "bg-emerald-500",
            variant === "warning" && "bg-amber-500",
            variant === "danger" && "bg-red-500",
            variant === "info" && "bg-cyan-500",
            variant === "brand" && "bg-brand-500",
            variant === "fire" && "bg-orange-500",
            (!variant || variant === "default" || variant === "outline") && "bg-ink-500",
          )}
        />
      )}
      {children}
    </span>
  );
}

export { badgeVariants };
