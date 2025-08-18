# Build stage: compile the app into the dist folder
FROM node:22-alpine AS build

# Reduce npm noise and skip funding/update checks
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NODE_ENV=production

WORKDIR /app

# Install required tools for build scripts and GitHub deps
RUN apk add --no-cache bash git

# Install dependencies first (leveraging Docker layer cache)
COPY package*.json ./
RUN npm ci

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

