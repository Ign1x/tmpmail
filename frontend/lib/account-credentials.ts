const USERNAME_CHARS = "abcdefghijkmnopqrstuvwxyz23456789"
const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"

function generateRandomValue(length: number, chars: string) {
  const charsLength = chars.length

  if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    const array = new Uint32Array(length)
    window.crypto.getRandomValues(array)
    return Array.from(array, (value) => chars[value % charsLength]).join("")
  }

  let result = ""
  for (let index = 0; index < length; index += 1) {
    result += chars[Math.floor(Math.random() * charsLength)]
  }

  return result
}

export function generateRandomUsername(length = 10) {
  return generateRandomValue(length, USERNAME_CHARS)
}

export function generateRandomPassword(length = 12) {
  return generateRandomValue(length, PASSWORD_CHARS)
}

export function generateRandomAccountCredentials(domain: string) {
  const username = generateRandomUsername()
  const password = generateRandomPassword()

  return {
    username,
    password,
    email: `${username}@${domain}`,
  }
}
