import { useId } from 'react';

/**
 * Início's arrival mark — Rui, 14-11-2026: the Poolse icon where the tick was,
 * and it *locks into place*. The icon is its five blocks (`public/brand/
 * poolse-icon.svg` cut along its own steps, edges overlapping by a hair so no
 * seam shows); each slides in from its own side and snaps, the core first,
 * then the mark gives one small click and the two ripples go out, as the tick's
 * did. About a second.
 *
 * Decoration: the words below say where you are. The motion is CSS
 * (`.lock-*` in globals.css) and none of it runs under reduced motion — the
 * blocks are simply there.
 */
const BLOCKS: { x: number; y: number; w: number; h: number; dx: number; dy: number; order: number }[] = [
  // The core, between the notches.
  { x: 45.63, y: 48.04, w: 74.15, h: 50.66, dx: 0, dy: 0, order: 0 },
  // The left column, from the left.
  { x: 23.82, y: 23.53, w: 22.2, h: 105.14, dx: -70, dy: 0, order: 1 },
  // The top bar, from above.
  { x: 63.08, y: 20.8, w: 82.87, h: 29.96, dx: 0, dy: -70, order: 2 },
  // The right leg, from the right.
  { x: 109.42, y: 86.17, w: 36.53, h: 42.5, dx: 70, dy: 0, order: 3 },
  // The left foot, from below.
  { x: 45.63, y: 98.3, w: 30.53, h: 30.37, dx: 0, dy: 70, order: 4 },
];

export function LogoLockIn(): React.ReactElement {
  const gradient = `lock-depth-${useId().replace(/:/g, '')}`;
  return (
    <span aria-hidden className="relative inline-flex size-20 items-center justify-center">
      <span className="onboard-ripple lock-ripple absolute inset-0 rounded-full border-2 border-primary" />
      <span className="onboard-ripple lock-ripple onboard-ripple-late absolute inset-0 rounded-full border-2 border-primary" />
      <span className="lock-disc inline-flex size-20 items-center justify-center rounded-full bg-surface shadow-card">
        <svg viewBox="19.885 9.735 130 130" className="lock-mark size-11 overflow-visible">
          <defs>
            <linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1="0" y1="20.8" x2="0" y2="128.67">
              <stop offset="0" stopColor="#b3d49d" />
              <stop offset="1" stopColor="#67a6b6" />
            </linearGradient>
          </defs>
          {BLOCKS.map((block) => (
            <rect
              key={block.order}
              className="lock-block"
              x={block.x}
              y={block.y}
              width={block.w}
              height={block.h}
              fill={`url(#${gradient})`}
              style={
                {
                  '--dx': `${block.dx}px`,
                  '--dy': `${block.dy}px`,
                  '--d': block.order,
                } as React.CSSProperties
              }
            />
          ))}
          {/*
            The icon itself, whole, over the blocks: it appears the moment they
            lock, so no hairline seam is left where two blocks meet. Without
            motion it is simply there.
          */}
          <polygon
            className="lock-whole"
            fill={`url(#${gradient})`}
            points="109.42 98.72 76.16 98.69 76.16 128.67 23.82 128.67 23.82 23.53 45.63 23.52 45.63 48.04 63.07 48.04 63.08 20.8 145.95 20.8 145.95 50.76 119.78 50.76 119.78 86.17 145.95 86.17 145.95 128.67 109.42 128.67 109.42 98.72"
          />
        </svg>
      </span>
    </span>
  );
}
