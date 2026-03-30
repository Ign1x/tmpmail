const LOCAL_PART_PATTERN = /^[a-z0-9._+-]+$/;

export function normalizeLocalPart(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeDomainName(value: string): string {
  return value.trim().replace(/\.+$/g, "").replace(/^\.+/g, "").toLowerCase();
}

export function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function validateLocalPart(
  value: string,
): "required" | "tooShort" | "tooLong" | "invalid" | null {
  if (!value) {
    return "required";
  }

  if (value.length < 3) {
    return "tooShort";
  }

  if (value.length > 64) {
    return "tooLong";
  }

  if (
    /\s/.test(value) ||
    value.startsWith(".") ||
    value.endsWith(".") ||
    value.includes("..") ||
    !LOCAL_PART_PATTERN.test(value)
  ) {
    return "invalid";
  }

  return null;
}

export function validateDomainName(value: string): "invalid" | null {
  if (!value || value.length > 253 || !value.includes(".")) {
    return "invalid";
  }

  const labels = value.split(".");
  if (
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-") ||
        /[^a-z0-9-]/.test(label),
    )
  ) {
    return "invalid";
  }

  return null;
}

export function validateEmailAddress(
  value: string,
): "required" | "invalid" | "tooShort" | "tooLong" | null {
  if (!value) {
    return "required";
  }

  if (/\s/.test(value)) {
    return "invalid";
  }

  const parts = value.split("@");
  if (parts.length !== 2) {
    return "invalid";
  }

  const localPartError = validateLocalPart(parts[0]);
  if (localPartError) {
    return localPartError;
  }

  return validateDomainName(parts[1]);
}
