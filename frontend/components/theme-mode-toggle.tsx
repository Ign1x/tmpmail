"use client"

import { Button } from "@heroui/button"
import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from "@heroui/dropdown"
import { ChevronDown, Monitor, Moon, Sun } from "lucide-react"
import { useTranslations } from "next-intl"
import { useTheme } from "next-themes"

import { useHydrated } from "@/hooks/use-hydrated"
import { cn } from "@/lib/utils"

type ThemeMode = "system" | "light" | "dark"

interface ThemeModeToggleProps {
  buttonClassName?: string
  fullWidth?: boolean
  showLabel?: boolean
  size?: "sm" | "md" | "lg"
  variant?: "light" | "flat" | "bordered" | "solid" | "shadow" | "ghost" | "faded"
}

function getThemeIcon(mode: ThemeMode) {
  switch (mode) {
    case "light":
      return Sun
    case "dark":
      return Moon
    default:
      return Monitor
  }
}

function renderThemeIcon(mode: ThemeMode, size: number) {
  const Icon = getThemeIcon(mode)
  return <Icon size={size} />
}

export default function ThemeModeToggle({
  buttonClassName,
  fullWidth = false,
  showLabel = false,
  size = "sm",
  variant = "light",
}: ThemeModeToggleProps) {
  const t = useTranslations("theme")
  const { theme, setTheme } = useTheme()
  const hydrated = useHydrated()

  const currentTheme: ThemeMode =
    hydrated && (theme === "light" || theme === "dark" || theme === "system")
      ? theme
      : "system"
  const currentLabel =
    currentTheme === "light"
      ? t("light")
      : currentTheme === "dark"
        ? t("dark")
        : t("system")

  return (
    <Dropdown placement="bottom-end">
      <DropdownTrigger>
        <Button
          isIconOnly={!showLabel}
          size={size}
          variant={variant}
          aria-label={t("menuButton", { mode: currentLabel })}
          className={cn(fullWidth && "w-full justify-between", buttonClassName)}
          startContent={showLabel ? renderThemeIcon(currentTheme, 16) : undefined}
          endContent={showLabel ? <ChevronDown size={15} className="text-slate-400" /> : undefined}
        >
          {showLabel ? currentLabel : renderThemeIcon(currentTheme, 18)}
        </Button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label={t("menuAriaLabel")}
        disallowEmptySelection
        selectionMode="single"
        selectedKeys={new Set([currentTheme])}
        onAction={(key) => setTheme(String(key) as ThemeMode)}
      >
        <DropdownItem key="system" startContent={<Monitor size={16} />}>
          {t("system")}
        </DropdownItem>
        <DropdownItem key="light" startContent={<Sun size={16} />}>
          {t("light")}
        </DropdownItem>
        <DropdownItem key="dark" startContent={<Moon size={16} />}>
          {t("dark")}
        </DropdownItem>
      </DropdownMenu>
    </Dropdown>
  )
}
