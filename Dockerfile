FROM node:20-alpine AS base

# Install pnpm
RUN npm install -g pnpm@9

# Set working directory
WORKDIR /app

# Copy package files and configuration
COPY package.json pnpm-workspace.yaml ./
COPY .npmrc ./
COPY pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/
COPY libs/core/package.json ./libs/core/
COPY libs/shared/package.json ./libs/shared/
COPY libs/plugin-sdk/package.json ./libs/plugin-sdk/
COPY libs/test-kit/package.json ./libs/test-kit/
COPY libs/integrations/ai/package.json ./libs/integrations/ai/
COPY libs/integrations/allegro/package.json ./libs/integrations/allegro/
COPY libs/integrations/dpd-polska/package.json ./libs/integrations/dpd-polska/
COPY libs/integrations/erli/package.json ./libs/integrations/erli/
COPY libs/integrations/infakt/package.json ./libs/integrations/infakt/
COPY libs/integrations/inpost/package.json ./libs/integrations/inpost/
COPY libs/integrations/ksef/package.json ./libs/integrations/ksef/
COPY libs/integrations/prestashop/package.json ./libs/integrations/prestashop/
COPY libs/integrations/subiekt/package.json ./libs/integrations/subiekt/
COPY libs/integrations/woocommerce/package.json ./libs/integrations/woocommerce/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/

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
COPY pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY libs/core/package.json ./libs/core/
COPY libs/shared/package.json ./libs/shared/
COPY libs/plugin-sdk/package.json ./libs/plugin-sdk/
COPY libs/test-kit/package.json ./libs/test-kit/
COPY libs/integrations/ai/package.json ./libs/integrations/ai/
COPY libs/integrations/allegro/package.json ./libs/integrations/allegro/
COPY libs/integrations/dpd-polska/package.json ./libs/integrations/dpd-polska/
COPY libs/integrations/erli/package.json ./libs/integrations/erli/
COPY libs/integrations/infakt/package.json ./libs/integrations/infakt/
COPY libs/integrations/inpost/package.json ./libs/integrations/inpost/
COPY libs/integrations/ksef/package.json ./libs/integrations/ksef/
COPY libs/integrations/prestashop/package.json ./libs/integrations/prestashop/
COPY libs/integrations/subiekt/package.json ./libs/integrations/subiekt/
COPY libs/integrations/woocommerce/package.json ./libs/integrations/woocommerce/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/

# Install production dependencies only
# Skip prepare scripts to avoid husky installation in Docker
RUN npm install -g pnpm@9 && \
    pnpm install --prod --ignore-scripts

# Copy built application and dependencies
COPY --from=base /app/apps/api/dist ./apps/api/dist
COPY --from=base /app/libs/core/dist ./libs/core/dist
COPY --from=base /app/libs/shared/dist ./libs/shared/dist
COPY --from=base /app/libs/plugin-sdk/dist ./libs/plugin-sdk/dist
COPY --from=base /app/libs/integrations/ai/dist ./libs/integrations/ai/dist
COPY --from=base /app/libs/integrations/allegro/dist ./libs/integrations/allegro/dist
COPY --from=base /app/libs/integrations/dpd-polska/dist ./libs/integrations/dpd-polska/dist
COPY --from=base /app/libs/integrations/erli/dist ./libs/integrations/erli/dist
COPY --from=base /app/libs/integrations/infakt/dist ./libs/integrations/infakt/dist
COPY --from=base /app/libs/integrations/inpost/dist ./libs/integrations/inpost/dist
COPY --from=base /app/libs/integrations/ksef/dist ./libs/integrations/ksef/dist
COPY --from=base /app/libs/integrations/prestashop/dist ./libs/integrations/prestashop/dist
COPY --from=base /app/libs/integrations/subiekt/dist ./libs/integrations/subiekt/dist
COPY --from=base /app/libs/integrations/woocommerce/dist ./libs/integrations/woocommerce/dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=base /app/libs/core/node_modules ./libs/core/node_modules
COPY --from=base /app/libs/shared/node_modules ./libs/shared/node_modules

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "apps/api/dist/apps/api/src/main.js"]

# Worker stage — extends the production layer set (same libs dist + node_modules)
# with the worker's own compiled output and entrypoint. The worker exposes no
# HTTP surface (NestFactory.createApplicationContext), so no EXPOSE.
FROM production AS worker

COPY --from=base /app/apps/worker/dist ./apps/worker/dist
COPY --from=base /app/apps/worker/node_modules ./apps/worker/node_modules

CMD ["node", "apps/worker/dist/apps/worker/src/main.js"]
