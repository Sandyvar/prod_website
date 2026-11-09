interface Props {
  size?: number;
  /** Play the intro: the check mark draws itself and a ring pulse ripples outward. */
  intro?: boolean;
  /** Small light dot orbiting the ring (7s per turn). */
  orbit?: boolean;
  className?: string;
  title?: string;
}

/**
 * Productivity logo: terracotta rounded square, white check inside a thin white ring (35% opacity),
 * with a small light dot orbiting the ring. Animations are CSS (see .logo-* in styles.css) and
 * switch off under prefers-reduced-motion. public/icon.svg is the static favicon version.
 */
export function Logo({ size = 34, intro = false, orbit = true, className, title }: Props) {
  return (
    <svg
      className={`logo-svg ${intro ? 'logo-intro' : ''} ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect width="64" height="64" rx="16" fill="#D97757" />
      {intro && <circle className="logo-pulse" cx="32" cy="32" r="19" fill="none" stroke="#FFE4D8" strokeWidth="2" />}
      <circle cx="32" cy="32" r="19" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="2" />
      <path
        className="logo-check"
        d="M23.5 32.5l6 6L41 26.5"
        fill="none"
        stroke="#fff"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
      />
      {orbit && (
        <g className="logo-orbit">
          <circle cx="32" cy="13" r="2.8" fill="#FFE4D8" />
        </g>
      )}
    </svg>
  );
}
