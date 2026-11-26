import Icon, { type IconName } from './Icon';
import {
  PROFILE_LINK_LABELS,
  validProfileLink,
  type ProfileLink,
  type ProfileLinkService,
} from './profile-links';
import './profile-links.css';

const icons: Record<ProfileLinkService, IconName> = {
  x: 'brandX',
  github: 'brandGithub',
  linkedin: 'brandLinkedin',
  website: 'globe',
};

/**
 * The X・GitHub・LinkedIn・website links a student added to their profile (#313), as icons.
 * Only registered services appear. Each opens in a new tab, and `nofollow ugc` marks it as a
 * link the student put there, not one the site vouches for.
 */
export default function ProfileLinks({ links, name }: { links: ProfileLink[]; name: string }) {
  const shown = links.filter(validProfileLink);
  if (!shown.length) return null;
  return (
    <ul className="profile-links" aria-label={`${name}さんのリンク`}>
      {shown.map((link) => {
        const label = `${PROFILE_LINK_LABELS[link.service]}（新しいタブで開きます）`;
        return (
          <li key={link.service}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              aria-label={label}
              title={`${PROFILE_LINK_LABELS[link.service]}: ${link.url}`}
            >
              <Icon name={icons[link.service]} size={20} />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
