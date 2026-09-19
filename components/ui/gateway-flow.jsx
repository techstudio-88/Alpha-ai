"use client";

import { useEffect, useRef } from "react";

export default function GatewayFlow({ className = "" }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    const ctx = canvas.getContext("2d");
    if (!ctx || !parent) return;

    let width = 0;
    let height = 0;
    let frame = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let paths = [];

    const resize = () => {
      const rect = parent.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.max(34, Math.min(74, Math.round(width / 16)));
      paths = Array.from({ length: count }, (_, index) => {
        const side = index % 2 === 0 ? -1 : 1;
        const normalized = Math.floor(index / 2) / Math.max(1, Math.ceil(count / 2) - 1);
        const y = height * (0.05 + normalized * 0.9);
        return {
          side,
          y,
          phase: Math.random(),
          speed: 0.0007 + Math.random() * 0.0012,
          offset: (Math.random() - 0.5) * 8,
        };
      });
    };

    const point = (t, side, y) => {
      const centerX = width * 0.5;
      const centerY = height * 0.5;
      const edgeX = side < 0 ? -width * 0.08 : width * 1.08;
      const nearX = side < 0 ? width * 0.26 : width * 0.74;

      const p0 = { x: edgeX, y };
      const p1 = { x: side < 0 ? width * 0.22 : width * 0.78, y };
      const p2 = { x: nearX, y: centerY + (y - centerY) * 0.58 };
      const p3 = { x: centerX, y: centerY };

      const u = 1 - t;
      return {
        x: u ** 3 * p0.x + 3 * u ** 2 * t * p1.x + 3 * u * t ** 2 * p2.x + t ** 3 * p3.x,
        y: u ** 3 * p0.y + 3 * u ** 2 * t * p1.y + 3 * u * t ** 2 * p2.y + t ** 3 * p3.y,
      };
    };

    const draw = (time) => {
      ctx.clearRect(0, 0, width, height);

      const centerX = width * 0.5;
      const centerY = height * 0.5;

      const vignette = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, width * 0.58);
      vignette.addColorStop(0, "rgba(255,255,255,0.035)");
      vignette.addColorStop(0.34, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.24)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);

      paths.forEach((path, pathIndex) => {
        const left = path.side < 0;
        const y = path.y + Math.sin(time * 0.00035 + pathIndex) * 1.7;
        const p0 = { x: left ? -width * 0.08 : width * 1.08, y };
        const p1 = { x: left ? width * 0.22 : width * 0.78, y + path.offset };
        const p2 = {
          x: left ? width * 0.78 : width * 0.22,
          y: centerY + (y - centerY) * 0.58,
        };
        const p3 = { x: centerX, y: centerY };

        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
        ctx.strokeStyle = "rgba(255,255,255,0.16)";
        ctx.lineWidth = 0.65;
        ctx.setLineDash([1, 5]);
        ctx.stroke();
        ctx.setLineDash([]);

        const particles = 3;
        for (let j = 0; j < particles; j += 1) {
          let t = (path.phase + time * path.speed + j / particles) % 1;
          const pos = point(t, path.side, y);

          const pulse = 0.55 + 0.45 * Math.sin(time * 0.004 + pathIndex * 1.7 + j);
          const radius = 0.75 + pulse * 0.75;

          ctx.fillStyle = `rgba(255,255,255,${0.45 + pulse * 0.35})`;
          ctx.fillRect(pos.x - radius, pos.y - radius, radius * 2, radius * 2);
        }
      });

      for (let i = 0; i < 70; i += 1) {
        const side = i % 2 === 0 ? -1 : 1;
        const spread = (i / 69) * 2 - 1;
        const pulse = (Math.sin(time * 0.0014 + i * 1.91) + 1) * 0.5;
        const radiusX = width * (0.07 + pulse * 0.015);
        const radiusY = height * (0.08 + pulse * 0.03);
        const x = centerX + side * radiusX;
        const y = centerY + spread * radiusY;

        ctx.fillStyle = `rgba(255,255,255,${0.18 + pulse * 0.3})`;
        ctx.fillRect(x, y, 1.4, 1.4);
      }

      const core = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 30);
      core.addColorStop(0, "rgba(255,255,255,0.75)");
      core.addColorStop(0.15, "rgba(255,255,255,0.22)");
      core.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = core;
      ctx.fillRect(centerX - 32, centerY - 32, 64, 64);

      frame = requestAnimationFrame(draw);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    resize();
    frame = requestAnimationFrame(draw);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      className={className}
      aria-hidden="true"
      style={{
        position: "relative",
        width: "min(1200px, 94vw)",
        height: "420px",
        margin: "10px auto 34px",
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,.12)",
        borderRadius: "16px",
        background: "#020202",
        boxShadow: "0 35px 110px rgba(0,0,0,.55), inset 0 1px rgba(255,255,255,.035)",
      }}
    >
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          borderRadius: "inherit",
          background:
            "linear-gradient(90deg,rgba(0,0,0,.22),transparent 18%,transparent 82%,rgba(0,0,0,.22)), radial-gradient(ellipse at center,transparent 34%,rgba(0,0,0,.28) 100%)",
        }}
      />
    </div>
  );
}
