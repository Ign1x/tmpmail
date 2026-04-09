/* eslint-disable @next/next/no-img-element */
"use client"

import type { ImgHTMLAttributes } from "react"

import { useBranding } from "@/contexts/branding-context"
import { cn } from "@/lib/utils"

type BrandMarkProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  srcOverride?: string
}

export default function BrandMark({
  alt,
  className,
  srcOverride,
  ...props
}: BrandMarkProps) {
  const { brandLogoUrl, brandName } = useBranding()

  return (
    <img
      src={srcOverride || brandLogoUrl}
      alt={alt ?? `${brandName} logo`}
      className={cn("object-contain", className)}
      draggable={false}
      {...props}
    />
  )
}
