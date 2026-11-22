import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useViewer } from '../shell/viewer';
import Icon from '../shared/Icon';

/**
 * Writing starts from a public profile. When the signed-in student has none yet, the writing
 * screens show one way forward instead of the editor (the server still decides every write).
 */
export default function ProfileFirst({
  csrfToken,
  bypass = false,
  children,
}: {
  csrfToken: string;
  /** Students who can no longer post keep their tidy-up tools without a profile. */
  bypass?: boolean;
  children: ReactNode;
}) {
  const { viewer } = useViewer();
  const mine = viewer.status === 'signed-in' && viewer.csrfToken === csrfToken;
  if (bypass || !mine || viewer.profile !== null) return <>{children}</>;
  return (
    <section className="profile-first" aria-labelledby="profile-first-heading">
      <span className="profile-first-mark" aria-hidden="true">
        <Icon name="user" size={32} />
      </span>
      <h2 id="profile-first-heading">まずプロフィールをつくろう</h2>
      <Link className="primary" to="/account#profile">
        <Icon name="arrowRight" size={18} />
        つくる
      </Link>
    </section>
  );
}
