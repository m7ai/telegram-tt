# Build stage: compile the app into the dist folder
FROM node:22-alpine AS build

# Reduce npm noise and skip funding/update checks
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NODE_ENV=production \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PYTHON=python3

WORKDIR /app

# Install required tools for build scripts, GitHub deps and node-gyp
RUN apk add --no-cache bash git python3 make g++

# Install dependencies first (leveraging Docker layer cache)
COPY package*.json ./
RUN npm ci --include=dev --omit=optional

# Copy the rest of the source and build
COPY . .
RUN npm run build:production


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

