#!/bin/bash
set -e

echo "=============================="
echo " Setup Confraria Delivery VPS"
echo "=============================="

# 1. Atualiza sistema
apt update && apt upgrade -y

# 2. Instala Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 3. Instala PM2 e Nginx
npm install -g pm2
apt install -y nginx

# 4. Clona o repositório
cd /var/www
rm -rf sistema-gestao-restaurante
git clone https://github.com/mhenrique21-ctrl/sistema-gestao-restaurante.git
cd sistema-gestao-restaurante

# 5. Instala dependências do backend
cd delivery-backend
npm install

# 6. Cria arquivo .env do backend
cat > .env << 'EOF'
SUPABASE_URL=https://kenwlcsnssfrtzkrleik.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtlbndsY3Nuc3NmcnR6a3JsZWlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNzQ2NjAsImV4cCI6MjA5Nzc1MDY2MH0.ipFAJRvj3WaGdX_B7Dcllc9YZ6PJFr7DAwMNlKjmZ7o
JWT_SECRET=confraria_jwt_secret_2026_troque_em_producao
JWT_EXPIRES_IN=7d
PORT=4000
NODE_ENV=production
EOF

# 7. Inicia backend com PM2
pm2 start src/server.js --name "confraria-backend"
pm2 startup
pm2 save

# 8. Build do frontend (delivery-app)
cd /var/www/sistema-gestao-restaurante/delivery-app
npm install

cat > .env.production << 'EOF'
VITE_API_URL=http://82.25.90.185
EOF

npm run build

# 9. Configura Nginx
cat > /etc/nginx/sites-available/confraria << 'NGINX'
server {
    listen 80;
    server_name 82.25.90.185;

    # Frontend React
    root /var/www/sistema-gestao-restaurante/delivery-app/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket
    location /ws {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }

    # Admin painel
    location /admin.html {
        proxy_pass http://localhost:4000;
        proxy_set_header Host $host;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/confraria /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
systemctl enable nginx

echo ""
echo "=============================="
echo " INSTALAÇÃO CONCLUÍDA!"
echo " Acesse: http://82.25.90.185"
echo " Admin:  http://82.25.90.185/admin.html"
echo "=============================="
