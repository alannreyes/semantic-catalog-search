# Usa Node 20 en lugar de 18 para compatibilidad con NestJS 11 y dependencias modernas
# Usando registro público de AWS para evitar rate limits de Docker Hub
FROM public.ecr.aws/docker/library/node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 4000
CMD ["node", "dist/main"]
