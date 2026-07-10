"use client";

import { useRef, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
  /** Max tilt in degrees (default 6). */
  max?: number;
}

/**
 * Wraps children in a subtle 3D parallax-tilt surface that responds to the
 * cursor, with a moving glare highlight. Pure CSS-variable driven; respects
 * prefers-reduced-motion (the .tilt-card transform is disabled there).
 */
export default function Tilt3D({ children, className = "", max = 6 }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    /* v8 ignore next -- ref is always attached while the handler can fire; defensive */
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;   // 0..1
    const py = (e.clientY - r.top) / r.height;   // 0..1
    el.style.setProperty("--ry", `${(px - 0.5) * max * 2}deg`);
    el.style.setProperty("--rx", `${(0.5 - py) * max * 2}deg`);
    el.style.setProperty("--mx", `${px * 100}%`);
    el.style.setProperty("--my", `${py * 100}%`);
  }
  function onLeave() {
    const el = ref.current;
    /* v8 ignore next -- ref is always attached while the handler can fire; defensive */
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  }

  return (
    <div ref={ref} onMouseMove={onMove} onMouseLeave={onLeave} className={`tilt-card relative ${className}`}>
      {children}
      <div className="tilt-glare" />
    </div>
  );
}
