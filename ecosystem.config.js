module.exports = {
  apps: [{
    name: 'naukri-bot',
    script: './src/cloud-run.js',
    instances: 1,
    exec_mode: 'fork',
    env: { NODE_ENV: 'production' },
    output: './logs/out.log',
    error: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    autorestart: false,
    max_memory_restart: '300M',
    cron_restart: '30 3 * * *',
    kill_timeout: 5000,
  }]
};
