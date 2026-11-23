import Icon from './Icon';
import './empty-sprout.css';

/**
 * The mark for "nothing here yet": a small sprout, in the same green and warm tones as the
 * grass and the publish celebration, so an empty list reads as a place where something will
 * grow rather than a dead end. Decorative only — the heading beside it carries the meaning.
 */
export default function EmptySprout() {
  return (
    <span className="empty-sprout" aria-hidden="true">
      <Icon name="sprout" size={32} />
    </span>
  );
}
