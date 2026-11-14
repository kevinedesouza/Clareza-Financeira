# Clareza Financeira — imagem de produção (Coolify)
# Build do frontend (Vite) + servidor Express (server.ts) na porta 3000.

FROM node:24-alpine AS base
WORKDIR /app

# ---------- dependências ----------
FROM base AS deps
COPY package.json ./
# --legacy-peer-deps: o projeto tem conflito de peer deps (vite/tailwind/plugins)
RUN npm install --no-audit --no-fund --legacy-peer-deps

# ---------- build do frontend ----------
FROM deps AS build
COPY . .
# Variáveis VITE_* são embutidas no bundle no momento do build.
# No Coolify, marque-as como "Build Variable" ou passe como build args.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN npm run build

# ---------- imagem final ----------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/workers ./workers
COPY --from=build /app/server.ts /app/package.json /app/tsconfig.json ./
COPY --from=build /app/supabase ./supabase

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tsx executa o server.ts (imports sem extensão); as deps de dev já estão instaladas
CMD ["npx", "tsx", "server.ts"]
