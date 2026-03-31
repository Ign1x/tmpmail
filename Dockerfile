FROM rust:1.93-bookworm AS builder

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations

RUN cargo build --release

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN mkdir -p /app/data/config /app/data/storage

COPY --from=builder /app/target/release/tmpmail-api /usr/local/bin/tmpmail-api

ENV TMPMAIL_HOST=0.0.0.0
ENV TMPMAIL_PORT=8080

EXPOSE 8080

CMD ["tmpmail-api"]
