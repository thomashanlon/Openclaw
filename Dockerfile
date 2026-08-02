FROM ghcr.io/openclaw/openclaw:2026.7.1@sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c

USER root

# Keep the upstream runtime intact and add only the development tools agents
# need. OpenClaw already provides Node.js, npm, Git, curl, and native MCP support.
RUN set -eux; \
    curl -fsSLo /tmp/packages-microsoft-prod.deb \
      https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb; \
    dpkg -i /tmp/packages-microsoft-prod.deb; \
    rm /tmp/packages-microsoft-prod.deb; \
    install -m 0755 -d /etc/apt/keyrings; \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg; \
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg; \
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\n' \
      "$(dpkg --print-architecture)" \
      > /etc/apt/sources.list.d/github-cli.list; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      build-essential \
      dotnet-sdk-10.0 \
      gh \
      jq \
      openssh-client \
      python-is-python3 \
      python3-dev \
      python3-pip \
      python3-venv \
      ripgrep \
      unzip \
      zip; \
    rm -rf /var/lib/apt/lists/*

# GH_TOKEN is supplied only at runtime. This lets both gh and ordinary HTTPS
# Git operations use it without storing the token in an image layer.
RUN git config --system credential.https://github.com.helper '' \
 && git config --system --add credential.https://github.com.helper \
      '!/usr/bin/gh auth git-credential'

ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1

USER node
