#!/usr/bin/env node

const http = require('http');

// Make a simple request to see what providers are available
const options = {
  hostname: '127.0.0.1',
  port: 3456,
  path: '/v1/messages',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01'
  }
};

const data = JSON.stringify({
  model: "test,test",
  messages: [{ role: "user", content: "test" }],
  max_tokens: 10
});

const req = http.request(options, (res) => {
  let responseData = '';
  res.on('data', (chunk) => responseData += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', responseData);
  });
});

req.on('error', (e) => console.error('Error:', e));
req.write(data);
req.end();