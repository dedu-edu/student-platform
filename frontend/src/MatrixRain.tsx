import { useEffect, useRef } from "react";

const GLYPHS =
  "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789";

const FONT_SIZE = 16;   // px per cell
const TRAIL = 14;       // glyphs in each falling trail
const FPS = 16;         // low on purpose: calm, cheap
const MAX_ALPHA = 0.32; // keep it a "hint" behind the UI

export default function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let cols = 0;
    let rows = 0;
    let heads: number[] = [];
    let speeds: number[] = [];
    let frame = 0;
    let last = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${FONT_SIZE}px "Courier New", monospace`;
      ctx.textBaseline = "top";
      cols = Math.ceil(window.innerWidth / FONT_SIZE);
      rows = Math.ceil(window.innerHeight / FONT_SIZE);
      heads = Array.from({ length: cols }, () => Math.random() * -rows);
      speeds = Array.from({ length: cols }, () => 0.3 + Math.random() * 0.7);
    };

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 1000 / FPS) return;
      last = now;

      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      const seed = Math.floor(now / 450); // glyphs shimmer slowly

      for (let c = 0; c < cols; c++) {
        heads[c] += speeds[c];
        const headRow = Math.floor(heads[c]);

        for (let k = 0; k < TRAIL; k++) {
          const row = headRow - k;
          if (row < 0 || row > rows) continue;
          const glyph = GLYPHS[(c * 31 + row * 17 + seed) % GLYPHS.length];
          const fade = 1 - k / TRAIL;
          ctx.fillStyle =
            k === 0
              ? `rgba(214, 255, 243, ${MAX_ALPHA + 0.2})`
              : `rgba(143, 209, 192, ${fade * MAX_ALPHA})`;
          ctx.fillText(glyph, c * FONT_SIZE, row * FONT_SIZE);
        }

        if (headRow - TRAIL > rows) {
          heads[c] = Math.random() * -rows * 0.6;
          speeds[c] = 0.3 + Math.random() * 0.7;
        }
      }
    };

    resize();
    frame = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="matrix-rain" aria-hidden="true" />;
}
