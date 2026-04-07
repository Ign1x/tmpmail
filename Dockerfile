FROM rust:1.93-bookworm AS builder

ARG TMPMAIL_CARGO_REGISTRY_PROTOCOL=sparse
ARG TMPMAIL_CARGO_MIRROR=
ARG TMPMAIL_CARGO_NET_RETRY=10
ARG TMPMAIL_CARGO_HTTP_TIMEOUT=120

ENV CARGO_REGISTRIES_CRATES_IO_PROTOCOL=${TMPMAIL_CARGO_REGISTRY_PROTOCOL} \
    CARGO_NET_RETRY=${TMPMAIL_CARGO_NET_RETRY} \
    CARGO_HTTP_TIMEOUT=${TMPMAIL_CARGO_HTTP_TIMEOUT}

WORKDIR /app

RUN mkdir -p /usr/local/cargo \
    && if [ -n "${TMPMAIL_CARGO_MIRROR}" ]; then \
        printf '[registries.crates-io]\nprotocol = "%s"\n\n[source.crates-io]\nreplace-with = "mirror"\n\n[source.mirror]\nregistry = "%s"\n' \
          "${TMPMAIL_CARGO_REGISTRY_PROTOCOL}" \
          "${TMPMAIL_CARGO_MIRROR}" \
          > /usr/local/cargo/config.toml; \
      else \
        printf '[registries.crates-io]\nprotocol = "%s"\n' \
          "${TMPMAIL_CARGO_REGISTRY_PROTOCOL}" \
          > /usr/local/cargo/config.toml; \
      fi

COPY Cargo.toml Cargo.lock ./

RUN mkdir -p src \
    && printf 'fn main() {}\n' > src/main.rs

RUN cargo fetch --locked

COPY src ./src
COPY migrations ./migrations

RUN cargo build --release --locked \
    && cp target/release/tmpmail-api /tmp/tmpmail-api

FROM rust:1.93-bookworm AS runtime

RUN groupadd --system --gid 10001 tmpmail \
    && useradd --system --uid 10001 --gid tmpmail --home-dir /app --shell /usr/sbin/nologin tmpmail \
    && mkdir -p /app /tmp \
    && chown -R tmpmail:tmpmail /app /tmp

WORKDIR /app

COPY --from=builder --chown=tmpmail:tmpmail /tmp/tmpmail-api /usr/local/bin/tmpmail-api

ENV TMPMAIL_HOST=0.0.0.0
ENV TMPMAIL_PORT=8080

EXPOSE 8080

USER tmpmail:tmpmail

CMD ["tmpmail-api"]
