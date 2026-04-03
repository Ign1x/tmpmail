"use client"

import type { ComponentProps } from "react"
import { clsx, type ClassValue } from "clsx"
import { Input as HeroInput, Textarea as HeroTextarea } from "@heroui/input"
import { Select as HeroSelect, SelectItem } from "@heroui/select"

import { TM_INPUT_CLASSNAMES, TM_SELECT_CLASSNAMES } from "@/components/heroui-field-styles"

type ClassNames = Record<string, ClassValue> | undefined

function mergeClassNames(defaults: ClassNames, provided: ClassNames): ClassNames {
  if (!defaults) {
    return provided
  }

  if (!provided) {
    return defaults
  }

  const keys = new Set([...Object.keys(defaults), ...Object.keys(provided)])

  return Array.from(keys).reduce<Record<string, string | undefined>>((result, key) => {
    const defaultValue = defaults[key]
    const providedValue = provided[key]

    result[key] = clsx(defaultValue, providedValue) || undefined
    return result
  }, {})
}

export function Input(props: ComponentProps<typeof HeroInput>) {
  const { classNames, disableAnimation, labelPlacement, variant, ...rest } = props

  return (
    <HeroInput
      {...rest}
      classNames={
        mergeClassNames(
          TM_INPUT_CLASSNAMES as Record<string, ClassValue>,
          classNames as Record<string, ClassValue> | undefined,
        ) as typeof classNames
      }
      disableAnimation={disableAnimation ?? true}
      labelPlacement={labelPlacement ?? "outside-top"}
      variant={variant ?? "bordered"}
    />
  )
}

export function Textarea(props: ComponentProps<typeof HeroTextarea>) {
  const { classNames, disableAnimation, labelPlacement, variant, ...rest } = props

  return (
    <HeroTextarea
      {...rest}
      classNames={
        mergeClassNames(
          TM_INPUT_CLASSNAMES as Record<string, ClassValue>,
          classNames as Record<string, ClassValue> | undefined,
        ) as typeof classNames
      }
      disableAnimation={disableAnimation ?? true}
      labelPlacement={labelPlacement ?? "outside-top"}
      variant={variant ?? "bordered"}
    />
  )
}

export function Select(props: ComponentProps<typeof HeroSelect>) {
  const { classNames, disableAnimation, labelPlacement, variant, ...rest } = props

  return (
    <HeroSelect
      {...rest}
      classNames={
        mergeClassNames(
          TM_SELECT_CLASSNAMES as Record<string, ClassValue>,
          classNames as Record<string, ClassValue> | undefined,
        ) as typeof classNames
      }
      disableAnimation={disableAnimation ?? true}
      labelPlacement={labelPlacement ?? "outside-top"}
      variant={variant ?? "bordered"}
    />
  )
}

export { SelectItem }
