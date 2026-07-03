"use client";

import { useEffect, useRef } from "react";
import { effectsEnabled, FX_EVENT } from "@/lib/client/effects";

export default function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*()+=<>?/|\\ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺ";
    const fontSize = 13;
    let columns = Math.floor(canvas.width / fontSize);
    const drops: number[] = Array(columns).fill(1);

    const draw = () => {
      columns = Math.floor(canvas.width / fontSize);
      ctx.fillStyle = "rgba(10, 10, 10, 0.055)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#00ff41";
      ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;

      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillStyle = i % 5 === 0 ? "#00ff41" : "rgba(0,255,65,0.55)";
        ctx.fillText(char, i * fontSize, (drops[i] ?? 1) * fontSize);

        if ((drops[i] ?? 1) * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i] = (drops[i] ?? 0) + 1;
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
    mq.addEventListener?.("change", apply);

    return () => {
      if (interval !== null) clearInterval(interval);
      window.removeEventListener("resize", resize);
      window.removeEventListener(FX_EVENT, apply);
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
