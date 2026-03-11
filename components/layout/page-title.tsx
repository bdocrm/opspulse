"use client";

import Image from "next/image";

interface PageTitleProps {
  title: string;
  subtitle?: string;
}

export function PageTitle({ title, subtitle }: PageTitleProps) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <Image
        src="/ops.png"
        alt="OpsPulse 360"
        width={28}
        height={28}
        className="h-7 w-7 object-contain hidden sm:block"
      />
      <div>
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">{title}</h2>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}
