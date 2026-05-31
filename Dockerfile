# Stage 1: Build the React frontend
FROM node:22-alpine AS build-frontend
WORKDIR /app/client

# Optimization: Only copy package files first to leverage Docker cache
COPY client/package*.json ./
RUN npm install --quiet

# Copy the rest and build
COPY client/ ./
RUN npm run build

# Stage 2: Setup the Node.js backend
FROM node:22-alpine
WORKDIR /app/server

# Install Python and FFmpeg (often required for media processing)
# Use minimal install
RUN apk add --no-cache python3 ffmpeg

# Optimization: Only copy package files first
COPY server/package*.json ./
# Use npm install, then clean npm cache to reduce image size
RUN npm install --omit=dev --quiet && npm cache clean --force

# Copy the backend code
COPY server/ ./

# Copy only the final build results from Stage 1
COPY --from=build-frontend /app/server/dist ./dist

# Final optimization: Remove unnecessary files and set environment
ENV NODE_ENV=production
EXPOSE 5000

CMD ["node", "index.js"]
