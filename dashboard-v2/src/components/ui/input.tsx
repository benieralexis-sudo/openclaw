import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, invalid, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "flex h-10 w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 transition-colors",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink-900",
          "placeholder:text-ink-400",
          "hover:border-ink-300",
          "focus-visible:outline-none focus-visible:border-brand-500 focus-visible:ring-4 focus-visible:ring-brand-500/10",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-ink-50",
          invalid && "border-red-300 focus-visible:border-red-500 focus-visible:ring-red-500/10",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
