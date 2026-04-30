"use client";

import Image from "next/image";
import { useEffect, useId, useState } from "react";

type Props = {
  className?: string;
  width?: number;
};

const OFFICIAL_PATHS = ["/stockholm-2026-logo-horizontal.png", "/stockholm-2026-logo.png"];

/**
 * Visar vektor direkt (samma upplägg som er logga). Om ni lägger er officiella fil i
 * `public/stockholm-2026-logo.png` byts den in automatiskt efter första kontrollen.
 */
export function Stockholm2026Logo({ className = "", width = 300 }: Props) {
  const [useOfficialRaster, setUseOfficialRaster] = useState(false);
  const [officialPath, setOfficialPath] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      for (const path of OFFICIAL_PATHS) {
        try {
          const res = await fetch(path, { method: "HEAD", cache: "no-store" });
          if (res.ok) {
            if (!cancelled) {
              setOfficialPath(path);
              setUseOfficialRaster(true);
            }
            return;
          }
        } catch {
          // Try next candidate.
        }
      }
    };
    check().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (useOfficialRaster) {
    return (
      <Image
        src={officialPath}
        alt="Stockholm 2026"
        width={width}
        height={Math.round((width * 130) / 320)}
        className={`h-auto max-w-full ${className}`}
        priority
        unoptimized
      />
    );
  }

  return <Stockholm2026LogoVector className={className} width={width} />;
}

function Stockholm2026LogoVector({ className = "", width = 300 }: Props) {
  const roofId = useId().replace(/:/g, "");
  const height = Math.round((width * 130) / 320);
  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox="0 0 320 130"
      role="img"
      aria-label="Stockholm 2026"
    >
      <defs>
        <linearGradient id={roofId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#0a5fd4" />
          <stop offset="100%" stopColor="#007FFF" />
        </linearGradient>
      </defs>

      <rect width="320" height="130" fill="#000000" rx="10" />

      <circle cx="46" cy="34" r="16" fill="#FFD200" stroke="#F58220" strokeWidth="2" />

      <path d="M72 92 L72 54 L98 54 L98 92 Z" fill="#F58220" />
      <path d="M72 54 L85 44 L98 54 Z" fill={`url(#${roofId})`} />
      <g fill="#000000">
        <rect x="76" y="60" width="7" height="7" rx="0.5" />
        <rect x="87" y="60" width="7" height="7" rx="0.5" />
        <rect x="76" y="71" width="7" height="7" rx="0.5" />
        <rect x="87" y="71" width="7" height="7" rx="0.5" />
        <rect x="76" y="82" width="7" height="7" rx="0.5" />
        <rect x="87" y="82" width="7" height="7" rx="0.5" />
      </g>

      <path d="M102 92 L102 36 L142 36 L142 92 Z" fill="#FFD200" />
      <path d="M102 36 Q122 16 142 36 Z" fill={`url(#${roofId})`} />
      <circle cx="122" cy="26" r="3.5" fill="#000000" />
      <g fill="#000000">
        <rect x="108" y="46" width="7" height="7" rx="0.5" />
        <rect x="118" y="46" width="7" height="7" rx="0.5" />
        <rect x="128" y="46" width="7" height="7" rx="0.5" />
        <rect x="108" y="57" width="7" height="7" rx="0.5" />
        <rect x="118" y="57" width="7" height="7" rx="0.5" />
        <rect x="128" y="57" width="7" height="7" rx="0.5" />
        <rect x="108" y="68" width="7" height="7" rx="0.5" />
        <rect x="118" y="68" width="7" height="7" rx="0.5" />
        <rect x="128" y="68" width="7" height="7" rx="0.5" />
      </g>

      <path d="M66 92 L150 92 L146 100 L70 100 Z" fill="#062654" />
      <rect x="98" y="86" width="24" height="6" fill="#007FFF" rx="1" />

      <path
        d="M58 108 C78 100 98 108 118 108 C138 108 158 100 178 108"
        fill="none"
        stroke="#007FFF"
        strokeWidth="5"
        strokeLinecap="round"
      />

      <text
        x="168"
        y="56"
        fill="#007FFF"
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
        fontSize="20"
        fontWeight="800"
        letterSpacing="0.06em"
      >
        STOCKHOLM
      </text>
      <text
        x="168"
        y="92"
        fill="#F58220"
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
        fontSize="34"
        fontWeight="800"
        letterSpacing="0.02em"
      >
        2026
      </text>
    </svg>
  );
}
