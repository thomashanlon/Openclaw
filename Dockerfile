FROM ghcr.io/openclaw/openclaw:latest

USER root

# Install MCPorter
RUN npm install -g mcporter

# Install Codex
RUN npm i -g @openai/codex

# Install .NET 10 SDK
RUN curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh && \
    bash /tmp/dotnet-install.sh --channel 10.0 --install-dir /usr/share/dotnet && \
    ln -sf /usr/share/dotnet/dotnet /usr/bin/dotnet && \
    rm /tmp/dotnet-install.sh

ENV DOTNET_ROOT=/usr/share/dotnet
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1
ENV DOTNET_NOLOGO=1
ENV PATH=/usr/share/dotnet:/home/node/.dotnet/tools:${PATH}

# Install dotnet EF Core tools
RUN dotnet tool install --global dotnet-ef --version 10.*

# Install GitHub CLI (gh)
RUN mkdir -p /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y gh \
 && rm -rf /var/lib/apt/lists/*

 # Install Godot .NET and expose it on PATH as `godot` and `godot4`
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    unzip \
    libasound2 \
    libdbus-1-3 \
    libfontconfig1 \
    libgl1 \
    libnss3 \
    libx11-6 \
    libxcursor1 \
    libxi6 \
    libxinerama1 \
    libxrandr2 \
 && rm -rf /var/lib/apt/lists/*

ARG GODOT_VERSION=4.6.2
ARG GODOT_RELEASE=stable
ARG GODOT_FLAVOR=mono

RUN set -eux; \
    godot_dir="Godot_v${GODOT_VERSION}-${GODOT_RELEASE}_${GODOT_FLAVOR}_linux_x86_64"; \
    godot_zip="${godot_dir}.zip"; \
    curl -fsSLo "/tmp/${godot_zip}" "https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}-${GODOT_RELEASE}/${godot_zip}"; \
    unzip -q "/tmp/${godot_zip}" -d /opt; \
    rm "/tmp/${godot_zip}"; \
    ln -sf "/opt/${godot_dir}/Godot_v${GODOT_VERSION}-${GODOT_RELEASE}_${GODOT_FLAVOR}_linux.x86_64" /usr/local/bin/godot; \
    ln -sf /usr/local/bin/godot /usr/local/bin/godot4; \
    godot --version

ENV GODOT_PATH=/usr/local/bin/godot
ENV PATH=/usr/local/bin:${PATH}

USER node
