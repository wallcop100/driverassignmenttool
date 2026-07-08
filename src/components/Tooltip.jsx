// Proper hover UI (not the browser's native title box). The popup's visibility
// is driven entirely by CSS (:hover) with a dwell delay — see .tt-anchor/.tt-pop
// in styles.css — so it doesn't flash on every block the cursor sweeps past
// while dragging, and there's no timer/state to clean up.
export default function Tooltip({ content, placement = 'bottom', children }) {
  const lines = Array.isArray(content) ? content : content ? [content] : [];
  if (!lines.length) return children;

  return (
    <span className="tt-anchor">
      {children}
      <span className={`tt-pop tt-${placement}`} role="tooltip">
        {lines.map((line, i) => <span key={i} className="tt-line">{line}</span>)}
      </span>
    </span>
  );
}
