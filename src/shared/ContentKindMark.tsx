import Icon from './Icon';

/**
 * #307: what a card is, said by an icon and a word and a colour together, so articles and works
 * can be told apart without relying on colour alone (WCAG 1.4.1). The colour comes from the kind,
 * not from the card's tag hue, so every article chip looks the same and every work chip does too.
 */
export default function ContentKindMark({ kind }: { kind: 'article' | 'project' }) {
  return (
    <span className={`content-card-kind content-card-kind-${kind}`}>
      <Icon name={kind === 'article' ? 'doc' : 'cube'} size={14} />
      {kind === 'article' ? '記事' : '作品'}
    </span>
  );
}
