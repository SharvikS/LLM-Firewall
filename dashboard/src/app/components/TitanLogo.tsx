import React from 'react';

// TitanLogo — the TITAN Gateway mark: a shield enclosing an upward arrow rising
// out of ascending bars (data flowing up, protected). Stroke uses currentColor
// so it inherits text colour and adapts to the theme, matching the lucide icon
// set used across the dashboard.
export function TitanLogo({ className = 'w-4 h-4', strokeWidth = 1.9, style }: {
  className?: string; strokeWidth?: number; style?: React.CSSProperties;
}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" className={className} style={style}
      aria-hidden="true">
      {/* Shield */}
      <path d="M12 2.5 20 6v6c0 4.6-3.4 8-8 9.5C7.4 20 4 16.6 4 12V6l8-3.5Z" />
      {/* Upward arrow */}
      <path d="M8.6 11.2 12 7.8l3.4 3.4" />
      <path d="M12 7.8v8.4" />
      {/* Ascending side bars */}
      <path d="M8.8 13.4v2.8" />
      <path d="M15.2 12.6v3.6" />
    </svg>
  );
}

export default TitanLogo;
