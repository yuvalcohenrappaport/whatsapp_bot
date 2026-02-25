module.exports = {
  apps: [
    {
      name: 'whatsapp-bot',
      script: './src/index.ts',
      interpreter: 'node',
      interpreterArgs: '--import tsx',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000,
      min_uptime: 30000,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/bot-error.log',
      out_file: './logs/bot-out.log',
    },
  ],
};
