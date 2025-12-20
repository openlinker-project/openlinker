FROM node:20-alpine AS base

# Install pnpm
RUN npm install -g pnpm@8

# Set working directory
WORKDIR /app

# Copy package files and configuration
COPY package.json pnpm-workspace.yaml ./
COPY .npmrc ./
COPY pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/
COPY libs/core/package.json ./libs/core/
COPY libs/shared/package.json ./libs/shared/

# Install dependencies
# pnpm-lock.yaml ensures consistent dependency resolution
RUN pnpm install

# Copy source code (this will include pnpm-lock.yaml if it exists)
COPY . .

# Build application
RUN pnpm build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy package files
COPY package.json pnpm-workspace.yaml ./
COPY .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY libs/core/package.json ./libs/core/
COPY libs/shared/package.json ./libs/shared/

# Install production dependencies only
# Skip prepare scripts to avoid husky installation in Docker
RUN npm install -g pnpm@8 && \
    pnpm install --prod --ignore-scripts

# Copy built application and dependencies
COPY --from=base /app/apps/api/dist ./apps/api/dist
COPY --from=base /app/libs/core/dist ./libs/core/dist
COPY --from=base /app/libs/shared/dist ./libs/shared/dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=base /app/libs/core/node_modules ./libs/core/node_modules
COPY --from=base /app/libs/shared/node_modules ./libs/shared/node_modules

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "apps/api/dist/apps/api/src/main.js"]
