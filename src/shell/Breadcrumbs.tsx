import { Link } from 'react-router-dom';

export interface Crumb {
  label: string;
  to?: string;
}

/** The private area's levels (#270): ホーム › マイページ › each own screen, the same on every page. */
export const MY_PAGE_TRAIL: readonly Crumb[] = [
  { label: 'ホーム', to: '/' },
  { label: 'マイページ', to: '/account' },
];

/** The last item is where the reader is now; every earlier item is a link one level up. */
export default function Breadcrumbs({ items }: { items: readonly Crumb[] }) {
  return (
    <nav className="breadcrumbs" aria-label="現在地">
      <ol>
        {items.map((item, index) => (
          <li key={item.label}>
            {item.to && index < items.length - 1 ? (
              <Link to={item.to}>{item.label}</Link>
            ) : (
              <span aria-current="page">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
