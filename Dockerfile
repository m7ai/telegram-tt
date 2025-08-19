# syntax=docker/dockerfile:1.4
# Build stage: compile the app into the dist folder
FROM node:22-alpine AS build

# Reduce npm noise and skip funding/update checks
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NODE_ENV=production \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PYTHON=python3

# Allow passing API/settings at build time (Railway build args)
ARG TELEGRAM_API_ID
ARG TELEGRAM_API_HASH
ARG APP_ENV
ARG APP_NAME
ARG APP_TITLE
ARG M7_API_URL
ARG VIVA_API_KEY
ARG ELECTRON_HOST_URL
ARG DOTENV_CONFIG_PATH
ENV TELEGRAM_API_ID=${TELEGRAM_API_ID} \
    TELEGRAM_API_HASH=${TELEGRAM_API_HASH} \
    APP_ENV=${APP_ENV} \
    APP_NAME=${APP_NAME} \
    APP_TITLE=${APP_TITLE} \
    M7_API_URL=${M7_API_URL} \
    VIVA_API_KEY=${VIVA_API_KEY} \
    ELECTRON_HOST_URL=${ELECTRON_HOST_URL} \
    DOTENV_CONFIG_PATH=${DOTENV_CONFIG_PATH}

WORKDIR /app

# Install required tools for build scripts, GitHub deps and node-gyp
RUN apk add --no-cache bash git python3 make g++

# Install dependencies first (leveraging Docker layer cache)
COPY package*.json ./
RUN npm ci --include=dev --omit=optional

# Copy the rest of the source and build
COPY . .
# If provided at build time, mount a local .env as a secret so webpack (dotenv/config)
# can read it without baking it into layers. Example:
#   DOCKER_BUILDKIT=1 docker build \
#     --secret id=env,src=.env \
#     --build-arg APP_ENV=production \
#     --build-arg M7_API_URL=https://api.example.com \
#     -t telegram-tt .
RUN --mount=type=secret,id=env,target=/app/.env npm run build:production


# Runtime stage: serve the built app with Caddy
FROM caddy:2

WORKDIR /app

# Copy Caddyfile and format it
COPY Caddyfile ./
RUN caddy fmt Caddyfile --overwrite

# Copy build output from previous stage
COPY --from=build /app/dist ./dist

# Run Caddy (Railway provides $PORT)
CMD ["caddy", "run", "--config", "Caddyfile", "--adapter", "caddyfile"]

