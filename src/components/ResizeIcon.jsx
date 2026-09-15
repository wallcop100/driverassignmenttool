// Three Material Symbols (Outlined, Apache 2.0) the bundled classic icon font does
// not have, inline so no second icon font is loaded. Drawn inside an <svg>, so
// they sit in the space layout's own drawing.
const PATHS = {
  fit_width: 'M120-120v-720h80v720h-80Zm640 0v-720h80v720h-80ZM280-440v-80h80v80h-80Zm160 0v-80h80v80h-80Zm160 0v-80h80v80h-80Z',
  height: 'M480-120 320-280l56-56 64 63v-414l-64 63-56-56 160-160 160 160-56 57-64-64v414l64-63 56 56-160 160Z',
  arrows_outward: 'm680-280-56-56 103-104H520v-80h207L624-624l56-56 200 200-200 200Zm-400 0L80-480l200-200 56 56-103 104h207v80H233l103 104-56 56Z',
};

export default function ResizeIcon({ name, size = 16, x = 0, y = 0 }) {
  return (
    <svg className="resize-icon" x={x} y={y} width={size} height={size} viewBox="0 -960 960 960" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
