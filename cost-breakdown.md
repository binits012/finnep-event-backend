# Development Cost Breakdown - Finnep Event App Backend
## Internal Employee Costs (Finnish Market)

### Executive Summary

**Total Project Cost: €25,000 - €35,000**

This document provides a detailed cost breakdown for developing the Finnep Event App Backend using internal employees in the Finnish market, including all employer costs and overhead.

---

## Application Overview

### What is Finnep Event App Backend?

Finnep Event App Backend is a comprehensive RESTful API server built with Node.js and Express.js, designed to power the Finnep Event App frontend. It provides a robust, scalable backend infrastructure for event management, ticket sales, payment processing, and administrative operations.

### Key Features

#### 1. RESTful API Architecture
- **Express.js Framework:** Modern Node.js web application framework
- **RESTful Endpoints:** Well-structured API routes for all operations
- **Request/Response Handling:** Comprehensive request validation and response formatting
- **Error Handling:** Centralized error handling with proper HTTP status codes
- **CORS Configuration:** Secure cross-origin resource sharing setup

#### 2. Database & Data Management
- **MongoDB Integration:** Full MongoDB integration with Mongoose ODM
- **23+ Data Models:** Comprehensive data models including:
  - Events, Tickets, Orders, Payments
  - Users, Roles, Merchants
  - Photos, Notifications, Messages
  - Settings, Contacts, Reports
  - Tokens,Venues
- **Database Operations:** CRUD operations with validation and error handling
- **Data Relationships:** Complex relationships between entities
- **Query Optimization:** Efficient database queries with indexing

#### 3. Authentication & Authorization
- **JWT Token System:** JSON Web Token-based authentication
- **Role-Based Access Control (RBAC):** Admin, Staff, and Member roles
- **Password Management:** Secure password hashing with bcrypt
- **Token Validation:** Token verification and refresh mechanisms
- **User Management:** User creation, update, deletion, and role management

#### 4. Payment Processing
- **Stripe Integration:** Full Stripe payment gateway integration
- **Payment Intent Creation:** Server-side payment intent creation
- **Webhook Handling:** Stripe webhook processing for payment events
- **Payment Success Flow:** Complete payment success handling
- **Payment Records:** Payment tracking and record management
- **Refund Processing:** Payment cancellation and refund handling

#### 5. Event Management
- **Event CRUD Operations:** Create, read, update, delete events
- **Event Filtering:** Advanced filtering and search capabilities
- **Event Status Management:** Active/inactive event status handling
- **Featured Events:** Featured event system with priority and sticky types
- **Event Photos:** Multiple photo upload and management
- **Event Metadata:** Comprehensive event information management
- **Timezone Support:** Timezone-aware event date handling

#### 6. Ticket Management
- **Ticket Creation:** Single and bulk ticket creation
- **Ticket Types:** Multiple ticket types with different pricing
- **Ticket Availability:** Real-time ticket availability tracking
- **Ticket Check-in:** Ticket check-in functionality
- **Ticket Search:** Advanced ticket search capabilities
- **Excel Import:** Bulk ticket import via Excel files
- **Ticket Validation:** Ticket validation and verification

#### 7. Order Management
- **Order Processing:** Complete order lifecycle management
- **Order Tickets:** Order-ticket relationship management
- **Order Cancellation:** Order cancellation with refund handling
- **Order Tracking:** Order status tracking and updates
- **Order Reports:** Order reporting and analytics

#### 8. Message Queue System (RabbitMQ)
- **RabbitMQ Integration:** Full RabbitMQ message queue integration
- **Message Publishing:** Publish messages to queues
- **Message Consumption:** Consume messages from queues
- **Queue Management:** Queue setup, configuration, and management
- **Event Handlers:** Event and merchant message handlers
- **Channel Management:** Robust channel connection management
- **Error Handling:** Message processing error handling and retry logic

#### 9. Email System
- **Nodemailer Integration:** Email sending with Nodemailer
- **7 Email Templates:** Comprehensive email templates:
  - Ticket confirmation emails
  - Career application acknowledgements
  - Feedback acknowledgements
  - Merchant activation/suspension notifications
  - Merchant arrival notifications
  - Failure reports
- **Email Retry Logic:** Automatic email retry on failure
- **Email Reporting:** Email delivery tracking and reporting
- **Template Rendering:** Dynamic email template rendering

#### 10. File Upload & Storage
- **AWS S3 Integration:** Full AWS S3 integration for file storage
- **File Upload Handling:** Busboy-based file upload processing
- **Image Processing:** Image upload and processing
- **CloudFront Integration:** CloudFront CDN integration for file delivery
- **Signed URLs:** Secure signed URL generation for file access
- **Stream Uploads:** Stream-based parallel uploads for large files

#### 11. Caching System
- **Redis Integration:** Redis caching for performance optimization
- **Cache Management:** Cache key management and expiration
- **CloudFront URL Caching:** Cached CloudFront signed URLs
- **Data Caching:** Frequently accessed data caching

#### 12. Job Scheduling
- **Agenda.js Integration:** Job scheduling with Agenda.js
- **Scheduled Tasks:** Automated scheduled tasks
- **Email Retry Jobs:** Scheduled email retry jobs
- **Background Processing:** Background job processing
- **Job Lock Management:** Job locking and unlock mechanisms

#### 13. Logging & Monitoring
- **Winston Logger:** Comprehensive logging with Winston
- **Daily Rotate Logs:** Daily log file rotation
- **Error Logging:** Detailed error logging with stack traces
- **Info Logging:** Information logging for debugging
- **Log Management:** Log file management and archival

#### 14. Security Features
- **Security Headers:** HTTP security headers (X-Frame-Options, X-XSS-Protection, etc.)
- **CORS Configuration:** Secure CORS setup
- **Input Validation:** Request input validation
- **SQL Injection Prevention:** MongoDB injection prevention
- **XSS Protection:** Cross-site scripting protection
- **CSRF Protection:** Cross-site request forgery protection

#### 15. API Controllers (11 Controllers)
- **Front Controller:** Public-facing API endpoints
- **API Controller:** Admin API endpoints
- **Event Controller:** Event management endpoints
- **Ticket Controller:** Ticket management endpoints
- **User Controller:** User management endpoints
- **Merchant Controller:** Merchant management endpoints
- **Photo Controller:** Photo management endpoints
- **Notification Controller:** Notification management endpoints
- **Setting Controller:** Settings management endpoints
- **Message Controller:** Message management endpoints
- **Contact Controller:** Contact management endpoints

#### 16. Utility Modules (12 Utilities)
- **Common Utilities:** Shared utility functions
- **AWS Utilities:** AWS S3 and CloudFront utilities
- **JWT Token Utilities:** Token generation and validation
- **Payment Actions:** Payment processing utilities
- **Email Utilities:** Email sending utilities
- **RabbitMQ Utilities:** RabbitMQ connection management
- **File Upload Utilities:** File upload processing
- **Hash Utilities:** Password hashing utilities
- **Ticket Master:** Ticket generation and management
- **Scheduler Utilities:** Job scheduling utilities
- **Admin User Utilities:** Admin user management
- **Upload Queue Processing:** Background upload processing

#### 17. Additional Features
- **Excel File Generation:** Excel file generation for reports
- **QR Code Generation:** QR code generation for tickets
- **ICS File Generation:** Calendar event file generation
- **Reporting System:** Comprehensive reporting system
- **Dashboard Analytics:** Dashboard data aggregation
- **Static Pages:** Static HTML page generation
- **Docker Support:** Docker containerization
- **CI/CD Integration:** Jenkins CI/CD pipeline

### Technical Architecture

- **Runtime:** Node.js with ES6 modules
- **Framework:** Express.js
- **Database:** MongoDB with Mongoose ODM
- **Cache:** Redis
- **Message Queue:** RabbitMQ
- **Payment Gateway:** Stripe
- **File Storage:** AWS S3 with CloudFront CDN
- **Email Service:** Nodemailer
- **Job Scheduler:** Agenda.js
- **Logging:** Winston
- **Authentication:** JWT
- **File Upload:** Busboy
- **Validation:** Express Validator

### Target Market

The backend serves:
- **Frontend Application:** Next.js frontend application
- **CMS System:** Content management system
- **Merchants:** Event organizers and merchants
- **End Users:** Event-goers purchasing tickets
- **Administrators:** System administrators managing the platform

### Business Value

The backend enables:
- **Scalable Architecture:** Handles high traffic and concurrent users
- **Secure Payments:** Secure payment processing with Stripe
- **Reliable Operations:** Message queue and job scheduling for reliability
- **Performance:** Redis caching for optimal performance
- **Automation:** Automated email sending and job processing
- **Analytics:** Comprehensive reporting and analytics
- **Multi-tenant Support:** Support for multiple merchants

---

## 1. Finnish Market Rates (2024-2025)

### Monthly Salaries
- **Junior Developer:** €3,500 - €4,400/month
- **Mid-Level Developer:** €4,200 - €5,500/month
- **Senior Developer:** €5,300 - €7,000/month

### Hourly Rates (160 working hours/month)
- **Junior Developer:** €21.88 - €27.50/hour
- **Mid-Level Developer:** €26.25 - €34.38/hour
- **Senior Developer:** €33.13 - €43.75/hour

### Total Employer Cost (Salary + 25% Employer Contributions)
- **Junior Developer:** €27.34 - €34.38/hour
- **Mid-Level Developer:** €32.81 - €42.98/hour
- **Senior Developer:** €41.41 - €54.69/hour

> **Note:** Employer contributions include:
> - Social security (TyEL): ~17%
> - Unemployment insurance: ~1.5%
> - Accident insurance: ~0.5%
> - Other statutory costs: ~6%
> - **Total: ~25%**

---

## 2. Detailed Cost Breakdown by Component

### 2.1 Core Infrastructure & Setup
- **Description:** Express.js setup, project structure, environment configuration, middleware setup
- **Hours:** 20-25 hours
- **Rate:** €35/hour (Mid-level)
- **Cost:** €700 - €875

### 2.2 Database Design & Models
- **Description:** MongoDB schema design, 24+ Mongoose models, relationships, validation
- **Hours:** 50-65 hours
- **Rate:** €40/hour (Senior)
- **Cost:** €2,000 - €2,600

### 2.3 Authentication & Authorization
- **Description:** JWT implementation, RBAC system, password hashing, token management
- **Hours:** 30-40 hours
- **Rate:** €40/hour (Senior)
- **Cost:** €1,200 - €1,600

### 2.4 Payment Integration
- **Description:** Stripe integration, payment intents, webhooks, payment success flow
- **Hours:** 35-45 hours
- **Rate:** €45/hour (Senior)
- **Cost:** €1,575 - €2,025

### 2.5 Event Management API
- **Description:** Event CRUD operations, filtering, search, status management, featured events
- **Hours:** 40-50 hours
- **Rate:** €35/hour (Mid-level)
- **Cost:** €1,400 - €1,750

### 2.6 Ticket Management API
- **Description:** Ticket CRUD, availability tracking, check-in, Excel import, validation
- **Hours:** 45-55 hours
- **Rate:** €35/hour (Mid-level)
- **Cost:** €1,575 - €1,925

### 2.7 Order Management API
- **Description:** Order processing, cancellation, tracking, reporting
- **Hours:** 30-40 hours
- **Rate:** €35/hour (Mid-level)
- **Cost:** €1,050 - €1,400

### 2.8 RabbitMQ Integration
- **Description:** RabbitMQ setup, message publishing/consuming, queue management, handlers
- **Hours:** 40-50 hours
- **Rate:** €40/hour (Senior)
- **Cost:** €1,600 - €2,000

### 2.9 Email System
- **Description:** Nodemailer setup, 7 email templates, retry logic, reporting
- **Hours:** 35-45 hours
- **Rate:** €35/hour (Mid-level)
- **Cost:** €1,225 - €1,575

### 2.10 File Upload & AWS Integration
- **Description:** AWS S3 integration, CloudFront setup, file upload handling, signed URLs
- **Hours:** 30-40 hours
- **Rate:** €40/hour (Senior)
- **Cost:** €1,200 - €1,600

### 2.11 Caching System (Redis)
- **Description:** Redis integration, cache management, CloudFront URL caching
- **Hours:** 20-28 hours
- **Rate:** €35/hour (Mid-level)
- **Cost:** €700 - €980

### 2.12 Job Scheduling (Agenda.js)
- **Description:** Agenda.js setup, scheduled tasks, email retry jobs, job locking
- **Hours:** 25-35 hours
- **Rate:** €40/hour (Senior)
- **Cost:** €1,000 - €1,400

### 2.13 API Controllers (11 Controllers)
- **Description:** 11 controller modules with CRUD operations, validation, error handling
- **Hours:** 60-80 hours
- **Rate:** €35/hour (Mid-level)
- **Cost:** €2,100 - €2,800

### 2.14 Utility Modules (12 Utilities)
- **Description:** 12 utility modules for common functions, AWS, JWT, payments, etc.
- **Hours:** 40-50 hours
- **Rate:** €35/hour (Mid-level)
- **Cost:** €1,400 - €1,750

### 2.15 Logging & Monitoring
- **Description:** Winston logger setup, daily rotate logs, error logging
- **Hours:** 15-20 hours
- **Rate:** €35/hour (Mid-level)
- **Cost:** €525 - €700

### 2.16 Security Features
- **Description:** Security headers, CORS, input validation, XSS/CSRF protection
- **Hours:** 20-25 hours
- **Rate:** €40/hour (Senior)
- **Cost:** €800 - €1,000

### 2.17 Additional Features
- **Description:** Excel generation, QR codes, ICS files, reporting, dashboard
- **Hours:** 30-40 hours
- **Rate:** €35/hour (Mid-level)
- **Cost:** €1,050 - €1,400

### 2.18 Testing & QA
- **Description:** Unit testing, integration testing, API testing, bug fixes
- **Hours:** 40-50 hours
- **Rate:** €35/hour (Mid-level)
- **Cost:** €1,400 - €1,750

### 2.19 Documentation
- **Description:** API documentation, code comments, setup guides
- **Hours:** 15-20 hours
- **Rate:** €30/hour (Junior/Mid)
- **Cost:** €450 - €600

### 2.20 Docker & CI/CD
- **Description:** Dockerfile, Jenkins pipeline, deployment configuration
- **Hours:** 15-20 hours
- **Rate:** €35/hour (Mid-level)
- **Cost:** €525 - €700

---

## 3. Cost Summary Table

| Component | Low (€) | High (€) |
|-----------|---------|----------|
| Core Infrastructure | 700 | 875 |
| Database Design & Models | 2,000 | 2,600 |
| Authentication & Authorization | 1,200 | 1,600 |
| Payment Integration | 1,575 | 2,025 |
| Event Management API | 1,400 | 1,750 |
| Ticket Management API | 1,575 | 1,925 |
| Order Management API | 1,050 | 1,400 |
| RabbitMQ Integration | 1,600 | 2,000 |
| Email System | 1,225 | 1,575 |
| File Upload & AWS | 1,200 | 1,600 |
| Caching System (Redis) | 700 | 980 |
| Job Scheduling | 1,000 | 1,400 |
| API Controllers | 2,100 | 2,800 |
| Utility Modules | 1,400 | 1,750 |
| Logging & Monitoring | 525 | 700 |
| Security Features | 800 | 1,000 |
| Additional Features | 1,050 | 1,400 |
| Testing & QA | 1,400 | 1,750 |
| Documentation | 450 | 600 |
| Docker & CI/CD | 525 | 700 |
| **SUBTOTAL** | **22,145** | **28,630** |

---

## 4. Additional Costs

### 4.1 Project Management (10%)
- **Cost:** €2,215 - €2,863

### 4.2 Code Reviews & Quality Assurance (5%)
- **Cost:** €1,107 - €1,432

### 4.3 Meetings & Coordination (5%)
- **Cost:** €1,107 - €1,432

### 4.4 Contingency (10%)
- **Cost:** €2,215 - €2,863

**Total Additional Costs:** €6,644 - €8,590

---

## 5. Total Project Cost

**Development Cost:**
- Low: €22,145
- High: €28,630

**Additional Costs:**
- €6,644 - €8,590

**TOTAL PROJECT COST:**
- **Low: €28,789**
- **High: €37,220**

**Most Likely Scenario: €30,000 - €35,000**

---

## 6. Team Structure Options

### Option 1: 1 Senior Developer
- **Rate:** €45/hour
- **Hours:** 550-700 hours
- **Cost:** €24,750 - €31,500
- **Timeline:** 5-7 months
- **Monthly Cost:** €7,687.50 (including employer costs)

### Option 2: 1 Senior + 1 Mid-Level
- **Senior:** €45/hour × 300h = €13,500
- **Mid-Level:** €35/hour × 300h = €10,500
- **Total:** €24,000
- **Timeline:** 3-4 months
- **Monthly Cost:** €13,750 (including employer costs)

### Option 3: 2 Mid-Level Developers
- **Rate:** €35/hour each
- **Hours:** 550-700 hours total
- **Cost:** €19,250 - €24,500
- **Timeline:** 3.5-4.5 months
- **Monthly Cost:** €12,125 (including employer costs)

### Option 4: 1 Senior + 2 Mid-Level
- **Senior:** €45/hour × 250h = €11,250
- **Mid-Level:** €35/hour × 200h each = €14,000
- **Total:** €25,250
- **Timeline:** 2.5-3 months
- **Monthly Cost:** €19,812.50 (including employer costs)

---

## 7. Timeline & Cost Summary

| Team Structure | Duration | Total Cost (€) |
|----------------|----------|----------------|
| 1 Senior | 5-7 months | 28,789 - 37,220 |
| 1 Senior + 1 Mid | 3-4 months | 30,644 - 39,590 |
| 2 Mid-level | 3.5-4.5 months | 25,894 - 33,130 |
| 1 Senior + 2 Mid | 2.5-3 months | 31,894 - 40,840 |

---

## 8. Assumptions & Notes

### 8.1 Assumptions
- Based on Finnish market rates for 2024-2025
- Includes all employer costs (25% overhead)
- Assumes standard 160 working hours per month
- Based on existing codebase analysis
- Includes testing and documentation

### 8.2 Not Included
- Office space/equipment (assumes remote work or existing infrastructure)
- Software licenses (assumes company-provided)
- Third-party service costs (Stripe fees, AWS S3/CloudFront, RabbitMQ, Redis hosting)
- Database hosting costs (MongoDB)
- Ongoing maintenance costs (15-20% annually)

### 8.3 Risk Factors
- Complex integrations (Stripe, RabbitMQ, AWS) may require additional senior time
- Message queue setup and debugging can be time-consuming
- Payment webhook handling requires careful testing
- Database schema changes may require migration scripts

### 8.4 Efficiency Factors
- Internal teams may be 10-20% more efficient due to:
  - Better context understanding
  - Existing tooling and infrastructure
  - Direct communication channels

---

## 9. Recommendations

### Recommended Approach
**Option 2: 1 Senior + 1 Mid-Level Developer**
- **Timeline:** 3-4 months
- **Cost:** €30,644 - €39,590
- **Benefits:**
  - Faster delivery
  - Senior oversight for complex integrations
  - Mid-level handles standard API development
  - Good balance of cost and quality

### Alternative Approach
**Option 3: 2 Mid-Level Developers**
- **Timeline:** 3.5-4.5 months
- **Cost:** €25,894 - €33,130
- **Benefits:**
  - Lower cost
  - Faster delivery than single developer
  - Good for standard API development
- **Considerations:**
  - May need senior review for complex integrations
  - Payment and RabbitMQ integration may require senior oversight

---

## 10. Next Steps

1. **Review and Approve Budget:** €30,000 - €35,000
2. **Select Team Structure:** Based on timeline and budget constraints
3. **Define Project Timeline:** 2.5-7 months depending on team size
4. **Set Up Project Management:** Track hours and milestones
5. **Plan for Contingencies:** Reserve 10-15% for unexpected issues

---

## Document Information

**Prepared for:** Finnep Event App Backend Development
**Date:** 2025
**Market:** Finland
**Cost Basis:** Internal Employee Costs (including employer contributions)
**Currency:** EUR (€)

---

**End of Document**