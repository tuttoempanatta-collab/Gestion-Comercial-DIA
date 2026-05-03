# Usar la imagen oficial de Playwright que ya tiene todas las dependencias del navegador
FROM mcr.microsoft.com/playwright:v1.40.0-focal

# Establecer directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de Node
RUN npm install

# Copiar el resto del código
COPY . .

# Instalar los navegadores de Playwright (aunque la imagen ya trae algunos, aseguramos Chromium)
RUN npx playwright install chromium

# Exponer el puerto que usa Express
EXPOSE 3001

# Comando para iniciar la aplicación
CMD ["node", "index.js"]
