FROM debian:trixie-slim

LABEL org.opencontainers.image.source="https://github.com/chamvi/chamvi" \
      org.opencontainers.image.description="chamvi sandbox workspace: Debian, git, build tools, ripgrep, jq and mise for any toolchain" \
      org.opencontainers.image.licenses="Apache-2.0"

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# the tools every workspace needs (sh, git, GNU coreutils' timeout), the
# build basics native packages compile with, and mise from its apt
# repository, which installs language toolchains at runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential ca-certificates curl git jq ripgrep tini unzip xz-utils \
    && install -dm 755 /etc/apt/keyrings \
    && curl -fsSL https://mise.jdx.dev/gpg-key.pub -o /etc/apt/keyrings/mise-archive-keyring.asc \
    && echo "deb [signed-by=/etc/apt/keyrings/mise-archive-keyring.asc] https://mise.jdx.dev/deb stable main" \
        > /etc/apt/sources.list.d/mise.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends mise \
    && rm -rf /var/lib/apt/lists/*

# /workspace and /cache (the shared package cache) are volumes in a
# workspace; Docker copies these modes into an empty volume, so the
# hardened mode (user 1000) can write them too
RUN mkdir -m 0777 /workspace && mkdir -m 1777 /cache

# the cache variables of @chamvi/sandbox's CACHE_ENV for mise, and mise's
# shims on the PATH, so `mise use -g node@22` makes node a plain command;
# mise trusts the repository's config and reads .nvmrc and .python-version
ENV DEBIAN_FRONTEND=noninteractive \
    CI=true \
    GIT_TERMINAL_PROMPT=0 \
    MISE_DATA_DIR=/cache/mise \
    MISE_YES=1 \
    MISE_TRUSTED_CONFIG_PATHS=/workspace \
    MISE_IDIOMATIC_VERSION_FILE_ENABLE_TOOLS=node,python,ruby,go,java \
    PATH=/cache/mise/shims:$PATH

WORKDIR /workspace

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["sleep", "infinity"]
