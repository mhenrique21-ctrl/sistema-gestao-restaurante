#!/bin/bash
# ============================================================
# Deploy App Gestão – Confraria & Seama
# VPS Hostinger (Ubuntu 20.04/22.04)
# Uso: bash deploy.sh
# ============================================================

set -e

APP_DIR="/var/www/app-gestao"
APP_USER="www-data"
NODE_VERSION="20"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   App Gestão – Deploy VPS Hostinger      ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ---------- 1. Atualizar sistema ----------
echo "▶ Atualizando sistema..."
apt-get update -qq && apt-get upgrade -y -qq

# ---------- 2. Instalar Node.js ----------
if ! command -v node &>/dev/null; then
  echo "▶ Instalando Node.js $NODE_VERSION..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y nodejs -qq
fi
echo "✅ Node $(node -v) | npm $(npm -v)"

# ---------- 3. Instalar PM2 ----------
if ! command -v pm2 &>/dev/null; then
  echo "▶ Instalando PM2..."
  npm install -g pm2 -q
fi
echo "✅ PM2 $(pm2 -v)"

# ---------- 4. Instalar Nginx ----------
if ! command -v nginx &>/dev/null; then
  echo "▶ Instalando Nginx..."
  apt-get install -y nginx -qq
fi
echo "✅ Nginx instalado"

# ---------- 5. Clonar / atualizar repositório ----------
if [ -d "$APP_DIR/.git" ]; then
  echo "▶ Atualizando repositório..."
  cd "$APP_DIR"
  git pull origin claude/confraria-seama-mobile-app-tkGRc
else
  echo "▶ Clonando repositório..."
  git clone -b claude/confraria-seama-mobile-app-tkGRc \
    https://github.com/mhenrique21-ctrl/sistema-gestao-restaurante "$APP_DIR"
  cd "$APP_DIR"
fi

# ---------- 6. Instalar dependências e build ----------
echo "▶ Instalando dependências..."
npm install --production=false

echo "▶ Fazendo build do app..."
npm run build
echo "✅ Build concluído"

# ---------- 7. Criar arquivo .env ----------
if [ ! -f "$APP_DIR/.env" ]; then
  echo ""
  echo "⚠️  Digite sua ANTHROPIC_API_KEY (ou pressione Enter para pular):"
  read -r API_KEY
  echo "ANTHROPIC_API_KEY=${API_KEY}" > "$APP_DIR/.env"
  echo "PORT=3000" >> "$APP_DIR/.env"
  echo "✅ Arquivo .env criado"
fi

# ---------- 8. Iniciar com PM2 ----------
echo "▶ Iniciando app com PM2..."
cd "$APP_DIR"
pm2 delete app-gestao 2>/dev/null || true
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash || true
echo "✅ App rodando com PM2"

# ---------- 9. Configurar Nginx ----------
echo "▶ Configurando Nginx..."

echo ""
echo "⚠️  Digite o domínio ou IP da sua VPS (ex: gestao.seusite.com ou 123.45.67.89):"
read -r DOMAIN

cat > /etc/nginx/sites-available/app-gestao << NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/app-gestao /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
echo "✅ Nginx configurado"

# ---------- 10. SSL com Let's Encrypt (só para domínio) ----------
if [[ "$DOMAIN" =~ \. ]] && [[ ! "$DOMAIN" =~ ^[0-9] ]]; then
  echo ""
  echo "▶ Instalando certificado SSL..."
  apt-get install -y certbot python3-certbot-nginx -qq
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m admin@"$DOMAIN" || \
    echo "⚠️  SSL pulado. Configure manualmente: certbot --nginx -d $DOMAIN"
fi

# ---------- Resumo ----------
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  ✅  Deploy concluído!                   ║"
echo "╠══════════════════════════════════════════╣"
echo "║  App:   http://${DOMAIN}                 ║"
echo "║  PM2:   pm2 status                       ║"
echo "║  Logs:  pm2 logs app-gestao              ║"
echo "║  Nginx: systemctl status nginx           ║"
echo "╚══════════════════════════════════════════╝"
echo ""
