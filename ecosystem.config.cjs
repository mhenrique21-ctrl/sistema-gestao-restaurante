require('dotenv').config();

module.exports = {
  apps: [
    {
      name: 'app-gestao',
      script: 'new_server.js',
      cwd: '/var/www/app-gestao',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: '/var/log/pm2/app-gestao-error.log',
      out_file: '/var/log/pm2/app-gestao-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
