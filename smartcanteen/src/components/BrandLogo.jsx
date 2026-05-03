export default function BrandLogo({ className = '', label = 'SmartCanteen' }) {
  return (
    <span
      className={`brand-logo-mark inline-flex shrink-0 items-center justify-center rounded-xl bg-primary text-white ${className}`}
      role="img"
      aria-label={`${label} logo`}
    >
      <svg
        className="brand-logo-icon"
        viewBox="0 0 48 48"
        fill="none"
        aria-hidden="true"
      >
        <rect
          x="11.5"
          y="14"
          width="25"
          height="20"
          rx="5"
          stroke="currentColor"
          strokeWidth="3"
        />
        <path
          d="M28.5 14v20M28.5 24h8"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle
          cx="20"
          cy="22"
          r="3.5"
          stroke="currentColor"
          strokeWidth="3"
        />
        <path
          d="M17 30h6"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
