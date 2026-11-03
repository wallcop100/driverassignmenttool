import { useState } from 'react';

// Proper hover UI (not the browser's native title box). The popup's visibility
// is driven entirely by CSS (:hover) with a dwell delay - see .tt-anchor/.tt-pop
// in styles.css - so it doesn't flash on every block the cursor sweeps past
// while dragging, and there's no timer/state to clean up.
// Placed fixed against the viewport on enter, so a scrolling card can't clip it (KJ3JBU).
export default function Tooltip({ content, placement = 'bottom', children }) {
  const [pos, setPos] = useState(null);
  const lines = Array.isArray(content) ? content : content ? [content] : [];
  if (!lines.length) return children;

  const place = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    // half the popup's max width, so it stays on screen at either edge
    const left = Math.min(Math.max(r.left + r.width / 2, 148), window.innerWidth - 148);
    // flip up when there is no room below
    const up = placement === 'top' || r.bottom + 160 > window.innerHeight;
    setPos({ up, style: up ? { position: 'fixed', left, bottom: window.innerHeight - r.top + 8 }
      : { position: 'fixed', left, top: r.bottom + 8 } });
  };

  return (
    <span className="tt-anchor" onMouseEnter={place} onFocus={place}>
      {children}
      <span className={`tt-pop tt-${pos ? (pos.up ? 'top' : 'bottom') : placement}`} role="tooltip" style={pos?.style}>
        {lines.map((line, i) => <span key={i} className="tt-line">{line}</span>)}
      </span>
    </span>
  );
}
