import { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: number | string;
}

export default function Card({ padding = 24, className = "", style, ...props }: CardProps) {
  const paddingValue = typeof padding === "number" ? `${padding}px` : padding;
  return (
    <div
      className={`rounded-[var(--radius-admin-card)] border border-admin-border bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] ${className}`}
      style={{ padding: paddingValue, ...style }}
      {...props}
    />
  );
}
