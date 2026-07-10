"use client";

import { useEffect, useRef } from "react";
import { effectsEnabled, FX_EVENT } from "@/lib/client/effects";

export default function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    /* v8 ignore next -- the ref is always attached to the <canvas> rendered below */
    const canvas = canvasRef.current;
    /* v8 ignore next -- same: `canvas` is never null here */
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*()+=<>?/|\\ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺ";
    const fontSize = 13;
    const drops: number[] = [];

    // Widening the window must add columns: the drop array is resized here, not
    // in draw(), where recomputing it had no effect on the (fixed-length) loop.
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const columns = Math.max(0, Math.floor(canvas.width / fontSize));
      while (drops.length < columns) drops.push(1);
      drops.length = columns;
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      ctx.fillStyle = "rgba(10, 10, 10, 0.055)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#00ff41";
      ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;

      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillStyle = i % 5 === 0 ? "#00ff41" : "rgba(0,255,65,0.55)";
        ctx.fillText(char, i * fontSize, drops[i]! * fontSize);

        if (drops[i]! * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i] = drops[i]! + 1;
      }
    };

    // Start/stop the animation in response to the effects setting + reduced-motion.
    let interval: ReturnType<typeof setInterval> | null = null;
    const clearCanvas = () => ctx.clearRect(0, 0, canvas.width, canvas.height);
    const apply = () => {
      const on = effectsEnabled();
      if (on && interval === null) {
        interval = setInterval(draw, 55);
      } else if (!on && interval !== null) {
        clearInterval(interval);
        interval = null;
        clearCanvas();
      }
    };
    apply();

    window.addEventListener(FX_EVENT, apply);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    /* v8 ignore next -- `?.` guards pre-2020 Safari, which lacks MediaQueryList.addEventListener */
    mq.addEventListener?.("change", apply);

    return () => {
      if (interval !== null) clearInterval(interval);
      window.removeEventListener("resize", resize);
      window.removeEventListener(FX_EVENT, apply);
      /* v8 ignore next -- same pre-2020 Safari guard as addEventListener above */
      mq.removeEventListener?.("change", apply);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ opacity: 0.07 }}
      aria-hidden="true"
    />
  );
}
