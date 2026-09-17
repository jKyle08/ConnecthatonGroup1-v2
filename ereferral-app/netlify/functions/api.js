const serverless = require('serverless-http');
const { app } = require('../../server/index');

const handler = serverless(app, {
  request: (req, _event, _context) => {
    // Normalize paths when invoked via Netlify functions or rewrites
    if (req.url.startsWith('/.netlify/functions/api')) {
      req.url = req.url.replace('/.netlify/functions/api', '/api');
    }
    if (!req.url.startsWith('/api')) {
      req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
    }
  },
});

module.exports.handler = handler;
