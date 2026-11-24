import './skeleton.css';

type Shape = 'cards' | 'rows' | 'detail';

/**
 * One loading placeholder for every reading screen (#272). It keeps roughly the size of what will
 * appear, so the page does not jump when the content arrives, and it shows nothing of that
 * content. The label is announced once; pass `announce={false}` where the screen already has its
 * own live status line, so the same wait is never read twice.
 */
export default function LoadingSkeleton({
  shape,
  label,
  count = 3,
  announce = true,
  className,
}: {
  shape: Shape;
  label: string;
  count?: number;
  announce?: boolean;
  className?: string;
}) {
  const items = Array.from({ length: count }, (_, index) => index);
  const body =
    shape === 'cards' ? (
      <div className="card-grid skeleton-cards">
        {items.map((key) => (
          <div key={key} className="skeleton-block skeleton-card" />
        ))}
      </div>
    ) : shape === 'rows' ? (
      <div className="skeleton-rows">
        {items.map((key) => (
          <div key={key} className="skeleton-row">
            <div className="skeleton-block skeleton-line" />
            <div className="skeleton-block skeleton-line skeleton-line-short" />
          </div>
        ))}
      </div>
    ) : (
      <div className="skeleton-detail">
        <div className="skeleton-block skeleton-heading" />
        <div className="skeleton-block skeleton-line skeleton-line-short" />
        {items.map((key) => (
          <div key={key} className="skeleton-block skeleton-line" />
        ))}
      </div>
    );
  return (
    <div
      className={'loading-skeleton' + (className ? ' ' + className : '')}
      {...(announce ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })}
      data-skeleton={shape}
    >
      {announce && <span className="sr-only">{label}</span>}
      <div aria-hidden="true">{body}</div>
    </div>
  );
}
