#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const configPath = path.join(process.env.HOME, '.claude-code-router', 'config.json');

// Get Azure token
function getAzureToken() {
  try {
    const token = execSync('az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv', { 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    return token;
  } catch (error) {
    console.error('Failed to get Azure token:', error.message);
    process.exit(1);
  }
}

// Update config with fresh token
function updateConfig() {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const token = getAzureToken();
  
  // Find Azure provider and update its api_key
  config.providers.forEach(provider => {
    if (provider.auth_type === 'azure') {
      provider.api_key = token;
      console.log(`Updated ${provider.name} with fresh Azure token`);
    }
  });
  
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('Config updated successfully');
}

updateConfig();