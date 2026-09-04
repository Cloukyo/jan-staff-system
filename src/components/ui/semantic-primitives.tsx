import { useId, type ReactNode } from "react";

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

type AlertProps = {
  tone: SemanticTone;
  title: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function Alert({
  tone,
  title,
  children,
  action,
  className = "",
}: AlertProps) {
  const titleId = useId();
  return (
    <section
      className={`ui-alert ui-alert--${tone} ${className}`.trim()}
      data-semantic-tone={tone}
      role={tone === "blocking" ? "alert" : "region"}
      aria-labelledby={titleId}
    >
      <div className="ui-alert__content">
        <h2 id={titleId} className="ui-alert__title">{title}</h2>
        <div className="ui-alert__body">{children}</div>
      </div>
      {action ? <div className="ui-alert__action">{action}</div> : null}
    </section>
  );
}

type InlineFeedbackProps = {
  status: "pending" | "success" | "error";
  children: ReactNode;
  className?: string;
};

export function InlineFeedback({
  status,
  children,
  className = "",
}: InlineFeedbackProps) {
  const isError = status === "error";
  return (
    <p
      className={`ui-inline-feedback ui-inline-feedback--${status} ${className}`.trim()}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
    >
      {children}
    </p>
  );
}

export type ActionSummaryItem = {
  key: string;
  label: string;
  count: number;
  tone: SemanticTone;
  href?: string;
  actionLabel?: string;
};

type ActionSummaryProps = {
  title: string;
  items: ActionSummaryItem[];
  className?: string;
};

export function ActionSummary({
  title,
  items,
  className = "",
}: ActionSummaryProps) {
  const titleId = useId();
  return (
    <section
      className={`ui-action-summary ${className}`.trim()}
      aria-labelledby={titleId}
    >
      <h2 id={titleId} className="ui-action-summary__title">{title}</h2>
      <ol className="ui-action-summary__list">
        {items.map((item) => (
          <li
            key={item.key}
            className={`ui-action-summary__item ui-action-summary__item--${item.tone}`}
            data-semantic-tone={item.tone}
          >
            <span className="ui-action-summary__count">{item.count}</span>
            <span className="ui-action-summary__label">{item.label}</span>
            {item.href && item.actionLabel ? (
              <a className="ui-action-summary__action" href={item.href}>
                {item.actionLabel}
              </a>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
