import { useEffect, useState } from 'react';
import Icon from './Icon';
import './celebration.css';

const COLORS = ['#23964a', '#5fc47c', '#ff7a45', '#2f7bf5', '#ffc53d'];
const PIECES = Array.from({ length: 18 }, (_, i) => ({
  angle: (360 / 18) * i + (i % 3) * 7,
  distance: 90 + (i % 4) * 28,
  color: COLORS[i % COLORS.length],
  delay: (i % 5) * 30,
}));

/**
 * A short burst when something is published: one more square of grass. Decorative only —
 * the outcome is announced by the surrounding status text, and reduced motion skips it.
 */
export default function Celebration({ duration = 2200 }: { duration?: number }) {
  const [shown, setShown] = useState(
    () =>
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function' ||
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (!shown) return;
    const timer = window.setTimeout(() => setShown(false), duration);
    return () => window.clearTimeout(timer);
  }, [shown, duration]);
  if (!shown) return null;
  return (
    <div className="celebration" aria-hidden="true">
      <span className="celebration-badge">
        <Icon name="sprout" size={28} />
        +1
      </span>
      {PIECES.map((piece, i) => (
        <span
          key={i}
          className="celebration-piece"
          style={
            {
              '--angle': `${piece.angle}deg`,
              '--distance': `${piece.distance}px`,
              background: piece.color,
              animationDelay: `${piece.delay}ms`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
