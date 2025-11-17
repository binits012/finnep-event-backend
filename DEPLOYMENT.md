# Finnep Event App Backend - Deployment Guide

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Docker Deployment](#docker-deployment)
4. [Manual Deployment](#manual-deployment)
5. [CI/CD Pipeline](#cicd-pipeline)
6. [Process Management](#process-management)
7. [Scaling](#scaling)
8. [Health Checks](#health-checks)
9. [Monitoring](#monitoring)
10. [Backup & Recovery](#backup--recovery)
11. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Server Requirements

- **Operating System:** Linux (Ubuntu 20.04+ recommended) or macOS
- **Node.js:** >= 18.x
- **Memory:** Minimum 2GB RAM (4GB+ recommended for production)
- **Disk Space:** Minimum 10GB free space
- **Network:** Port 3000 (or configured PORT) accessible

### Service Dependencies

- **MongoDB:** >= 5.x (running and accessible)
- **Redis:** >= 6.x (running and accessible)
- **RabbitMQ:** >= 3.x (running and accessible)

### Optional Tools

- **Docker:** >= 20.x (for containerized deployment)
- **PM2:** >= 5.x (for process management)
- **Nginx:** >= 1.18 (for reverse proxy)
- **Jenkins:** (for CI/CD pipeline)

---

## Environment Setup

### 1. Production Environment Variables

Create a `.env` file or set environment variables with production values:

```env
# Server Configuration
NODE_ENV=production
PORT=3000

# MongoDB Configuration
MONGODB_HOST=your_mongodb_host
MONGODB_PORT=27017
MONGODB_USER=your_mongodb_user
MONGODB_PWD=your_mongodb_password
MONGODB_NAME=finnep_eventapp

# Redis Configuration
REDIS_HOST=your_redis_host
REDIS_PORT=6379
REDIS_PWD=your_redis_password

# RabbitMQ Configuration
RABBITMQ_HOST=your_rabbitmq_host
RABBITMQ_PORT=5672
RABBITMQ_USERNAME=your_rabbitmq_username
RABBITMQ_PASSWORD=your_rabbitmq_password
RABBITMQ_VHOST=/
RABBITMQ_HEARTBEAT=60

# Stripe Configuration
STRIPE_KEY=sk_live_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# AWS Configuration
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=eu-central-1
AWS_S3_BUCKET=your_s3_bucket_name
CLOUDFRONT_DOMAIN=your_cloudfront_domain
CLOUDFRONT_KEY_PAIR_ID=your_cloudfront_key_pair_id
CLOUDFRONT_PRIVATE_KEY=your_cloudfront_private_key
CLOUDFRONT_URL=https://your_cloudfront_domain.cloudfront.net

# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_email_password
EMAIL_USERNAME=your_email@gmail.com
EMAIL_FROM=noreply@finnep.fi

# JWT Configuration
JWT_TOKEN_SECRET=your_jwt_secret_key_minimum_32_characters
TOKEN_LIFE_SPAN=24h
GUEST_TOKEN_SECRET=your_guest_token_secret
GUEST_TOKEN_EXPIRES_IN=15m

# Application Configuration
FRONTEND_URL=https://eventapp.finnep.fi
CMS_URL=https://cms.eventapp.finnep.fi
FQDN=https://api.eventapp.finnep.fi
COMPANY_TITLE=Finnep
COMPANY_NAME=Finnep
COMPANY_EMAIL=contact@finnep.fi
TIME_ZONE=Europe/Helsinki
PREFIX_PHONE=+358
SALT_WORK_FACTOR=10

# Admin User (for initial setup)
ADMIN_USER=admin@finnep.fi
ADMIN_PWD=your_secure_admin_password

# Dashboard URL (for merchant emails)
DASHBOARD_URL=https://merchant.eventapp.finnep.fi/
```

### 2. Security Considerations

- **Never commit `.env` files** to version control
- Use **secure secret management** (AWS Secrets Manager, HashiCorp Vault, etc.)
- Rotate secrets regularly
- Use **strong passwords** for all services
- Enable **SSL/TLS** for all connections
- Restrict **firewall rules** to necessary ports only

### 3. SSL/TLS Configuration

For production, use HTTPS:

```bash
# Using Let's Encrypt (recommended)
sudo certbot --nginx -d api.eventapp.finnep.fi

# Or use your own SSL certificates
# Configure in Nginx reverse proxy
```

---

## Docker Deployment

### 1. Build Docker Image

```bash
# Build the image
docker build -t finnep-eventapp-backend:latest .

# Tag for registry (if using)
docker tag finnep-eventapp-backend:latest your-registry/finnep-eventapp-backend:latest
```

### 2. Run Docker Container

```bash
# Run with environment file
docker run -d \
  --name finnep-backend \
  -p 3000:3000 \
  --env-file .env \
  --restart unless-stopped \
  finnep-eventapp-backend:latest

# Or with environment variables
docker run -d \
  --name finnep-backend \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e MONGODB_HOST=your_host \
  # ... (add all environment variables)
  --restart unless-stopped \
  finnep-eventapp-backend:latest
```

### 3. Docker Compose (Recommended)

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  backend:
    build: .
    container_name: finnep-backend
    ports:
      - "3000:3000"
    env_file:
      - .env
    restart: unless-stopped
    volumes:
      - ./logs:/dist/logs
      - ./staticPages:/dist/staticPages
      - ./emailTemplates:/dist/emailTemplates
    networks:
      - finnep-network
    depends_on:
      - mongodb
      - redis
      - rabbitmq

  mongodb:
    image: mongo:latest
    container_name: finnep-mongodb
    environment:
      MONGO_INITDB_ROOT_USERNAME: ${MONGODB_USER}
      MONGO_INITDB_ROOT_PASSWORD: ${MONGODB_PWD}
      MONGO_INITDB_DATABASE: ${MONGODB_NAME}
    volumes:
      - mongodb_data:/data/db
    ports:
      - "27017:27017"
    networks:
      - finnep-network

  redis:
    image: redis:latest
    container_name: finnep-redis
    command: redis-server --requirepass ${REDIS_PWD}
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    networks:
      - finnep-network

  rabbitmq:
    image: rabbitmq:3-management
    container_name: finnep-rabbitmq
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USERNAME}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASSWORD}
    ports:
      - "5672:5672"
      - "15672:15672"
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq
    networks:
      - finnep-network

volumes:
  mongodb_data:
  redis_data:
  rabbitmq_data:

networks:
  finnep-network:
    driver: bridge
```

Deploy with Docker Compose:

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f backend

# Stop all services
docker-compose down

# Stop and remove volumes
docker-compose down -v
```

### 4. Docker Health Checks

Add health check to Dockerfile:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/front/', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"
```

---

## Manual Deployment

### 1. Build the Application

```bash
# Install dependencies
npm install --production

# Build the application
npm run esbuild

# Verify build output
ls -la dist/
```

### 2. Prepare Deployment Directory

```bash
# Create deployment directory
sudo mkdir -p /opt/deployment/finnep-backend
sudo chown $USER:$USER /opt/deployment/finnep-backend

# Copy files
cp -r dist/* /opt/deployment/finnep-backend/
cp -r staticPages /opt/deployment/finnep-backend/
cp -r emailTemplates /opt/deployment/finnep-backend/
cp .env /opt/deployment/finnep-backend/
cp package.json /opt/deployment/finnep-backend/
cp -r node_modules /opt/deployment/finnep-backend/

# Create logs directory
mkdir -p /opt/deployment/finnep-backend/logs
chmod -R 777 /opt/deployment/finnep-backend/logs
```

### 3. Start with PM2 (Recommended)

```bash
# Install PM2 globally
npm install -g pm2

# Start the application
cd /opt/deployment/finnep-backend
pm2 start app.min.js --name finnep-backend

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
pm2 startup
# Follow the instructions provided

# View logs
pm2 logs finnep-backend

# Monitor
pm2 monit

# Restart
pm2 restart finnep-backend

# Stop
pm2 stop finnep-backend

# Delete
pm2 delete finnep-backend
```

### 4. PM2 Ecosystem File

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'finnep-backend',
    script: './app.min.js',
    instances: 2, // Number of instances (or 'max' for all CPUs)
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_memory_restart: '1G',
    watch: false
  }]
};
```

Start with ecosystem file:

```bash
pm2 start ecosystem.config.js
```

### 5. Start with Node.js Directly

```bash
cd /opt/deployment/finnep-backend
node app.min.js
```

**Note:** Not recommended for production. Use PM2 or Docker instead.

---

## CI/CD Pipeline

### Jenkins Pipeline

The project includes a `Jenkinsfile` for automated deployment.

#### Pipeline Stages

1. **Build Stage:**
   - Install dependencies
   - Build application with esbuild
   - Copy files to deployment directory

2. **Deploy Stage:**
   - Stop existing instance
   - Start new instance with PM2

#### Jenkins Configuration

1. **Create Jenkins Job:**
   - New Item → Pipeline
   - Pipeline definition: Pipeline script from SCM
   - SCM: Git
   - Repository URL: Your repository URL
   - Script Path: `Jenkinsfile`

2. **Configure Credentials:**
   - Add SSH credentials for deployment server
   - Add Git credentials

3. **Build Triggers:**
   - Poll SCM: `H/5 * * * *` (every 5 minutes)
   - Or webhook trigger from Git

#### Manual Jenkins Build

```bash
# Trigger build via Jenkins CLI
java -jar jenkins-cli.jar -s http://jenkins-server:8080 build finnep-backend
```

### GitHub Actions (Alternative)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy Backend

on:
  push:
    branches: [ main, production ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm install

      - name: Build application
        run: npm run esbuild

      - name: Deploy to server
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.HOST }}
          username: ${{ secrets.USERNAME }}
          key: ${{ secrets.SSH_KEY }}
          script: |
            cd /opt/deployment/finnep-backend
            git pull
            npm install --production
            npm run esbuild
            pm2 restart finnep-backend
```

---

## Process Management

### PM2 Commands

```bash
# Start application
pm2 start app.min.js --name finnep-backend

# List all processes
pm2 list

# View logs
pm2 logs finnep-backend

# Monitor
pm2 monit

# Restart
pm2 restart finnep-backend

# Reload (zero-downtime)
pm2 reload finnep-backend

# Stop
pm2 stop finnep-backend

# Delete
pm2 delete finnep-backend

# Save current process list
pm2 save

# Resurrect saved processes
pm2 resurrect

# Show process info
pm2 show finnep-backend

# View memory usage
pm2 show finnep-backend | grep memory
```

### Systemd Service (Alternative)

Create `/etc/systemd/system/finnep-backend.service`:

```ini
[Unit]
Description=Finnep Event App Backend
After=network.target mongodb.service redis.service rabbitmq.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/deployment/finnep-backend
Environment=NODE_ENV=production
EnvironmentFile=/opt/deployment/finnep-backend/.env
ExecStart=/usr/bin/node app.min.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable finnep-backend
sudo systemctl start finnep-backend
sudo systemctl status finnep-backend
```

---

## Scaling

### Horizontal Scaling

The application is **stateless** and can be scaled horizontally:

1. **Load Balancer Setup:**
   ```nginx
   upstream finnep_backend {
       least_conn;
       server 10.0.1.10:3000;
       server 10.0.1.11:3000;
       server 10.0.1.12:3000;
   }
   ```

2. **Multiple Instances:**
   ```bash
   # Run multiple PM2 instances
   pm2 start app.min.js -i max --name finnep-backend
   ```

3. **Docker Swarm / Kubernetes:**
   - Deploy multiple container replicas
   - Use service discovery
   - Configure load balancing

### Vertical Scaling

- Increase server resources (CPU, RAM)
- Optimize database queries
- Increase connection pool sizes
- Add Redis caching

### Database Scaling

- **MongoDB Replica Set:** For read scaling
- **MongoDB Sharding:** For write scaling
- **Connection Pooling:** Optimize connection usage

---

## Health Checks

### Application Health

The application doesn't have a dedicated `/health` endpoint, but you can check:

```bash
# Check if server is responding
curl http://localhost:3000/front/

# Check MongoDB connection
mongosh "mongodb://user:pass@host:port/db" --eval "db.adminCommand('ping')"

# Check Redis connection
redis-cli -h host -p port -a password ping

# Check RabbitMQ
rabbitmqctl status
```

### Monitoring Script

Create `scripts/health-check.sh`:

```bash
#!/bin/bash

# Check application
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/front/)
if [ $HTTP_CODE -eq 200 ]; then
    echo "✓ Application is healthy"
else
    echo "✗ Application is unhealthy (HTTP $HTTP_CODE)"
    exit 1
fi

# Check MongoDB
if mongosh "mongodb://$MONGODB_USER:$MONGODB_PWD@$MONGODB_HOST:$MONGODB_PORT/$MONGODB_NAME" --eval "db.adminCommand('ping')" --quiet > /dev/null 2>&1; then
    echo "✓ MongoDB is healthy"
else
    echo "✗ MongoDB is unhealthy"
    exit 1
fi

# Check Redis
if redis-cli -h $REDIS_HOST -p $REDIS_PORT -a $REDIS_PWD ping > /dev/null 2>&1; then
    echo "✓ Redis is healthy"
else
    echo "✗ Redis is unhealthy"
    exit 1
fi

echo "All services are healthy"
```

---

## Monitoring

### Log Monitoring

```bash
# View application logs
tail -f /opt/deployment/finnep-backend/logs/combined.log.$(date +%Y-%m-%d)

# View error logs
tail -f /opt/deployment/finnep-backend/logs/error.log.$(date +%Y-%m-%d)

# View PM2 logs
pm2 logs finnep-backend

# Search logs
grep "ERROR" /opt/deployment/finnep-backend/logs/combined.log.*
```

### Application Metrics

- **Response Times:** Monitor API response times
- **Error Rates:** Track error rates
- **Request Volume:** Monitor request counts
- **Resource Usage:** CPU, memory, disk usage

### External Monitoring Tools

- **Prometheus + Grafana:** Metrics collection and visualization
- **ELK Stack:** Log aggregation and analysis
- **New Relic / Datadog:** APM and monitoring
- **Sentry:** Error tracking

---

## Backup & Recovery

### MongoDB Backup

```bash
# Create backup
mongodump --host=host:port \
  --username=user \
  --password=pass \
  --authenticationDatabase=admin \
  --db=finnep_eventapp \
  --out=/backup/mongodb/$(date +%Y%m%d)

# Restore backup
mongorestore --host=host:port \
  --username=user \
  --password=pass \
  --authenticationDatabase=admin \
  --db=finnep_eventapp \
  /backup/mongodb/20250115/finnep_eventapp
```

### Automated Backup Script

Create `scripts/backup.sh`:

```bash
#!/bin/bash

BACKUP_DIR="/backup/mongodb"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup
mongodump --host=$MONGODB_HOST:$MONGODB_PORT \
  --username=$MONGODB_USER \
  --password=$MONGODB_PWD \
  --authenticationDatabase=admin \
  --db=$MONGODB_NAME \
  --out=$BACKUP_DIR/$DATE

# Compress backup
tar -czf $BACKUP_DIR/$DATE.tar.gz $BACKUP_DIR/$DATE

# Remove uncompressed backup
rm -rf $BACKUP_DIR/$DATE

# Delete backups older than 30 days
find $BACKUP_DIR -name "*.tar.gz" -mtime +30 -delete

echo "Backup completed: $BACKUP_DIR/$DATE.tar.gz"
```

Schedule with cron:

```bash
# Add to crontab
0 2 * * * /path/to/scripts/backup.sh
```

### Application Files Backup

```bash
# Backup logs
tar -czf /backup/logs/logs_$(date +%Y%m%d).tar.gz /opt/deployment/finnep-backend/logs/

# Backup configuration
cp /opt/deployment/finnep-backend/.env /backup/config/.env.$(date +%Y%m%d)
```

---

## Troubleshooting

### Common Deployment Issues

#### Application Won't Start

**Check:**
1. Environment variables are set correctly
2. All services (MongoDB, Redis, RabbitMQ) are running
3. Port 3000 is not already in use
4. Logs for error messages

**Solution:**
```bash
# Check if port is in use
lsof -i :3000

# Kill process using port
kill -9 $(lsof -t -i:3000)

# Check service status
systemctl status mongodb
systemctl status redis
systemctl status rabbitmq
```

#### High Memory Usage

**Check:**
```bash
# Check memory usage
pm2 show finnep-backend | grep memory
free -h

# Check for memory leaks
node --inspect app.min.js
```

**Solution:**
- Increase server memory
- Optimize database queries
- Add Redis caching
- Restart application periodically

#### Database Connection Issues

**Check:**
```bash
# Test MongoDB connection
mongosh "mongodb://user:pass@host:port/db" --eval "db.adminCommand('ping')"

# Check MongoDB logs
tail -f /var/log/mongodb/mongod.log
```

**Solution:**
- Verify connection credentials
- Check network connectivity
- Verify MongoDB is running
- Check firewall rules

### Rollback Procedure

```bash
# Stop current version
pm2 stop finnep-backend

# Restore previous version
cd /opt/deployment/finnep-backend
git checkout <previous-commit-hash>
npm install --production
npm run esbuild

# Start previous version
pm2 start app.min.js --name finnep-backend
```

---

## Security Best Practices

1. **Keep Dependencies Updated:**
   ```bash
   npm audit
   npm audit fix
   ```

2. **Use HTTPS:** Always use SSL/TLS in production

3. **Firewall Rules:** Restrict access to necessary ports only

4. **Regular Backups:** Automated daily backups

5. **Monitor Logs:** Regular log review for security issues

6. **Secret Management:** Use secure secret management tools

7. **Rate Limiting:** Implement rate limiting for API endpoints

8. **Input Validation:** Always validate and sanitize inputs

---

## Performance Optimization

1. **Enable Gzip Compression:** In Nginx reverse proxy
2. **CDN Integration:** Use CloudFront for static assets
3. **Redis Caching:** Cache frequently accessed data
4. **Database Indexing:** Optimize database queries
5. **Connection Pooling:** Optimize connection usage
6. **Load Balancing:** Distribute load across instances

---

**Last Updated:** 2025-01-15
**Version:** 1.0
