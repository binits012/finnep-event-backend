# Finnep Event App Backend - API Reference

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Base URLs](#base-urls)
4. [Admin API Endpoints](#admin-api-endpoints)
5. [Public API Endpoints](#public-api-endpoints)
6. [Request/Response Formats](#requestresponse-formats)
7. [Error Handling](#error-handling)
8. [Rate Limiting](#rate-limiting)
9. [API Documentation](#api-documentation)

---

## Overview

The Finnep Event App Backend provides a comprehensive RESTful API for:

- Event management and discovery
- Ticket sales and management
- Payment processing (Stripe integration)
- User and merchant management
- Content management (photos, notifications)
- Financial reporting
- Guest ticket access

### API Version

Current API version: **1.0.0**

### Base URLs

- **Development:** `http://localhost:3000`
- **Production:** `https://api.eventapp.finnep.fi`

---

## Authentication

### Admin API Authentication

Most admin endpoints require JWT authentication. Obtain a token by logging in:

**Endpoint:** `POST /api/auth/user/login`

**Request:**
```json
{
  "username": "admin@finnep.fi",
  "password": "your_password"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "507f1f77bcf86cd799439011",
      "username": "admin@finnep.fi",
      "role": "admin"
    }
  }
}
```

**Usage:**
Include the token in the `Authorization` header:
```
Authorization: Bearer <your_jwt_token>
```

### Guest API Authentication

Guest endpoints use a separate guest token system:

1. **Check Email:** `POST /front/guest/check-email`
2. **Send Code:** `POST /front/guest/send-code`
3. **Verify Code:** `POST /front/guest/verify-code` (returns guest token)
4. **Use Token:** Include in `Authorization` header for guest endpoints

---

## Base URLs

### Admin API

All admin endpoints are prefixed with `/api`:

- Base URL: `http://localhost:3000/api`
- Authentication: Required (JWT token)

### Public API

All public endpoints are prefixed with `/front`:

- Base URL: `http://localhost:3000/front`
- Authentication: Not required (except guest endpoints)

---

## Admin API Endpoints

### Authentication

#### Login
- **Endpoint:** `POST /api/auth/user/login`
- **Description:** Authenticate user and receive JWT token
- **Authentication:** Not required
- **Request Body:**
  ```json
  {
    "username": "string",
    "password": "string"
  }
  ```
- **Response:** `200 OK`
  ```json
  {
    "success": true,
    "data": {
      "token": "string",
      "user": {
        "id": "string",
        "username": "string",
        "role": "string"
      }
    }
  }
  ```

#### Change Password
- **Endpoint:** `POST /api/auth/user/changePassword`
- **Description:** Change user password
- **Authentication:** Required
- **Request Body:**
  ```json
  {
    "oldPassword": "string",
    "newPassword": "string"
  }
  ```

#### Logout
- **Endpoint:** `GET /api/logout?token=<token>`
- **Description:** Invalidate JWT token
- **Authentication:** Required (via query parameter)

---

### Users

#### Create Admin User
- **Endpoint:** `POST /api/user/admin`
- **Description:** Create a new admin user
- **Authentication:** Required (Admin only)
- **Request Body:**
  ```json
  {
    "username": "string",
    "password": "string",
    "email": "string"
  }
  ```

#### Get Admin Users
- **Endpoint:** `GET /api/user/admin`
- **Description:** List all admin users
- **Authentication:** Required (Admin only)
- **Response:** `200 OK`
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "string",
        "username": "string",
        "email": "string",
        "role": "admin"
      }
    ]
  }
  ```

#### Create Staff User
- **Endpoint:** `POST /api/user/staff`
- **Description:** Create a new staff user
- **Authentication:** Required (Admin only)

#### Get Staff Users
- **Endpoint:** `GET /api/user/staff`
- **Description:** List all staff users
- **Authentication:** Required (Admin only)

#### Get User by ID
- **Endpoint:** `GET /api/user/:id`
- **Description:** Get user details by ID
- **Authentication:** Required
- **Parameters:**
  - `id` (path, required): User ID (MongoDB ObjectId)

#### Update User
- **Endpoint:** `PATCH /api/user/:id`
- **Description:** Update user information
- **Authentication:** Required

#### Delete User
- **Endpoint:** `DELETE /api/user/:id`
- **Description:** Delete a user
- **Authentication:** Required (Admin only)

---

### Events

#### Create Event
- **Endpoint:** `POST /api/event`
- **Description:** Create a new event
- **Authentication:** Required (Admin/Staff)
- **Request Body:**
  ```json
  {
    "eventTitle": "string",
    "eventDescription": "string",
    "eventDate": "ISO 8601 date string",
    "occupancy": "number",
    "eventPromotionPhoto": "string (URL)",
    "eventLocationAddress": "string",
    "eventLocationGeoCode": {
      "lat": "number",
      "lng": "number"
    },
    "transportLink": "string (URL)",
    "position": "number",
    "active": "boolean",
    "merchant": "string (MongoDB ObjectId)",
    "ticketInfo": [
      {
        "ticketName": "string",
        "price": "number",
        "quantity": "number",
        "vat": "number",
        "serviceFee": "number"
      }
    ],
    "otherInfo": {
      "categoryName": "string",
      "subCategoryName": "string",
      "eventType": "paid|free",
      "doorSaleAllowed": "boolean",
      "doorSaleExtraAmount": "number"
    }
  }
  ```

#### Get Events
- **Endpoint:** `GET /api/event`
- **Description:** List events with pagination and filters
- **Authentication:** Required
- **Query Parameters:**
  - `page` (number, default: 1): Page number
  - `limit` (number, default: 10): Items per page
  - `country` (string): Filter by country
  - `merchant` (string): Filter by merchant ID
  - `status` (string): Filter by status (up-coming, on-going, completed)
  - `category` (string): Filter by category name
  - `search` (string): Search in event title/description
- **Response:** `200 OK`
  ```json
  {
    "success": true,
    "data": {
      "events": [...],
      "pagination": {
        "currentPage": 1,
        "totalPages": 10,
        "totalItems": 100,
        "itemsPerPage": 10
      }
    }
  }
  ```

#### Get Event by ID
- **Endpoint:** `GET /api/event/:id`
- **Description:** Get event details by ID
- **Authentication:** Required
- **Parameters:**
  - `id` (path, required): Event ID (MongoDB ObjectId)

#### Update Event
- **Endpoint:** `PUT /api/event/:id`
- **Description:** Update event information
- **Authentication:** Required (Admin/Staff)

#### Update Event Status
- **Endpoint:** `PATCH /api/event/:id`
- **Description:** Update event status (active/inactive)
- **Authentication:** Required (Admin/Staff)

#### Get Event Filter Options
- **Endpoint:** `GET /api/event/filters/options`
- **Description:** Get available filter options (countries, merchants, categories)
- **Authentication:** Required

#### Upload Event Photos
- **Endpoint:** `POST /api/event/:id/eventPhoto`
- **Description:** Upload photos for an event
- **Authentication:** Required (Admin/Staff)
- **Content-Type:** `multipart/form-data`

---

### Tickets

#### Create Single Ticket
- **Endpoint:** `POST /api/singleTicket`
- **Description:** Create a single ticket
- **Authentication:** Required (Admin/Staff)

#### Create Multiple Tickets
- **Endpoint:** `POST /api/multipleTicket`
- **Description:** Create multiple tickets
- **Authentication:** Required (Admin/Staff)

#### Get Tickets by Event
- **Endpoint:** `GET /api/event/:id/ticket`
- **Description:** Get all tickets for an event
- **Authentication:** Required
- **Parameters:**
  - `id` (path, required): Event ID (MongoDB ObjectId)

#### Search Tickets
- **Endpoint:** `GET /api/event/:id/searchTicket`
- **Description:** Search tickets for an event
- **Authentication:** Required
- **Query Parameters:**
  - `q` (string): Search query (OTP, email, etc.)

#### Get Ticket by ID
- **Endpoint:** `GET /api/ticket/:id`
- **Description:** Get ticket details by ID
- **Authentication:** Required
- **Parameters:**
  - `id` (path, required): Ticket ID (MongoDB ObjectId)

#### Ticket Check-In
- **Endpoint:** `PUT /api/ticket/:id/checkIn`
- **Description:** Mark ticket as checked in
- **Authentication:** Required (Admin/Staff)

---

### Merchants

#### Get All Merchants
- **Endpoint:** `GET /api/merchant`
- **Description:** List all merchants
- **Authentication:** Required (Admin only)

#### Get Merchant by ID
- **Endpoint:** `GET /api/merchant/:id`
- **Description:** Get merchant details by ID
- **Authentication:** Required
- **Parameters:**
  - `id` (path, required): Merchant ID (MongoDB ObjectId)

#### Update Merchant
- **Endpoint:** `PATCH /api/merchant/:id`
- **Description:** Update merchant information
- **Authentication:** Required (Admin only)

---

### Photos

#### Get Photos
- **Endpoint:** `GET /api/photo`
- **Description:** List all photos
- **Authentication:** Required

#### Create Photo
- **Endpoint:** `POST /api/photo`
- **Description:** Create a new photo
- **Authentication:** Required (Admin/Staff)
- **Content-Type:** `multipart/form-data`

#### Update Photo
- **Endpoint:** `PATCH /api/photo/:id`
- **Description:** Update photo information
- **Authentication:** Required (Admin/Staff)

#### Delete Photo
- **Endpoint:** `DELETE /api/photo/:id`
- **Description:** Delete a photo
- **Authentication:** Required (Admin only)

---

### Notifications

#### Get All Notifications
- **Endpoint:** `GET /api/notification`
- **Description:** List all notifications
- **Authentication:** Required

#### Create Notification
- **Endpoint:** `POST /api/notification`
- **Description:** Create a new notification
- **Authentication:** Required (Admin/Staff)

#### Get Notification by ID
- **Endpoint:** `GET /api/notification/:id`
- **Description:** Get notification details
- **Authentication:** Required

#### Update Notification
- **Endpoint:** `PATCH /api/notification/:id`
- **Description:** Update notification
- **Authentication:** Required (Admin/Staff)

#### Delete Notification
- **Endpoint:** `DELETE /api/notification/:id`
- **Description:** Delete a notification
- **Authentication:** Required (Admin only)

---

### Settings

#### Get Settings
- **Endpoint:** `GET /api/setting`
- **Description:** Get application settings
- **Authentication:** Required

#### Create Setting
- **Endpoint:** `POST /api/setting`
- **Description:** Create application setting
- **Authentication:** Required (Admin only)

#### Get Setting by ID
- **Endpoint:** `GET /api/setting/:id`
- **Description:** Get setting details
- **Authentication:** Required

#### Update Setting
- **Endpoint:** `POST /api/setting/:id`
- **Description:** Update application setting
- **Authentication:** Required (Admin only)

---

### Dashboard

#### Get Dashboard Data
- **Endpoint:** `GET /api/dashboard`
- **Description:** Get dashboard analytics and statistics
- **Authentication:** Required (Admin/Staff)
- **Response:** `200 OK`
  ```json
  {
    "success": true,
    "data": {
      "totalEvents": "number",
      "totalTickets": "number",
      "totalRevenue": "number",
      "upcomingEvents": "number",
      "recentActivity": [...]
    }
  }
  ```

---

### Reports

#### Get Event Financial Report
- **Endpoint:** `GET /api/event/:eventId/financial-report`
- **Description:** Get comprehensive financial report for a completed event
- **Authentication:** Required (Admin only)
- **Parameters:**
  - `eventId` (path, required): Event ID (MongoDB ObjectId)
- **Response:** `200 OK`
  ```json
  {
    "success": true,
    "data": {
      "event": {...},
      "summary": {
        "totalTicketsSold": "number",
        "totalRevenue": "number",
        "localTicketsSold": "number",
        "localRevenue": "number",
        "externalTicketsSold": "number",
        "externalRevenue": "number",
        "occupancyRate": "number"
      },
      "ticketBreakdown": [...],
      "sourceBreakdown": {
        "local": {...},
        "external": {...}
      }
    },
    "externalDataRequested": "boolean"
  }
  ```

#### Request External Ticket Sales Data
- **Endpoint:** `POST /api/event/:eventId/request-external-ticket-sales`
- **Description:** Manually request external ticket sales data from external microservice
- **Authentication:** Required (Admin only)
- **Parameters:**
  - `eventId` (path, required): Event ID (MongoDB ObjectId)
- **Response:** `200 OK`
  ```json
  {
    "success": true,
    "message": "External ticket sales data request has been sent",
    "data": {
      "messageId": "string",
      "correlationId": "string",
      "eventId": "string"
    }
  }
  ```

---

## Public API Endpoints

### Frontend Data

#### Get Frontend Data
- **Endpoint:** `GET /front/`
- **Description:** Get all data needed for frontend homepage
- **Authentication:** Not required
- **Response:** `200 OK`
  ```json
  {
    "photo": [...],
    "notification": [...],
    "event": [...],
    "setting": [...]
  }
  ```

---

### Events

#### List Events
- **Endpoint:** `GET /front/events`
- **Description:** List public events with pagination
- **Authentication:** Not required
- **Query Parameters:**
  - `page` (number, default: 1): Page number
  - `limit` (number, default: 10): Items per page
  - `category` (string): Filter by category
  - `country` (string): Filter by country
  - `search` (string): Search query

#### Get Event by ID
- **Endpoint:** `GET /front/event/:id`
- **Description:** Get public event details
- **Authentication:** Not required
- **Parameters:**
  - `id` (path, required): Event ID (MongoDB ObjectId)

---

### Payment

#### Create Checkout Session
- **Endpoint:** `POST /front/create-checkout-session`
- **Description:** Create Stripe checkout session for ticket purchase
- **Authentication:** Not required
- **Request Body:**
  ```json
  {
    "eventId": "string",
    "ticketId": "string",
    "quantity": "number",
    "email": "string"
  }
  ```
- **Response:** `200 OK`
  ```json
  {
    "success": true,
    "data": {
      "sessionId": "string",
      "url": "string (Stripe checkout URL)"
    }
  }
  ```

#### Create Payment Intent
- **Endpoint:** `POST /front/create-payment-intent`
- **Description:** Create Stripe payment intent
- **Authentication:** Not required

#### Handle Payment Success
- **Endpoint:** `POST /front/payment-success`
- **Description:** Handle successful payment (called by Stripe webhook)
- **Authentication:** Not required (Stripe webhook signature verified)

---

### Tickets

#### Complete Order Ticket
- **Endpoint:** `POST /front/ticket`
- **Description:** Complete ticket order after payment
- **Authentication:** Not required

#### Cancel Order Ticket
- **Endpoint:** `POST /front/ticket/cancel`
- **Description:** Cancel ticket order
- **Authentication:** Not required

---

### Free Events

#### Register for Free Event
- **Endpoint:** `POST /front/free-event-register`
- **Description:** Register for a free event (no payment required)
- **Authentication:** Not required
- **Request Body:**
  ```json
  {
    "eventId": "string",
    "ticketId": "string",
    "email": "string"
  }
  ```
- **Response:** `200 OK`
  ```json
  {
    "success": true,
    "message": "Registration successful",
    "data": {
      "ticketId": "string",
      "qrCode": "string (base64)",
      "ics": "string (base64)"
    }
  }
  ```

---

### Guest Ticket Access

#### Check Email
- **Endpoint:** `POST /front/guest/check-email`
- **Description:** Check if email exists in system
- **Authentication:** Not required
- **Request Body:**
  ```json
  {
    "email": "string"
  }
  ```
- **Response:** `200 OK`
  ```json
  {
    "success": true,
    "exists": "boolean"
  }
  ```

#### Send Verification Code
- **Endpoint:** `POST /front/guest/send-code`
- **Description:** Send 8-digit verification code to email
- **Authentication:** Not required
- **Request Body:**
  ```json
  {
    "email": "string"
  }
  ```
- **Response:** `200 OK`
  ```json
  {
    "success": true,
    "message": "Verification code sent"
  }
  ```

#### Verify Code
- **Endpoint:** `POST /front/guest/verify-code`
- **Description:** Verify code and receive guest token
- **Authentication:** Not required
- **Request Body:**
  ```json
  {
    "email": "string",
    "code": "string (8 digits)"
  }
  ```
- **Response:** `200 OK`
  ```json
  {
    "success": true,
    "data": {
      "token": "string (guest JWT token, 15 min expiry)"
    }
  }
  ```

#### Get Tickets
- **Endpoint:** `GET /front/guest/tickets`
- **Description:** Get all tickets for authenticated guest
- **Authentication:** Required (Guest token)
- **Query Parameters:**
  - `year` (number, optional): Filter by year (default: current year)
- **Response:** `200 OK`
  ```json
  {
    "success": true,
    "data": [
      {
        "ticketId": "string",
        "eventTitle": "string",
        "eventDate": "ISO 8601 date string",
        "ticketType": "string",
        "quantity": "number"
      }
    ]
  }
  ```

#### Get Ticket by ID
- **Endpoint:** `GET /front/guest/ticket/:id`
- **Description:** Get ticket details with QR code and calendar file
- **Authentication:** Required (Guest token)
- **Parameters:**
  - `id` (path, required): Ticket ID (MongoDB ObjectId)
- **Response:** `200 OK`
  ```json
  {
    "success": true,
    "data": {
      "ticket": {...},
      "qrCode": "string (base64 data URI)",
      "ics": "string (base64 data URI)"
    }
  }
  ```

---

### Contact & Feedback

#### Send Feedback
- **Endpoint:** `POST /front/sendFeedback`
- **Description:** Submit feedback form
- **Authentication:** Not required
- **Request Body:**
  ```json
  {
    "name": "string",
    "email": "string",
    "message": "string"
  }
  ```

#### Send Career Application
- **Endpoint:** `POST /front/sendCareerApplication`
- **Description:** Submit career application
- **Authentication:** Not required
- **Content-Type:** `multipart/form-data`

---

## Request/Response Formats

### Request Format

- **Content-Type:** `application/json` (for JSON requests)
- **Content-Type:** `multipart/form-data` (for file uploads)
- **Character Encoding:** UTF-8

### Response Format

All responses follow this structure:

**Success Response:**
```json
{
  "success": true,
  "data": {...},
  "message": "string (optional)"
}
```

**Error Response:**
```json
{
  "success": false,
  "message": "string",
  "error": "string or array"
}
```

### Pagination

Paginated responses include pagination metadata:

```json
{
  "success": true,
  "data": {
    "items": [...],
    "pagination": {
      "currentPage": 1,
      "totalPages": 10,
      "totalItems": 100,
      "itemsPerPage": 10
    }
  }
}
```

---

## Error Handling

### HTTP Status Codes

- **200 OK:** Request successful
- **201 Created:** Resource created successfully
- **400 Bad Request:** Invalid request parameters
- **401 Unauthorized:** Authentication required or invalid token
- **403 Forbidden:** Insufficient permissions
- **404 Not Found:** Resource not found
- **409 Conflict:** Resource conflict (e.g., duplicate entry)
- **422 Unprocessable Entity:** Validation error
- **500 Internal Server Error:** Server error

### Error Response Format

```json
{
  "success": false,
  "message": "Error message",
  "error": "Error code or validation errors array"
}
```

### Common Error Codes

- `INVALID_ID`: Invalid MongoDB ObjectId format
- `UNAUTHORIZED`: Authentication required
- `FORBIDDEN`: Insufficient permissions
- `NOT_FOUND`: Resource not found
- `VALIDATION_ERROR`: Request validation failed
- `INTERNAL_SERVER_ERROR`: Server error

---

## Rate Limiting

Currently, rate limiting is implemented for:

- **Guest endpoints:** Email verification code sending (prevents abuse)
- **Payment endpoints:** Stripe webhook processing

Rate limits may be adjusted based on traffic patterns.

---

## API Documentation

### Interactive Documentation

Once Swagger is set up, interactive API documentation will be available at:

- **Swagger UI:** `http://localhost:3000/api-docs`
- **OpenAPI JSON:** `http://localhost:3000/api-docs.json`

### Swagger Setup

To enable Swagger documentation:

1. Install dependencies:
   ```bash
   npm install swagger-jsdoc swagger-ui-express --save
   ```

2. Swagger configuration is in `config/swagger.js`

3. Add Swagger annotations to routes (see examples in route files)

4. Access documentation at `/api-docs`

---

## Examples

### Example: Create Event

```bash
curl -X POST http://localhost:3000/api/event \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_jwt_token>" \
  -d '{
    "eventTitle": "Summer Music Festival",
    "eventDescription": "Annual summer music festival",
    "eventDate": "2025-07-15T18:00:00Z",
    "occupancy": 1000,
    "eventPromotionPhoto": "https://example.com/photo.jpg",
    "eventLocationAddress": "123 Main St, Helsinki",
    "eventLocationGeoCode": {
      "lat": 60.1699,
      "lng": 24.9384
    },
    "transportLink": "https://example.com/transport",
    "position": 1,
    "active": true,
    "ticketInfo": [
      {
        "ticketName": "General Admission",
        "price": 50,
        "quantity": 500,
        "vat": 10,
        "serviceFee": 2
      }
    ],
    "otherInfo": {
      "categoryName": "Music",
      "subCategoryName": "Festival",
      "eventType": "paid",
      "doorSaleAllowed": true,
      "doorSaleExtraAmount": 5
    }
  }'
```

### Example: Get Events

```bash
curl -X GET "http://localhost:3000/api/event?page=1&limit=10&country=Finland" \
  -H "Authorization: Bearer <your_jwt_token>"
```

### Example: Guest Ticket Access

```bash
# Step 1: Send verification code
curl -X POST http://localhost:3000/front/guest/send-code \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com"
  }'

# Step 2: Verify code and get token
curl -X POST http://localhost:3000/front/guest/verify-code \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "code": "12345678"
  }'

# Step 3: Get tickets with token
curl -X GET "http://localhost:3000/front/guest/tickets?year=2025" \
  -H "Authorization: Bearer <guest_token>"
```

---

## Best Practices

1. **Always include Authorization header** for protected endpoints
2. **Validate request parameters** before sending
3. **Handle errors gracefully** in your client application
4. **Use pagination** for list endpoints to avoid large responses
5. **Cache responses** when appropriate (respect cache headers)
6. **Implement retry logic** for transient errors
7. **Monitor rate limits** and adjust request frequency accordingly

---

**Last Updated:** 2025-01-15
**Version:** 1.0.0

