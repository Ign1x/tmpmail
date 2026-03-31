export interface Domain {
  id: string
  domain: string
  isVerified?: boolean // 是否已验证（已验证才可用）
  status?: string
  ownerUserId?: string
  verificationToken?: string
  verificationError?: string
  providerId?: string // 域名所属的API提供商ID
  providerName?: string // 提供商名称，用于显示
  createdAt?: string
  updatedAt?: string
}

export interface DomainDnsRecord {
  kind: string
  name: string
  value: string
  ttl: number
}

export interface Account {
  id: string
  address: string
  quota: number
  used: number
  isDisabled: boolean
  isDeleted: boolean
  createdAt: string
  updatedAt: string
  // 添加本地存储的认证信息
  password?: string // 存储密码用于重新获取token
  token?: string // 存储该账户的token
  // 添加API提供商信息
  providerId?: string // 账户所属的API提供商ID，用于向后兼容，默认使用内置 tmpmail provider
}

export interface Message {
  id: string
  accountId: string
  msgid: string
  from: {
    name: string
    address: string
  }
  to: {
    name: string
    address: string
  }[]
  subject: string
  intro: string
  seen: boolean
  isDeleted: boolean
  hasAttachments: boolean
  size: number
  downloadUrl: string
  createdAt: string
  updatedAt: string
}

export interface MessageDetail extends Message {
  cc?: string[]
  bcc?: string[]
  text: string
  html: string[]
  attachments?: {
    id: string
    filename: string
    contentType: string
    disposition: string
    transferEncoding: string
    related: boolean
    size: number
    downloadUrl: string
  }[]
}

export interface AuthState {
  token: string | null
  currentAccount: Account | null
  accounts: Account[]
  isAuthenticated: boolean
}
