# Finnep Event App Backend - Architecture Documentation

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Diagrams](#architecture-diagrams)
3. [Data Flow](#data-flow)
4. [Security Architecture](#security-architecture)
5. [Database Architecture](#database-architecture)
6. [Message Queue Architecture](#message-queue-architecture)
7. [Component Details](#component-details)

---

## System Overview

The Finnep Event App Backend is a RESTful API server built with Node.js and Express.js. It serves as the core backend infrastructure for event management, ticket sales, payment processing, and administrative operations.

### Key Technologies

- **Runtime:** Node.js (ES6 modules)
- **Framework:** Express.js
- **Database:** MongoDB with Mongoose ODM
- **Cache:** Redis
- **Message Queue:** RabbitMQ (AMQP)
- **Payment Gateway:** Stripe
- **File Storage:** AWS S3 with CloudFront CDN
- **Email Service:** Nodemailer
- **Job Scheduler:** Agenda.js
- **Logging:** Winston

---

## Architecture Diagrams

### 1. System Overview

```mermaid
graph TB
    subgraph "Client Layer"
        FE[Frontend App<br/>Next.js]
        CMS[CMS System<br/>Next.js]
    end

    subgraph "API Layer"
        API[Express.js API Server<br/>Port 3000]
        ROUTES[Routes<br/>/api & /front]
    end

    subgraph "Business Logic Layer"
        CTRL[Controllers<br/>11 Controllers]
        SRV[Services<br/>Business Logic]
        UTIL[Utilities<br/>12 Modules]
    end

    subgraph "Data Layer"
        MONGO[(MongoDB<br/>23+ Models)]
        REDIS[(Redis<br/>Cache)]
    end

    subgraph "External Services"
        RABBIT[RabbitMQ<br/>Message Queue]
        STRIPE[Stripe<br/>Payment]
        S3[AWS S3<br/>File Storage]
        CDN[CloudFront<br/>CDN]
        EMAIL[Nodemailer<br/>Email Service]
    end

    subgraph "Background Jobs"
        AGENDA[Agenda.js<br/>Job Scheduler]
    end

    FE -->|HTTP/HTTPS| API
    CMS -->|HTTP/HTTPS| API
    API --> ROUTES
    ROUTES --> CTRL
    CTRL --> SRV
    SRV --> UTIL
    CTRL --> MONGO
    CTRL --> REDIS
    CTRL --> RABBIT
    CTRL --> STRIPE
    CTRL --> S3
    S3 --> CDN
    CTRL --> EMAIL
    AGENDA --> MONGO
    AGENDA --> EMAIL
    RABBIT --> CTRL
```

### 2. Request Flow Architecture

```mermaid
sequenceDiagram
    participant Client
    participant Express
    participant Routes
    participant Controller
    participant Service
    participant MongoDB
    participant Redis
    participant RabbitMQ

    Client->>Express: HTTP Request
    Express->>Express: CORS & Security Headers
    Express->>Routes: Route Matching
    Routes->>Controller: Handler Function
    Controller->>Controller: JWT Validation
    Controller->>Redis: Check Cache
    alt Cache Hit
        Redis-->>Controller: Cached Data
        Controller-->>Client: Response
    else Cache Miss
        Controller->>Service: Business Logic
        Service->>MongoDB: Database Query
        MongoDB-->>Service: Data
        Service->>Redis: Store in Cache
        Service-->>Controller: Processed Data
        Controller->>RabbitMQ: Publish Event (if needed)
        Controller-->>Client: Response
    end
```

### 3. Authentication & Authorization Flow

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant JWT
    participant Redis
    participant Controller

    Client->>API: Login Request
    API->>API: Validate Credentials
    API->>JWT: Generate Token
    JWT-->>API: JWT Token
    API->>Redis: Store Token (optional)
    API-->>Client: Token + User Info

    Note over Client,Controller: Subsequent Requests

    Client->>API: Request with Token
    API->>JWT: Verify Token
    JWT->>JWT: Decode & Validate
    alt Valid Token
        JWT-->>API: User Payload
        API->>Controller: Authorized Request
        Controller-->>Client: Response
    else Invalid Token
        JWT-->>API: Error
        API-->>Client: 401 Unauthorized
    end
```

### 4. Payment Processing Flow

```mermaid
sequenceDiagram
    participant Customer
    participant Frontend
    participant Backend
    participant Stripe
    participant MongoDB
    participant RabbitMQ

    Customer->>Frontend: Initiate Payment
    Frontend->>Backend: Create Checkout Session
    Backend->>Stripe: Create Session
    Stripe-->>Backend: Session ID
    Backend-->>Frontend: Session ID
    Frontend->>Stripe: Redirect to Payment
    Stripe-->>Customer: Payment Form
    Customer->>Stripe: Complete Payment
    Stripe->>Backend: Webhook (Payment Success)
    Backend->>Backend: Verify Webhook Signature
    Backend->>MongoDB: Create Ticket
    Backend->>MongoDB: Create Payment Record
    Backend->>RabbitMQ: Publish Ticket Created Event
    Backend->>Backend: Send Confirmation Email
    Backend-->>Stripe: Webhook Acknowledged
```

### 5. Message Queue Architecture

```mermaid
graph LR
    subgraph "Backend Service"
        PUB[Publisher<br/>MessageConsumer]
        SUB[Subscriber<br/>Queue Handlers]
    end

    subgraph "RabbitMQ"
        EXCHANGE[Event Merchant Exchange<br/>Topic Type]
        MQ1[merchant-events-queue]
        MQ2[event-events-queue]
        MQ3[external-ticket-sales-queue]
        DLX[Dead Letter Exchange<br/>event-merchant-dlx]
        DLQ[DLQ Queues]
    end

    subgraph "External Services"
        EXT[External Microservices]
    end

    PUB -->|Publish| EXCHANGE
    EXCHANGE -->|Route| MQ1
    EXCHANGE -->|Route| MQ2
    EXCHANGE -->|Route| MQ3
    SUB -->|Consume| MQ1
    SUB -->|Consume| MQ2
    SUB -->|Consume| MQ3
    MQ1 -.->|Failed Messages| DLX
    MQ2 -.->|Failed Messages| DLX
    MQ3 -.->|Failed Messages| DLX
    DLX --> DLQ
    EXT -->|Publish| EXCHANGE
```

### 6. Database Schema Relationships

```mermaid
erDiagram
    USER ||--o{ TICKET : creates
    USER ||--o{ ORDER : places
    USER ||--o{ PAYMENT : makes
    MERCHANT ||--o{ EVENT : organizes
    MERCHANT ||--o{ USER : has
    EVENT ||--o{ TICKET : generates
    EVENT ||--o{ PHOTO : has
    EVENT ||--o{ ORDER : receives
    ORDER ||--o{ TICKET : contains
    ORDER ||--|| PAYMENT : has
    TICKET ||--|| PAYMENT : paid_by
    PHOTO ||--o{ EVENT : belongs_to
    SETTING ||--o{ MERCHANT : configures
    NOTIFICATION ||--o{ USER : sends_to
    MESSAGE ||--o{ USER : sends_to
    CONTACT ||--o{ USER : belongs_to
    ROLE ||--o{ USER : assigned_to
```

---

## Data Flow

### 1. Event Creation Flow

```mermaid
flowchart TD
    START([Admin Creates Event]) --> VALIDATE{Validate Input}
    VALIDATE -->|Invalid| ERROR[Return Error]
    VALIDATE -->|Valid| CREATE[Create Event in MongoDB]
    CREATE --> PUBLISH[Publish to RabbitMQ]
    PUBLISH --> CACHE[Update Cache]
    CACHE --> EMAIL[Send Notifications]
    EMAIL --> SUCCESS([Event Created])
    ERROR --> END([End])
    SUCCESS --> END
```

### 2. Ticket Purchase Flow

```mermaid
flowchart TD
    START([Customer Selects Tickets]) --> CHECK[Check Availability]
    CHECK -->|Not Available| SOLD_OUT([Sold Out])
    CHECK -->|Available| STRIPE[Create Stripe Session]
    STRIPE --> PAY[Customer Pays]
    PAY -->|Success| WEBHOOK[Stripe Webhook]
    WEBHOOK --> VERIFY[Verify Webhook]
    VERIFY --> CREATE_TICKET[Create Tickets]
    CREATE_TICKET --> CREATE_PAYMENT[Create Payment Record]
    CREATE_PAYMENT --> PUBLISH[Publish Event]
    PUBLISH --> EMAIL[Send Ticket Email]
    EMAIL --> SUCCESS([Purchase Complete])
    PAY -->|Failed| FAIL([Payment Failed])
    VERIFY -->|Invalid| REJECT([Reject Webhook])
```

### 3. Guest Ticket Access Flow

```mermaid
sequenceDiagram
    participant Guest
    participant API
    participant Redis
    participant Email
    participant MongoDB

    Guest->>API: Enter Email
    API->>Redis: Check Rate Limit
    alt Rate Limited
        Redis-->>API: Rate Limit Error
        API-->>Guest: Too Many Requests
    else Allowed
        API->>Redis: Generate OTP Code
        API->>Email: Send Verification Code
        Email-->>Guest: 8-digit Code
        Guest->>API: Enter Code
        API->>Redis: Verify Code
        alt Valid Code
            Redis-->>API: Valid
            API->>API: Generate Guest Token
            API-->>Guest: Guest Token (15 min)
            Guest->>API: Request Tickets (with Token)
            API->>MongoDB: Query Tickets by Email
            MongoDB-->>API: Tickets
            API-->>Guest: Ticket List
        else Invalid Code
            Redis-->>API: Invalid
            API-->>Guest: Invalid Code Error
        end
    end
```

---

## Security Architecture

### 1. Security Layers

```mermaid
graph TB
    subgraph "Layer 1: Network Security"
        HTTPS[HTTPS/TLS]
        CORS[CORS Configuration]
    end

    subgraph "Layer 2: Application Security"
        HEADERS[Security Headers<br/>X-Frame-Options<br/>X-XSS-Protection<br/>CSP]
        VALIDATE[Input Validation<br/>Express Validator]
    end

    subgraph "Layer 3: Authentication"
        JWT[JWT Tokens]
        BCRYPT[Password Hashing<br/>bcrypt]
    end

    subgraph "Layer 4: Authorization"
        RBAC[Role-Based Access Control<br/>Admin, Staff, Member]
        PERM[Permission Checks]
    end

    subgraph "Layer 5: Data Security"
        SANITIZE[Data Sanitization]
        ENCRYPT[Sensitive Data Encryption]
    end

    HTTPS --> HEADERS
    HEADERS --> VALIDATE
    VALIDATE --> JWT
    JWT --> RBAC
    RBAC --> PERM
    PERM --> SANITIZE
    SANITIZE --> ENCRYPT
```

### 2. JWT Token Structure

```mermaid
graph LR
    TOKEN[JWT Token] --> HEADER[Header<br/>alg: HS256<br/>typ: JWT]
    TOKEN --> PAYLOAD[Payload<br/>id: User ID<br/>username: Username<br/>role: User Role<br/>iat: Issued At<br/>exp: Expiration]
    TOKEN --> SIGNATURE[Signature<br/>HMACSHA256<br/>base64UrlEncode]
```

### 3. Role-Based Access Control

```mermaid
graph TD
    USER[User Request] --> AUTH{Authenticated?}
    AUTH -->|No| DENY[401 Unauthorized]
    AUTH -->|Yes| ROLE{Check Role}
    ROLE -->|Admin| ADMIN[Full Access]
    ROLE -->|Staff| STAFF[Limited Access]
    ROLE -->|Member| MEMBER[Read-Only]
    ADMIN --> ALLOW[Allow Request]
    STAFF --> CHECK_PERM{Check Permission}
    MEMBER --> CHECK_PERM
    CHECK_PERM -->|Has Permission| ALLOW
    CHECK_PERM -->|No Permission| DENY
```

---

## Database Architecture

### 1. MongoDB Connection Strategy

```mermaid
graph TB
    APP[Application Start] --> CONNECT[Connect to MongoDB]
    CONNECT --> OPTIONS[Connection Options<br/>- Retry Writes<br/>- Retry Reads<br/>- Keep Alive<br/>- Timeouts]
    OPTIONS --> POOL[Connection Pool]
    POOL --> QUERY[Execute Queries]
    QUERY -->|Error| RETRY[Retry Connection]
    RETRY --> CONNECT
    QUERY -->|Success| RESULT[Return Results]
```

### 2. Data Models Overview

The backend uses **23+ Mongoose models**:

- **Core Models:** User, Role, Merchant, Event, Ticket, Order, Payment
- **Content Models:** Photo, PhotoType, Notification, Message, Contact
- **System Models:** Setting, Token, Venue, SocialMedia
- **Audit Models:** AuditTrail (via plugin)
- **Integration Models:** InboxMessage, OutboxMessage, ExternalTicketSales

### 3. Indexing Strategy

- **Primary Keys:** All models have `_id` indexed
- **Foreign Keys:** References to other models are indexed
- **Query Fields:** Frequently queried fields are indexed
- **Compound Indexes:** Multi-field queries use compound indexes

---

## Message Queue Architecture

### 1. Queue Setup

The backend consumes messages from three queues:

1. **merchant-events-queue** - Merchant lifecycle events
2. **event-events-queue** - Event lifecycle events
3. **external-ticket-sales-queue** - External ticket sales data

### 2. Message Handlers

```mermaid
graph LR
    QUEUE[RabbitMQ Queue] --> HANDLER[Message Handler]
    HANDLER --> VALIDATE{Validate Message}
    VALIDATE -->|Invalid| DLQ[Dead Letter Queue]
    VALIDATE -->|Valid| PROCESS[Process Message]
    PROCESS --> SAVE[Save to MongoDB]
    SAVE --> INBOX[Save to Inbox]
    INBOX --> ACK[Acknowledge Message]
    ACK --> SUCCESS[Success]
    DLQ --> RETRY[Retry Later]
```

### 3. Dead Letter Queue (DLQ)

- **Exchange:** `event-merchant-dlx` (topic type)
- **Queue:** `dlq.external-ticket-sales-queue.retry-1`
- **Purpose:** Handle failed messages for retry
- **Retry Strategy:** Exponential backoff

---

## Component Details

### 1. Controllers (11 Controllers)

- **api.controller.js** - Admin API endpoints
- **front.controller.js** - Public-facing endpoints
- **event.controller.js** - Event management
- **ticket.controller.js** - Ticket management
- **user.controller.js** - User management
- **merchant.controller.js** - Merchant management
- **photo.controller.js** - Photo management
- **notification.controller.js** - Notification management
- **setting.controller.js** - Settings management
- **message.controller.js** - Message management
- **contact.controller.js** - Contact management
- **guest.controller.js** - Guest ticket access
- **report.controller.js** - Financial reports

### 2. Services

- **externalTicketSalesRequest.js** - Request external ticket sales data

### 3. Utilities (12 Modules)

- **common.js** - Common utility functions
- **aws.js** - AWS S3 and CloudFront utilities
- **jwtToken.js** - JWT token generation and validation
- **paymentActions.js** - Stripe payment processing
- **sendMail.js** - Email sending utilities
- **rabbitmq.js** - RabbitMQ connection management
- **busboyFileUpload.js** - File upload processing
- **createHash.js** - Password hashing utilities
- **ticketMaster.js** - Ticket generation and management
- **schedular.js** - Job scheduling utilities
- **adminUser.js** - Admin user management
- **uploadQueueProcess.js** - Background upload processing

### 4. Background Jobs (Agenda.js)

- **Email Retry Jobs** - Retry failed email sends
- **Event Status Updates** - Update event statuses
- **Cleanup Jobs** - Periodic cleanup tasks

---

## Deployment Architecture

### 1. Production Deployment

```mermaid
graph TB
    subgraph "Load Balancer"
        LB[Nginx/ALB]
    end

    subgraph "Application Servers"
        APP1[Backend Instance 1]
        APP2[Backend Instance 2]
        APP3[Backend Instance N]
    end

    subgraph "Data Layer"
        MONGO[(MongoDB<br/>Replica Set)]
        REDIS[(Redis<br/>Cluster)]
        RABBIT[RabbitMQ<br/>Cluster]
    end

    subgraph "External Services"
        STRIPE[Stripe API]
        S3[AWS S3]
        CDN[CloudFront]
    end

    LB --> APP1
    LB --> APP2
    LB --> APP3
    APP1 --> MONGO
    APP2 --> MONGO
    APP3 --> MONGO
    APP1 --> REDIS
    APP2 --> REDIS
    APP3 --> REDIS
    APP1 --> RABBIT
    APP2 --> RABBIT
    APP3 --> RABBIT
    APP1 --> STRIPE
    APP2 --> STRIPE
    APP3 --> STRIPE
    APP1 --> S3
    APP2 --> S3
    APP3 --> S3
    S3 --> CDN
```

### 2. Scaling Strategy

- **Horizontal Scaling:** Stateless API servers can be scaled horizontally
- **Database Scaling:** MongoDB replica sets for read scaling
- **Cache Scaling:** Redis cluster for distributed caching
- **Queue Scaling:** RabbitMQ cluster for high availability

---

## Performance Optimizations

1. **Redis Caching:** Frequently accessed data cached in Redis
2. **Database Indexing:** Optimized queries with proper indexes
3. **Connection Pooling:** MongoDB and Redis connection pooling
4. **CDN Integration:** Static assets served via CloudFront
5. **Async Processing:** Background jobs for heavy operations
6. **Message Queues:** Asynchronous event processing

---

## Monitoring & Logging

- **Winston Logger:** Structured logging with daily rotation
- **Error Logging:** Detailed error logs with stack traces
- **Request Logging:** All API requests logged
- **Health Checks:** Endpoint health monitoring
- **Log Files:** Daily rotated log files in `logs/` directory

---

**Last Updated:** 2025-01-15
**Version:** 1.0

