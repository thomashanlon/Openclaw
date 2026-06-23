FROM ghcr.io/openclaw/openclaw:latest

USER root

# Install runtime dependencies used by the .NET SDK
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    libicu-dev \
 && rm -rf /var/lib/apt/lists/*

# Install MCPorter
RUN npm install -g mcporter

# Install OpenClaw Codex plugin
#RUN npm install -g @openclaw/codex

# # Install Codex
# RUN npm i -g @openai/codex

# Install .NET 10 SDK
RUN curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh && \
    bash /tmp/dotnet-install.sh --channel 10.0 --install-dir /usr/share/dotnet && \
    ln -sf /usr/share/dotnet/dotnet /usr/bin/dotnet && \
    rm /tmp/dotnet-install.sh

ENV DOTNET_ROOT=/usr/share/dotnet
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1
ENV DOTNET_NOLOGO=1
ENV PATH=/usr/share/dotnet:/home/node/.dotnet/tools:${PATH}

# Install .NET global tools
RUN dotnet tool install --global dotnet-ef --version 10.* \
 && dotnet tool install --global dotnet-trace

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

# START GitHub Auth
# Runtime token support for gh and HTTPS git remotes.
# Provide GH_TOKEN/GITHUB_TOKEN or mount a token at GH_TOKEN_FILE/GITHUB_TOKEN_FILE.
RUN printf '%s\n' \
      '#!/usr/bin/env bash' \
      'set -euo pipefail' \
      'operation="${1:-}"' \
      '[ "$operation" = get ] || exit 0' \
      'protocol=""' \
      'host=""' \
      'while IFS= read -r line; do' \
      '  [ -n "$line" ] || break' \
      '  case "$line" in' \
      '    protocol=*) protocol="${line#protocol=}" ;;' \
      '    host=*) host="${line#host=}" ;;' \
      '  esac' \
      'done' \
      '[ "$protocol" = https ] || exit 0' \
      'case "$host" in' \
      '  github.com|*.ghe.com) ;;' \
      '  *) exit 0 ;;' \
      'esac' \
      'token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"' \
      'if [ -z "$token" ]; then' \
      '  token_file="${GH_TOKEN_FILE:-${GITHUB_TOKEN_FILE:-/run/secrets/github_token}}"' \
      '  if [ -r "$token_file" ]; then' \
      '    token="$(tr -d "\r\n" < "$token_file")"' \
      '  fi' \
      'fi' \
      '[ -n "$token" ] || exit 0' \
      'printf "%s\n" "username=x-access-token" "password=${token}"' \
      > /usr/local/bin/github-token-credential-helper \
 && printf '%s\n' \
      '#!/usr/bin/env bash' \
      'set -euo pipefail' \
      'if [ -z "${GH_TOKEN:-${GITHUB_TOKEN:-}}" ]; then' \
      '  token_file="${GH_TOKEN_FILE:-${GITHUB_TOKEN_FILE:-/run/secrets/github_token}}"' \
      '  if [ -r "$token_file" ]; then' \
      '    export GH_TOKEN="$(tr -d "\r\n" < "$token_file")"' \
      '  fi' \
      'fi' \
      'exec /usr/bin/gh "$@"' \
      > /usr/local/bin/gh \
 && chmod +x /usr/local/bin/github-token-credential-helper \
 && chmod +x /usr/local/bin/gh \
 && git config --system credential.helper /usr/local/bin/github-token-credential-helper \
 && git config --system credential.https://github.com.useHttpPath true \
 && git config --system --add url.https://github.com/.insteadOf git@github.com: \
 && git config --system --add url.https://github.com/.insteadOf ssh://git@github.com/
# END GitHub Auth

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

ARG GODOT_VERSION=4.7
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

# START Android Builds
# Tooling required for Godot Android APK/AAB exports.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    openjdk-17-jdk-headless \
 && rm -rf /var/lib/apt/lists/*

ARG ANDROID_CMDLINE_TOOLS_VERSION=14742923

ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV ANDROID_NDK_HOME=/opt/android-sdk/ndk/28.1.13356709

RUN set -eux; \
    mkdir -p "${ANDROID_HOME}/cmdline-tools" /tmp/android-cmdline-tools; \
    curl -fsSLo /tmp/android-commandlinetools.zip \
      "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_CMDLINE_TOOLS_VERSION}_latest.zip"; \
    unzip -q /tmp/android-commandlinetools.zip -d /tmp/android-cmdline-tools; \
    mv /tmp/android-cmdline-tools/cmdline-tools "${ANDROID_HOME}/cmdline-tools/latest"; \
    rm -rf /tmp/android-commandlinetools.zip /tmp/android-cmdline-tools; \
    yes | "${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager" --sdk_root="${ANDROID_HOME}" \
      "platform-tools" \
      "build-tools;35.0.1" \
      "platforms;android-35" \
      "cmdline-tools;latest" \
      "cmake;3.10.2.4988404" \
      "ndk;28.1.13356709"; \
    yes | "${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager" --sdk_root="${ANDROID_HOME}" --licenses; \
    chown -R node:node "${ANDROID_HOME}"

RUN set -eux; \
    templates_version="${GODOT_VERSION}.${GODOT_RELEASE}.${GODOT_FLAVOR}"; \
    templates_dir="/home/node/.local/share/godot/export_templates/${templates_version}"; \
    templates_tpz="Godot_v${GODOT_VERSION}-${GODOT_RELEASE}_${GODOT_FLAVOR}_export_templates.tpz"; \
    mkdir -p "${templates_dir}" /tmp/godot-export-templates; \
    curl -fsSLo "/tmp/${templates_tpz}" \
      "https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}-${GODOT_RELEASE}/${templates_tpz}"; \
    unzip -q "/tmp/${templates_tpz}" "templates/android*" -d /tmp/godot-export-templates; \
    mv /tmp/godot-export-templates/templates/android* "${templates_dir}/"; \
    rm -rf "/tmp/${templates_tpz}" /tmp/godot-export-templates; \
    mkdir -p /home/node/.android /home/node/.config/godot; \
    keytool -genkeypair -v \
      -keystore /home/node/.android/debug.keystore \
      -storepass android \
      -storetype JKS \
      -alias androiddebugkey \
      -keypass android \
      -keyalg RSA \
      -keysize 2048 \
      -validity 10000 \
      -dname "C=US, O=Android, CN=Android Debug"; \
    printf '%s\n' \
      '[gd_resource type="EditorSettings" format=3]' \
      '' \
      '[resource]' \
      "export/android/android_sdk_path = \"${ANDROID_HOME}\"" \
      "export/android/java_sdk_path = \"${JAVA_HOME}\"" \
      'export/android/debug_keystore = "/home/node/.android/debug.keystore"' \
      'export/android/debug_keystore_user = "androiddebugkey"' \
      'export/android/debug_keystore_pass = "android"' \
      > /home/node/.config/godot/editor_settings-4.tres; \
    chown -R node:node /home/node/.android /home/node/.config/godot /home/node/.local/share/godot

ENV GODOT_ANDROID_KEYSTORE_DEBUG_PATH=/home/node/.android/debug.keystore
ENV GODOT_ANDROID_KEYSTORE_DEBUG_USER=androiddebugkey
ENV GODOT_ANDROID_KEYSTORE_DEBUG_PASSWORD=android
ENV PATH=${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/build-tools/35.0.1:${PATH}
# END Android Builds

ENV GODOT_PATH=/usr/local/bin/godot
ENV PATH=/usr/local/bin:${PATH}

USER node
