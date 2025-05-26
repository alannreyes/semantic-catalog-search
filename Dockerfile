# Usa Node 20 en lugar de 18 para compatibilidad con NestJS 11 y dependencias modernas
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["node", "dist/main"]
