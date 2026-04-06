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

# Useful for this repo's EF Core workflows
RUN dotnet tool install --global dotnet-ef --version 10.*
USER node
