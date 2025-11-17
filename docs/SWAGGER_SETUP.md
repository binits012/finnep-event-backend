# Swagger API Documentation Setup

This guide explains how to set up Swagger/OpenAPI documentation for the Finnep Event App Backend.

## Installation

### 1. Install Swagger Dependencies

```bash
npm install swagger-jsdoc swagger-ui-express --save
```

### 2. Verify Configuration

The Swagger configuration is already set up in `config/swagger.js`. The application will automatically load Swagger if the packages are installed.

## Accessing Documentation

Once installed, the API documentation will be available at:

- **Swagger UI:** `http://localhost:3000/api-docs`
- **OpenAPI JSON:** `http://localhost:3000/api-docs.json`

## Adding Swagger Annotations

To document endpoints, add JSDoc comments to your route files:

### Example: Documenting a Route

```javascript
/**
 * @swagger
 * /api/auth/user/login:
 *   post:
 *     summary: User login
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 example: admin@finnep.fi
 *               password:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     token:
 *                       type: string
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.route('/auth/user/login').post(api.login)
```

### Example: Documenting with Authentication

```javascript
/**
 * @swagger
 * /api/event:
 *   get:
 *     summary: List events
 *     tags: [Events]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: List of events
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.route('/event').get(api.getEvents)
```

## Swagger Annotations Reference

### Basic Structure

```javascript
/**
 * @swagger
 * /path/to/endpoint:
 *   method:
 *     summary: Brief description
 *     tags: [TagName]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path|query|header
 *         name: paramName
 *         schema:
 *           type: string|number|boolean
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Success
 */
```

### Common Tags

- `Authentication` - Login, logout, password management
- `Users` - User management
- `Events` - Event management
- `Tickets` - Ticket management
- `Merchants` - Merchant management
- `Photos` - Photo management
- `Notifications` - Notification management
- `Settings` - Settings management
- `Dashboard` - Dashboard and analytics
- `Reports` - Financial reports
- `Public` - Public endpoints
- `Guest` - Guest ticket access
- `Payment` - Payment processing

## Next Steps

1. **Install Swagger packages** (if not already installed)
2. **Add annotations** to route files in `routes/api.js` and `routes/front.js`
3. **Test documentation** at `http://localhost:3000/api-docs`
4. **Export OpenAPI spec** for API clients

## Generating OpenAPI Spec

The OpenAPI JSON specification is automatically generated and available at:

```bash
curl http://localhost:3000/api-docs.json > openapi.json
```

This can be used with:
- **Postman:** Import OpenAPI spec
- **API Clients:** Generate client libraries
- **API Gateway:** Import to API gateway services

---

**Last Updated:** 2025-01-15

