import { useState } from 'react';

// Proper hover UI (not the browser's native title box). Wraps its child in a
// positioned span; content can be a string (rendered as-is) or an array of
// strings (one per line — used for flag message lists).
export default function Tooltip({ content, placement = 'bottom', children }) {
  const [show, setShow] = useState(false);
  const lines = Array.isArray(content) ? content : content ? [content] : [];
  if (!lines.length) return children;

  return (
    <span className="tt-anchor"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}>
      {children}
      {show && (
        <span className={`tt-pop tt-${placement}`} role="tooltip">
          {lines.map((line, i) => <span key={i} className="tt-line">{line}</span>)}
        </span>
      )}
    </span>
  );
}
