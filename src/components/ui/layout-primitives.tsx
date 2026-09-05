import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className = "",
}: PageHeaderProps) {
  return (
    <header className={`ui-page-header ${className}`.trim()}>
      <div className="ui-page-header__copy">
        {eyebrow ? <p className="ui-page-header__eyebrow">{eyebrow}</p> : null}
        <h1 className="ui-page-header__title">{title}</h1>
        {description ? (
          <div className="ui-page-header__description">{description}</div>
        ) : null}
      </div>
      {actions ? <div className="ui-page-header__actions">{actions}</div> : null}
    </header>
  );
}

type FormActionsProps = {
  primary: ReactNode;
  secondary?: ReactNode;
  destructive?: ReactNode;
  className?: string;
};

export function FormActions({
  primary,
  secondary,
  destructive,
  className = "",
}: FormActionsProps) {
  return (
    <div className={`ui-form-actions ${className}`.trim()}>
      {secondary ? <div className="ui-form-actions__secondary">{secondary}</div> : null}
      {destructive ? <div className="ui-form-actions__destructive">{destructive}</div> : null}
      <div className="ui-form-actions__primary">{primary}</div>
    </div>
  );
}

type DetailDisclosureProps = {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
};

export function DetailDisclosure({
  summary,
  children,
  defaultOpen = false,
  className = "",
}: DetailDisclosureProps) {
  return (
    <details className={`ui-detail-disclosure ${className}`.trim()} open={defaultOpen}>
      <summary className="ui-detail-disclosure__summary">{summary}</summary>
      <div className="ui-detail-disclosure__content">{children}</div>
    </details>
  );
}

type ResponsiveDataViewProps = {
  label: string;
  desktop: ReactNode;
  mobile: ReactNode;
  className?: string;
};

export function ResponsiveDataView({
  label,
  desktop,
  mobile,
  className = "",
}: ResponsiveDataViewProps) {
  return (
    <section
      className={`ui-responsive-data ${className}`.trim()}
      aria-label={label}
    >
      <div className="ui-responsive-data__desktop">{desktop}</div>
      <div className="ui-responsive-data__mobile">{mobile}</div>
    </section>
  );
}
