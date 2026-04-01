FROM ghcr.io/openclaw/openclaw:latest

USER root
RUN npm install -g mcporter
USER node
