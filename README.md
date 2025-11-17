# Finnep Event App Backend

A comprehensive RESTful API server built with Node.js and Express.js, designed to power the Finnep Event App frontend. It provides a robust, scalable backend infrastructure for event management, ticket sales, payment processing, and administrative operations.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Technology Stack](#technology-stack)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Application](#running-the-application)
- [Project Structure](#project-structure)
- [API Endpoints](#api-endpoints)
- [Database](#database)
- [Development](#development)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Architecture](#architecture)

---

## Overview

The Finnep Event App Backend is the core API service that handles:

- **Event Management:** Create, read, update, and delete events
- **Ticket Sales:** Ticket creation, validation, and management
- **Payment Processing:** Stripe integration for secure payments
- **User Management:** Admin, staff, and member user roles
- **Merchant Management:** Merchant account management
- **Content Management:** Photos, notifications, messages
- **Financial Reporting:** Event financial reports with external data aggregation
- **Guest Ticket Access:** Email-based ticket retrieval system
- **Background Jobs:** Scheduled tasks for email retries and event status updates

---

## Features

### Core Features

- ✅ **RESTful API Architecture** - Well-structured API routes for all operations
- ✅ **Authentication & Authorization** - JWT-based auth with RBAC (Admin, Staff, Member)
- ✅ **Payment Integration** - Stripe payment processing with webhooks
- ✅ **File Management** - AWS S3 integration with CloudFront CDN
- ✅ **Message Queue** - RabbitMQ for event-driven architecture
- ✅ **Caching** - Redis for performance optimization
- ✅ **Job Scheduling** - Agenda.js for background jobs
- ✅ **Email System** - Nodemailer with 7 email templates
- ✅ **Logging** - Winston with daily log rotation
- ✅ **Security** - Multi-layer security with encryption and validation
- ✅ **Financial Reports** - Comprehensive event financial reporting
- ✅ **Guest Access** - Email-based ticket retrieval with OTP verification

### Data Models

The backend uses **23+ Mongoose models**:

- **Core:** User, Role, Merchant, Event, Ticket, Order, Payment
- **Content:** Photo, PhotoType, Notification, Message, Contact
- **System:** Setting, Token, Venue, SocialMedia
- **Audit:** AuditTrail (via plugin)
- **Integration:** InboxMessage, OutboxMessage, ExternalTicketSales

---

## Technology Stack

- **Runtime:** Node.js (ES6 modules)
- **Framework:** Express.js
- **Database:** MongoDB with Mongoose ODM
- **Cache:** Redis
- **Message Queue:** RabbitMQ (AMQP)
- **Payment Gateway:** Stripe
- **File Storage:** AWS S3 with CloudFront CDN
- **Email Service:** Nodemailer
- **Job Scheduler:** Agenda.js
- **Logging:** Winston with daily rotation
- **Authentication:** JWT (jsonwebtoken)
- **File Upload:** Busboy
- **Validation:** Express Validator
- **QR Codes:** qrcode
- **Calendar:** ics
- **Excel:** exceljs

---

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** >= 18.x
- **MongoDB** >= 5.x
- **Redis** >= 6.x
- **RabbitMQ** >= 3.x
- **npm** or **yarn**

### Optional (for production)

- **Docker** (for containerized deployment)
- **PM2** (for process management)
- **Nginx** (for reverse proxy)

---

## Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd finnep-eventapp-backend
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env  # If .env.example exists
# Or create .env manually
```

See [Configuration](#configuration) section for all required environment variables.

### 4. Set Up Services

#### MongoDB

```bash
# macOS (using Homebrew)
brew install mongodb-community
brew services start mongodb-community

# Linux
sudo systemctl start mongod

# Docker
docker run -d -p 27017:27017 --name mongodb mongo:latest
```

#### Redis

```bash
# macOS (using Homebrew)
brew install redis
brew services start redis

# Linux
sudo systemctl start redis

# Docker
docker run -d -p 6379:6379 --name redis redis:latest
```

#### RabbitMQ

```bash
# macOS (using Homebrew)
brew install rabbitmq
brew services start rabbitmq

# Linux
sudo systemctl start rabbitmq-server

# Docker
docker run -d -p 5672:5672 -p 15672:15672 --name rabbitmq rabbitmq:3-management
```

### 5. Initialize Database

The application will automatically connect to MongoDB on startup. Ensure MongoDB is running and accessible with the credentials provided in your `.env` file.

---

## Configuration

### Environment Variables

Create a `.env` file in the root directory with the following variables:

#### Database Configuration

```env
# MongoDB
MONGODB_HOST=localhost
MONGODB_PORT=27017
MONGODB_USER=your_mongodb_user
MONGODB_PWD=your_mongodb_password
MONGODB_NAME=finnep_eventapp
```

#### Redis Configuration

```env
# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PWD=your_redis_password  # Optional, leave empty if no password
```

#### RabbitMQ Configuration

```env
# RabbitMQ
RABBITMQ_HOST=localhost
RABBITMQ_PORT=5672
RABBITMQ_USERNAME=guest
RABBITMQ_PASSWORD=guest
RABBITMQ_VHOST=/
RABBITMQ_HEARTBEAT=60
RABBITMQ_SSL=false
RABBITMQ_REJECT_UNAUTHORIZED=true
```

#### Stripe Configuration

```env
# Stripe Payment Gateway
STRIPE_KEY=sk_test_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
```

#### AWS Configuration

```env
# AWS S3 & CloudFront
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=eu-central-1
AWS_S3_BUCKET=your_s3_bucket_name
CLOUDFRONT_DOMAIN=your_cloudfront_domain
CLOUDFRONT_KEY_PAIR_ID=your_cloudfront_key_pair_id
CLOUDFRONT_PRIVATE_KEY=your_cloudfront_private_key
```

#### Email Configuration

```env
# Email Service (Nodemailer)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_email_password
EMAIL_FROM=noreply@finnep.fi
```

#### Application Configuration

```env
# Server
PORT=3000
NODE_ENV=development

# Frontend URLs (for CORS)
FRONTEND_URL=http://localhost:3000
CMS_URL=http://localhost:3002

# JWT
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=24h

# Company Information
COMPANY_NAME=Finnep
COMPANY_EMAIL=contact@finnep.fi
```

#### Guest Token Configuration

```env
# Guest Token (for ticket access)
GUEST_TOKEN_SECRET=your_guest_token_secret
GUEST_TOKEN_EXPIRES_IN=15m
```

### Environment-Specific Configuration

- **Development:** Use `.env` file with development values
- **Production:** Use environment variables or secure secret management
- **Docker:** Use Docker secrets or environment files

---

## Running the Application

### Development Mode

```bash
npm start
```

This will start the server with `nodemon` for automatic reloading on file changes.

The server will be available at `http://localhost:3000`

### Production Mode

#### Option 1: Direct Node.js

```bash
# Build the application
npm run esbuild

# Run the built application
node dist/app.min.js
```

#### Option 2: Using PM2

```bash
# Install PM2 globally
npm install -g pm2

# Start the application
pm2 start dist/app.min.js --name finnep-backend

# View logs
pm2 logs finnep-backend

# Monitor
pm2 monit
```

#### Option 3: Using Docker

```bash
# Build Docker image
docker build -t finnep-eventapp-backend .

# Run container
docker run -d -p 3000:3000 --env-file .env --name finnep-backend finnep-eventapp-backend
```

### Health Check

Once the server is running, you can verify it's working:

```bash
curl http://localhost:3000/front/
```

---

## Project Structure

```
finnep-eventapp-backend/
├── app.js                      # Express application entry point
├── bin/
│   └── www                     # Server startup script
├── controllers/                # Request handlers (13 controllers)
│   ├── api.controller.js       # Admin API endpoints
│   ├── front.controller.js     # Public-facing endpoints
│   ├── event.controller.js    # Event management
│   ├── ticket.controller.js    # Ticket management
│   ├── user.controller.js     # User management
│   ├── merchant.controller.js # Merchant management
│   ├── photo.controller.js    # Photo management
│   ├── notification.controller.js
│   ├── setting.controller.js
│   ├── message.controller.js
│   ├── contact.controller.js
│   ├── guest.controller.js    # Guest ticket access
│   └── report.controller.js    # Financial reports
├── model/                      # Database models (23+ models)
│   ├── mongoModel.js          # Mongoose schemas
│   ├── dbConnect.js           # MongoDB connection
│   ├── redisConnect.js        # Redis connection
│   ├── event.js
│   ├── ticket.js
│   ├── user.js
│   └── ...
├── routes/                     # API routes
│   ├── api.js                 # Admin routes (/api/*)
│   └── front.js               # Public routes (/front/*)
├── rabbitMQ/                   # Message queue handlers
│   ├── handlers/
│   │   ├── eventHandler.js
│   │   ├── merchantHandler.js
│   │   └── externalTicketSalesHandler.js
│   └── services/
│       ├── messageConsumer.js
│       └── queueSetup.js
├── services/                   # Business logic services
│   └── externalTicketSalesRequest.js
├── util/                       # Utility modules (12 modules)
│   ├── common.js
│   ├── aws.js
│   ├── jwtToken.js
│   ├── paymentActions.js
│   ├── sendMail.js
│   ├── rabbitmq.js
│   ├── busboyFileUpload.js
│   ├── createHash.js
│   ├── ticketMaster.js
│   ├── schedular.js
│   ├── adminUser.js
│   └── uploadQueueProcess.js
├── emailTemplates/             # Email templates (7 templates)
│   ├── ticket_template.html
│   ├── verification_code.html
│   └── ...
├── staticPages/                # Static HTML pages
├── logs/                       # Application logs
├── docs/                       # Documentation
│   └── ARCHITECTURE.md        # Architecture documentation
├── Dockerfile                  # Docker configuration
├── Jenkinsfile                 # CI/CD pipeline
├── package.json
└── README.md
```

---

## API Endpoints

### Base URLs

- **Admin API:** `http://localhost:3000/api`
- **Public API:** `http://localhost:3000/front`

### Authentication

All admin endpoints require JWT authentication. Include the token in the `Authorization` header:

```
Authorization: Bearer <your_jwt_token>
```

### Main Endpoint Groups

#### Admin API (`/api/*`)

- **Authentication:** `/api/auth/user/login`
- **Users:** `/api/user/admin`, `/api/user/staff`
- **Events:** `/api/event`
- **Tickets:** `/api/singleTicket`, `/api/multipleTicket`
- **Merchants:** `/api/merchant`
- **Photos:** `/api/photo`
- **Notifications:** `/api/notification`
- **Settings:** `/api/setting`
- **Dashboard:** `/api/dashboard`
- **Financial Reports:** `/api/event/:eventId/financial-report`

#### Public API (`/front/*`)

- **Frontend Data:** `/front/`
- **Events:** `/front/events`, `/front/event/:id`
- **Payment:** `/front/create-checkout-session`, `/front/payment-success`
- **Tickets:** `/front/ticket`
- **Guest Access:** `/front/guest/check-email`, `/front/guest/tickets`
- **Free Events:** `/front/free-event-register`

### API Documentation

For detailed API documentation, see:
- [API Reference](./docs/API_REFERENCE.md) (coming soon)
- Architecture documentation: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)

---

## Database

### MongoDB

The application uses MongoDB with Mongoose ODM. All models are defined in `model/mongoModel.js`.

#### Connection

The database connection is established automatically on application startup via `model/dbConnect.js`.

#### Models

- **23+ Mongoose models** covering all business entities
- **Audit plugin** for automatic change tracking
- **Indexes** for query optimization

#### Database Operations

- All CRUD operations are handled through model functions
- Transactions are supported for complex operations
- Connection pooling is handled automatically by Mongoose

---

## Development

### Code Style

- Use ES6 modules (`import`/`export`)
- Follow Express.js best practices
- Use async/await for asynchronous operations
- Add JSDoc comments for functions

### Adding New Features

1. **Create Model** (if needed): Add schema to `model/mongoModel.js`
2. **Create Controller**: Add handler in `controllers/`
3. **Create Route**: Add route in `routes/api.js` or `routes/front.js`
4. **Add Validation**: Use Express Validator for input validation
5. **Add Tests**: Write tests for new functionality

### Debugging

- **Logs:** Check `logs/` directory for application logs
- **Winston:** Structured logging with daily rotation
- **Error Logs:** Detailed error logs with stack traces

### Hot Reload

Development mode uses `nodemon` for automatic server restart on file changes.

---

## Testing

### Running Tests

```bash
# Run all tests (if test suite exists)
npm test
```

### Manual Testing

Use tools like:
- **Postman** - API testing
- **curl** - Command-line testing
- **Thunder Client** - VS Code extension

### Test Endpoints

```bash
# Health check
curl http://localhost:3000/front/

# Test authentication
curl -X POST http://localhost:3000/api/auth/user/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}'
```

---

## Troubleshooting

### Common Issues

#### MongoDB Connection Error

**Problem:** `MongoServerSelectionError: connection closed`

**Solutions:**
1. Verify MongoDB is running: `mongosh` or `mongo`
2. Check connection credentials in `.env`
3. Verify network connectivity
4. Check MongoDB logs

#### Redis Connection Error

**Problem:** `Redis connection failed`

**Solutions:**
1. Verify Redis is running: `redis-cli ping`
2. Check Redis credentials in `.env`
3. Verify Redis port (default: 6379)
4. Check firewall settings

#### RabbitMQ Connection Error

**Problem:** `RabbitMQ connection error`

**Solutions:**
1. Verify RabbitMQ is running: `rabbitmqctl status`
2. Check RabbitMQ credentials in `.env`
3. Verify RabbitMQ port (default: 5672)
4. Check RabbitMQ management UI: `http://localhost:15672`

#### Port Already in Use

**Problem:** `EADDRINUSE: address already in use`

**Solutions:**
1. Change `PORT` in `.env`
2. Kill process using port: `lsof -ti:3000 | xargs kill`
3. Use different port

#### JWT Token Errors

**Problem:** `Invalid or expired token`

**Solutions:**
1. Verify `JWT_SECRET` is set in `.env`
2. Check token expiration time
3. Ensure token is included in `Authorization` header
4. Verify token format: `Bearer <token>`

### Logs

Check application logs in `logs/` directory:

```bash
# View latest log
tail -f logs/combined.log.$(date +%Y-%m-%d)

# View error log
tail -f logs/error.log.$(date +%Y-%m-%d)
```

### Getting Help

- Check [Architecture Documentation](./docs/ARCHITECTURE.md)
- Review error logs in `logs/` directory
- Check environment variables configuration
- Verify all services are running

---

## Architecture

For detailed architecture documentation, see:

- **[Architecture Documentation](./docs/ARCHITECTURE.md)** - System architecture, data flow, security, and deployment diagrams

### Key Architecture Components

- **RESTful API** - Express.js with route-based controllers
- **Database Layer** - MongoDB with Mongoose ODM
- **Caching Layer** - Redis for performance
- **Message Queue** - RabbitMQ for event-driven architecture
- **Background Jobs** - Agenda.js for scheduled tasks
- **Security** - Multi-layer security with JWT and RBAC

---

## License

MIT

---

## Author

**Binit Shrestha**
Company: Finnep
Homepage: https://eventapp.finnep.fi

---

**Last Updated:** 2025-01-15
**Version:** 0.0.0

