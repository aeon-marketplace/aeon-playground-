import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "green" | "amber" | "red" | "violet" | "cyan" | "slate" | "teal";

const toneClasses: Record<Tone, string> = {
  neutral: "border-white/12 bg-white/6 text-slate-200",
  green: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
  amber: "border-amber-400/25 bg-amber-400/10 text-amber-200",
  red: "border-red-400/25 bg-red-400/10 text-red-200",
  violet: "border-violet-400/25 bg-violet-400/10 text-violet-200",
  cyan: "border-cyan-400/25 bg-cyan-400/10 text-cyan-200",
  slate: "border-white/10 bg-black/30 text-slate-400",
  teal: "border-cyan-400/25 bg-cyan-400/10 text-cyan-200",
};

export function Badge({
  children,
  tone = "neutral",
  className,
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  className,
  strong = false,
}: {
  children: ReactNode;
  className?: string;
  strong?: boolean;
}) {
  return <div className={cn(strong ? "surface-strong" : "surface", className)}>{children}</div>;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-300/80">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Alert({
  title,
  children,
  tone = "amber",
  className,
}: {
  title?: string;
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  const styles: Record<Tone, string> = {
    neutral: "border-white/12 bg-white/5 text-slate-300",
    green: "border-emerald-400/25 bg-emerald-400/8 text-emerald-100",
    amber: "border-amber-400/25 bg-amber-400/8 text-amber-100",
    red: "border-red-400/30 bg-red-400/10 text-red-100",
    violet: "border-violet-400/25 bg-violet-400/8 text-violet-100",
    cyan: "border-cyan-400/25 bg-cyan-400/8 text-cyan-100",
    slate: "border-white/10 bg-black/20 text-slate-400",
    teal: "border-cyan-400/25 bg-cyan-400/8 text-cyan-100",
  };
  return (
    <div className={cn("rounded-xl border px-4 py-3 text-sm", styles[tone], className)}>
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div className="leading-6 opacity-90">{children}</div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/12 bg-white/[0.02] px-6 py-14 text-center">
      {icon ? (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-400/25 bg-blue-500/10 text-blue-300">
          {icon}
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-white">{title}</h3>
      {children ? (
        <div className="mt-2 max-w-lg text-sm leading-6 text-slate-400">{children}</div>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="surface px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
        {icon ? <span className="text-blue-300/70">{icon}</span> : null}
      </div>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function FieldLabel({
  htmlFor,
  children,
  hint,
}: {
  htmlFor?: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <label htmlFor={htmlFor} className="text-xs font-semibold text-slate-300">
        {children}
      </label>
      {hint ? <span className="text-[11px] text-slate-500">{hint}</span> : null}
    </div>
  );
}
