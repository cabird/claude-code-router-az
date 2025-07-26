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
  magenta: '\x1b[35m',
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

// Make HTTP request to the service
async function makeRequest(requestBody, apiKey) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(requestBody);

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
            resolve({ success: true, response, headers: res.headers });
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

// Test scenarios
const testScenarios = [
  {
    name: 'Default Model',
    description: 'Tests the default routing',
    request: {
      messages: [{ role: "user", content: "Say 'Default model works!' and nothing else." }],
      max_tokens: 50
    }
  },
  {
    name: 'Background Task',
    description: 'Tests background/simple task routing (claude-3-5-haiku)',
    request: {
      model: "claude-3-5-haiku-latest",
      messages: [{ role: "user", content: "Say 'Background model works!' and nothing else." }],
      max_tokens: 50
    }
  },
  {
    name: 'Thinking Mode',
    description: 'Tests thinking/reasoning model routing',
    request: {
      thinking: true,
      messages: [{ role: "user", content: "What is 2+2? Think step by step." }],
      max_tokens: 100
    }
  },
  {
    name: 'Long Context',
    description: 'Tests long context routing (>60K tokens)',
    request: {
      messages: [{ 
        role: "user", 
        content: "This is a test. " + "Lorem ipsum dolor sit amet. ".repeat(10000) + " Say 'Long context model works!' and nothing else."
      }],
      max_tokens: 50
    }
  },
  {
    name: 'Web Search',
    description: 'Tests web search model routing',
    request: {
      messages: [{ role: "user", content: "Say 'Web search model works!' and nothing else." }],
      tools: [{ type: "web_search" }],
      max_tokens: 50
    }
  },
  {
    name: 'Direct Model Selection',
    description: 'Tests direct model selection bypass',
    request: {
      model: "deepseek,deepseek-chat",
      messages: [{ role: "user", content: "Say 'Direct model selection works!' and nothing else." }],
      max_tokens: 50
    }
  }
];

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

// Extract model from response headers or config
function getUsedModel(result, config) {
  // Check if model info is in response headers
  if (result.headers && result.headers['x-selected-model']) {
    return result.headers['x-selected-model'];
  }
  
  // Try to infer from response
  if (result.response && result.response.model) {
    return result.response.model;
  }
  
  return 'unknown';
}

// Main test function
async function main() {
  console.log(`${colors.blue}Claude Code Router Advanced Test${colors.reset}\n`);

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

  // Show router configuration
  console.log(`${colors.magenta}Router Configuration:${colors.reset}`);
  const router = config.Router || {};
  Object.entries(router).forEach(([key, value]) => {
    console.log(`  ${key}: ${colors.blue}${value}${colors.reset}`);
  });
  console.log();

  // Run test scenarios
  console.log(`${colors.magenta}Running Test Scenarios:${colors.reset}\n`);
  
  const results = [];
  
  for (const scenario of testScenarios) {
    console.log(`${colors.yellow}${scenario.name}${colors.reset}`);
    console.log(`  ${scenario.description}`);
    
    process.stdout.write(`  Testing... `);
    
    const startTime = Date.now();
    const result = await makeRequest(scenario.request, apiKey);
    const duration = Date.now() - startTime;
    
    results.push({ scenario: scenario.name, ...result, duration });
    
    if (result.success) {
      console.log(`${colors.green}✓${colors.reset} (${duration}ms)`);
      
      // Show which model was used
      const usedModel = getUsedModel(result, config);
      console.log(`  Model used: ${colors.blue}${usedModel}${colors.reset}`);
      
      // Try to extract the response content
      if (result.response && result.response.content) {
        const content = Array.isArray(result.response.content) 
          ? result.response.content.find(c => c.type === 'text')?.text 
          : result.response.content;
        if (content) {
          const preview = content.trim().substring(0, 100);
          console.log(`  Response: "${preview}${content.length > 100 ? '...' : ''}"`);
        }
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
          // If not JSON, show first 200 chars
          console.log(`  Details: ${result.data.substring(0, 200)}...`);
        }
      }
    }
    console.log();
  }

  // Summary
  console.log(`\n${colors.blue}Summary:${colors.reset}`);
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`  ${colors.green}Successful:${colors.reset} ${successful}/${testScenarios.length}`);
  console.log(`  ${colors.red}Failed:${colors.reset} ${failed}/${testScenarios.length}`);
  
  // Show average response time for successful requests
  if (successful > 0) {
    const avgTime = Math.round(
      results.filter(r => r.success).reduce((sum, r) => sum + r.duration, 0) / successful
    );
    console.log(`  ${colors.blue}Average response time:${colors.reset} ${avgTime}ms`);
  }

  // Show failed scenarios
  if (failed > 0) {
    console.log(`\n${colors.red}Failed Scenarios:${colors.reset}`);
    results.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.scenario}`);
    });
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${colors.blue}Claude Code Router Advanced Test${colors.reset}

This script tests various routing scenarios to ensure your configuration is working correctly.

Usage: node test-advanced.js

The script will test:
- Default model routing
- Background task routing (claude-3-5-haiku)
- Thinking mode routing
- Long context routing (>60K tokens)
- Web search routing
- Direct model selection

Make sure the Claude Code Router service is running before running this test.
`);
  process.exit(0);
}

// Run the test
main().catch(error => {
  console.error(`${colors.red}Unexpected error:${colors.reset}`, error);
  process.exit(1);
});