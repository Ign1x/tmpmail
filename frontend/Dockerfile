FROM node:20-bookworm-slim AS deps

WORKDIR /app
ARG TMPMAIL_NPM_REGISTRY=
ARG TMPMAIL_NPM_FETCH_TIMEOUT=300000
ENV NEXT_TELEMETRY_DISABLED=1 \
    npm_config_fetch_retries=5 \
    npm_config_fetch_retry_factor=2 \
    npm_config_fetch_retry_mintimeout=20000 \
    npm_config_fetch_retry_maxtimeout=120000 \
    npm_config_fetch_timeout=${TMPMAIL_NPM_FETCH_TIMEOUT}

COPY .npmrc package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,id=tmpmail-frontend-npm-cache \
    if [ -n "$TMPMAIL_NPM_REGISTRY" ]; then \
      npm config set registry "$TMPMAIL_NPM_REGISTRY"; \
      npm config set replace-registry-host always; \
    fi \
    && echo "npm registry: $(npm config get registry)" \
    && npm ci --legacy-peer-deps --prefer-offline --no-audit --progress=false

FROM node:20-bookworm-slim AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_TMPMAIL_DEFAULT_DOMAIN=
ARG NEXT_PUBLIC_TMPMAIL_BRAND_NAME=TmpMail
ARG NEXT_PUBLIC_TMPMAIL_BRAND_DOMAIN=
ARG NEXT_PUBLIC_TMPMAIL_REPO_URL=
ENV NEXT_PUBLIC_TMPMAIL_DEFAULT_DOMAIN=$NEXT_PUBLIC_TMPMAIL_DEFAULT_DOMAIN
ENV NEXT_PUBLIC_TMPMAIL_BRAND_NAME=$NEXT_PUBLIC_TMPMAIL_BRAND_NAME
ENV NEXT_PUBLIC_TMPMAIL_BRAND_DOMAIN=$NEXT_PUBLIC_TMPMAIL_BRAND_DOMAIN
ENV NEXT_PUBLIC_TMPMAIL_REPO_URL=$NEXT_PUBLIC_TMPMAIL_REPO_URL

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

FROM node:20-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ARG NEXT_PUBLIC_TMPMAIL_DEFAULT_DOMAIN=
ARG NEXT_PUBLIC_TMPMAIL_BRAND_NAME=TmpMail
ARG NEXT_PUBLIC_TMPMAIL_BRAND_DOMAIN=
ARG NEXT_PUBLIC_TMPMAIL_REPO_URL=
ENV NEXT_PUBLIC_TMPMAIL_DEFAULT_DOMAIN=$NEXT_PUBLIC_TMPMAIL_DEFAULT_DOMAIN
ENV NEXT_PUBLIC_TMPMAIL_BRAND_NAME=$NEXT_PUBLIC_TMPMAIL_BRAND_NAME
ENV NEXT_PUBLIC_TMPMAIL_BRAND_DOMAIN=$NEXT_PUBLIC_TMPMAIL_BRAND_DOMAIN
ENV NEXT_PUBLIC_TMPMAIL_REPO_URL=$NEXT_PUBLIC_TMPMAIL_REPO_URL

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

EXPOSE 3000

USER node

CMD ["node", "server.js"]
