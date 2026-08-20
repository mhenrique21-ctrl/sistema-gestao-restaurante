const swaggerJsdoc = require('swagger-jsdoc');

// Documentação incremental: começa pelos recursos mais usados (menu, orders).
// Novas rotas ganham doc só anotando com @openapi acima da definição —
// não precisa mexer aqui pra cada endpoint novo.
const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Confraria Café — Delivery API',
      version: '1.0.0',
      description: 'API do backend de delivery/PDV da Confraria Café.',
    },
    servers: [{ url: '/api', description: 'API atual (sem versionamento de rota)' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
  },
  apis: ['./src/routes/menu.js', './src/routes/orders.js'],
};

module.exports = swaggerJsdoc(options);
