# -------- Etapa 1: build binario ----------
FROM node:22-alpine AS builder

WORKDIR /app

# Instala compatibilidad para binarios
RUN apk add --no-cache gcompat libc6-compat

# Copiamos los archivos necesarios
COPY package*.json tsconfig.json ./
COPY src ./src

# Instalamos dependencias de desarrollo
RUN npm install

# Compilamos TypeScript
RUN npm run build

# Etapa 2: Producción
FROM node:22-alpine

WORKDIR /app

# Instala compatibilidad para binarios
RUN apk add --no-cache gcompat libc6-compat

# Solo copia dependencias necesarias
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts

# Copia solo la salida del build
COPY --from=builder /app/dist ./dist

# Expón el puerto si aplica
EXPOSE 3000

# Comando para iniciar tu app
CMD ["node", "dist/index.js"]