import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Finnep Event App Backend API',
      version: '1.0.0',
      description: 'Comprehensive RESTful API for event management, ticket sales, payment processing, and administrative operations.',
      contact: {
        name: 'API Support',
        email: 'support@finnep.fi',
        url: 'https://eventapp.finnep.fi'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: process.env.API_BASE_URL || 'http://localhost:3000',
        description: 'Development server'
      },
      {
        url: 'https://api.eventapp.finnep.fi',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token obtained from /api/auth/user/login'
        },
        guestToken: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Guest token obtained from /front/guest/verify-code'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            message: {
              type: 'string',
              example: 'Error message'
            },
            error: {
              type: 'string',
              example: 'Error code'
            }
          }
        },
        Success: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            message: {
              type: 'string',
              example: 'Success message'
            },
            data: {
              type: 'object'
            }
          }
        }
      },
      responses: {
        UnauthorizedError: {
          description: 'Authentication required',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Invalid or expired token',
                error: 'UNAUTHORIZED'
              }
            }
          }
        },
        NotFoundError: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Resource not found',
                error: 'NOT_FOUND'
              }
            }
          }
        },
        ValidationError: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Please check the payload.',
                error: [
                  {
                    msg: 'Invalid value',
                    param: 'fieldName',
                    location: 'body'
                  }
                ]
              }
            }
          }
        }
      }
    },
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication endpoints'
      },
      {
        name: 'Users',
        description: 'User management endpoints'
      },
      {
        name: 'Events',
        description: 'Event management endpoints'
      },
      {
        name: 'Tickets',
        description: 'Ticket management endpoints'
      },
      {
        name: 'Merchants',
        description: 'Merchant management endpoints'
      },
      {
        name: 'Photos',
        description: 'Photo management endpoints'
      },
      {
        name: 'Notifications',
        description: 'Notification management endpoints'
      },
      {
        name: 'Settings',
        description: 'Settings management endpoints'
      },
      {
        name: 'Dashboard',
        description: 'Dashboard and analytics endpoints'
      },
      {
        name: 'Reports',
        description: 'Financial reporting endpoints'
      },
      {
        name: 'Public',
        description: 'Public-facing endpoints (no authentication required)'
      },
      {
        name: 'Guest',
        description: 'Guest ticket access endpoints'
      },
      {
        name: 'Payment',
        description: 'Payment processing endpoints'
      }
    ]
  },
  apis: [
    './routes/*.js',
    './controllers/*.js',
    './app.js'
  ]
};

export const swaggerSpec = swaggerJsdoc(options);

