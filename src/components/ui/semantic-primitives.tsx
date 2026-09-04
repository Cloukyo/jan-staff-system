import type { ReactNode } from "react";

export type SemanticTone =
  | "neutral"
  | "information"
  | "success"
  | "attention"
  | "blocking";

type StatusBadgeProps = {
  tone: SemanticTone;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
};

export function StatusBadge({
  tone,
  children,
  icon,
  className = "",
}: StatusBadgeProps) {
  return (
    <span
      className={`ui-status-badge ui-status-badge--${tone} ${className}`.trim()}
      data-semantic-tone={tone}
    >
      {icon ? (
        <span aria-hidden="true" className="ui-status-badge__icon">
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
    </span>
  );
}
