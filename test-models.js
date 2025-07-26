#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

// Configuration
const CONFIG_FILE = path.join(os.homedir(), '.claude-code-router', 'config.json');
const SERVICE_PORT = 3456;
const SERVICE_HOST = '127.0.0.1';

// ANSI color codes
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

// Load configuration
function loadConfig() {
  try {
    const configData = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    console.error(`${colors.red}Error loading config:${colors.reset}`, error.message);
    process.exit(1);
  }
}

// Extract all unique models from config
function getAllModels(config) {
  const models = new Set();
  
  // Get models from providers
  const providers = config.Providers || config.providers || [];
  providers.forEach(provider => {
    if (provider.models) {
      if (Array.isArray(provider.models)) {
        // Traditional format: array of strings
        provider.models.forEach(model => {
          if (typeof model === 'string') {
            models.add(`${provider.name},${model}`);
          } else if (model.name) {
            // Azure format: array of objects with name field
            models.add(`${provider.name},${model.name}`);
          }
        });
      }
    }
  });
  
  // Get models from router config
  const router = config.Router || {};
  Object.values(router).forEach(model => {
    if (typeof model === 'string' && model.includes(',')) {
      models.add(model);
    }
  });
  
  return Array.from(models);
}

// Make HTTP request to the service
async function testModel(model, apiKey) {
  return new Promise((resolve, reject) => {
    const query = "What AI model are you? Please state your model name and creator. Be specific about your version if you know it.";
    const postData = JSON.stringify({
      model: model,
      messages: [
        {
          role: "user",
          content: query
        }
      ],
      max_tokens: 150,
      temperature: 0
    });

    const options = {
      hostname: SERVICE_HOST,
      port: SERVICE_PORT,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'anthropic-version': '2023-06-01'
      }
    };

    // Add API key if configured
    if (apiKey) {
      options.headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const response = JSON.parse(data);
            resolve({ success: true, response });
          } catch (error) {
            resolve({ success: false, error: 'Invalid JSON response', data });
          }
        } else {
          resolve({ success: false, error: `HTTP ${res.statusCode}`, data });
        }
      });
    });

    req.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });

    req.write(postData);
    req.end();
  });
}

// Check if service is running
async function checkService() {
  return new Promise((resolve) => {
    const options = {
      hostname: SERVICE_HOST,
      port: SERVICE_PORT,
      path: '/',
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      // If we get any response, the service is running
      resolve(res.statusCode > 0);
    });

    req.on('error', () => {
      resolve(false);
    });

    req.end();
  });
}

// Main test function
async function main() {
  console.log(`${colors.blue}Claude Code Router Model Test${colors.reset}\n`);

  // Load config
  const config = loadConfig();
  const apiKey = config.APIKEY || null;
  
  // Check if service is running
  console.log('Checking if service is running...');
  const isRunning = await checkService();
  
  if (!isRunning) {
    console.error(`${colors.red}Error: Claude Code Router service is not running.${colors.reset}`);
    console.log(`Please start the service with: ${colors.yellow}ccr start${colors.reset}`);
    process.exit(1);
  }
  
  console.log(`${colors.green}✓ Service is running${colors.reset}\n`);

  // Get all models
  const models = getAllModels(config);
  
  if (models.length === 0) {
    console.log(`${colors.yellow}No models found in configuration.${colors.reset}`);
    return;
  }

  console.log(`Found ${models.length} models to test:\n`);

  // Test each model
  const results = [];
  
  console.log(`Query: "${colors.yellow}What AI model are you? Please state your model name and creator. Be specific about your version if you know it.${colors.reset}"\n`);
  
  for (const model of models) {
    process.stdout.write(`Testing ${colors.blue}${model}${colors.reset}... `);
    
    const startTime = Date.now();
    const result = await testModel(model, apiKey);
    const duration = Date.now() - startTime;
    
    results.push({ model, ...result, duration });
    
    if (result.success) {
      console.log(`${colors.green}✓${colors.reset} (${duration}ms)`);
      
      // Try to extract the response content
      if (result.response && result.response.content) {
        const content = Array.isArray(result.response.content) 
          ? result.response.content.find(c => c.type === 'text')?.text 
          : result.response.content;
        if (content) {
          console.log(`  Response: "${content.trim()}"`);
        }
      }
      
      // Show the model field from response if available
      if (result.response && result.response.model) {
        console.log(`  Model reported in response: ${colors.blue}${result.response.model}${colors.reset}`);
      }
    } else {
      console.log(`${colors.red}✗${colors.reset}`);
      console.log(`  Error: ${result.error}`);
      if (result.data) {
        // Try to parse error message
        try {
          const errorData = JSON.parse(result.data);
          if (errorData.error) {
            console.log(`  Details: ${errorData.error.message || errorData.error}`);
          }
        } catch {
          // If not JSON, show first 100 chars
          console.log(`  Details: ${result.data.substring(0, 100)}...`);
        }
      }
    }
    console.log();
  }

  // Summary
  console.log(`\n${colors.blue}Summary:${colors.reset}`);
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`  ${colors.green}Successful:${colors.reset} ${successful}`);
  console.log(`  ${colors.red}Failed:${colors.reset} ${failed}`);
  
  // Show average response time for successful requests
  if (successful > 0) {
    const avgTime = Math.round(
      results.filter(r => r.success).reduce((sum, r) => sum + r.duration, 0) / successful
    );
    console.log(`  ${colors.blue}Average response time:${colors.reset} ${avgTime}ms`);
  }
}

// Run the test
main().catch(error => {
  console.error(`${colors.red}Unexpected error:${colors.reset}`, error);
  process.exit(1);
});