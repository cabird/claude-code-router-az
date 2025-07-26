import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { FastifyRequest, FastifyReply } from 'fastify';
import { log } from '../utils/log';

const AZURE_SCOPE = 'https://cognitiveservices.azure.com/.default';
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

let azureCredential: DefaultAzureCredential | null = null;
let tokenProvider: ReturnType<typeof getBearerTokenProvider> | null = null;

function initializeAzureAuth() {
  if (!azureCredential) {
    azureCredential = new DefaultAzureCredential();
    tokenProvider = getBearerTokenProvider(azureCredential, AZURE_SCOPE);
  }
}

async function getAzureToken(): Promise<string> {
  const cacheKey = AZURE_SCOPE;
  const cached = tokenCache.get(cacheKey);
  
  // Check if we have a valid cached token
  if (cached && cached.expiresAt > Date.now() + 60000) { // 1 minute buffer
    log('Using cached Azure token');
    return cached.token;
  }

  // Initialize if needed
  initializeAzureAuth();
  
  try {
    log('Attempting to get new Azure token...');
    // Get new token
    const token = await tokenProvider!({
      scopes: [AZURE_SCOPE],
      getTokenOptions: {}
    });
    
    log('Successfully obtained Azure token');
    
    // Cache for 50 minutes (tokens typically last 1 hour)
    tokenCache.set(cacheKey, {
      token,
      expiresAt: Date.now() + 50 * 60 * 1000
    });
    
    return token;
  } catch (error: any) {
    log(`Failed to get Azure token: ${error.message || error}`);
    log(`Error details: ${JSON.stringify(error)}`);
    throw error;
  }
}

export async function azureAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Only handle Azure providers
  const req = request as any;
  const provider = req.selectedProvider;
  if (!provider || provider.auth_type !== 'azure') {
    return;
  }

  try {
    const token = await getAzureToken();
    request.headers['authorization'] = `Bearer ${token}`;
    
    // Remove any api_key header if present
    delete request.headers['x-api-key'];
    delete request.headers['api-key'];
    
    // Remove the dummy API key from the provider config to prevent it from being used
    if (provider.api_key) {
      delete provider.api_key;
    }
    
    // For Azure OpenAI, we need to handle the URL transformation
    // Since we can't modify the URL directly, we'll store the deployment info
    // and let the @musistudio/llms package handle it with a custom transformer
    if (req.azureDeployment && req.azureApiVersion) {
      // Store Azure-specific info in headers for the transformer to use
      request.headers['x-azure-deployment'] = req.azureDeployment;
      request.headers['x-azure-api-version'] = req.azureApiVersion;
      
      log(`Azure deployment: ${req.azureDeployment}, API version: ${req.azureApiVersion}`);
    }
    
    log(`Added Azure auth token for provider: ${provider.name}`);
  } catch (error) {
    log(`Azure auth failed: ${error}`);
    reply.code(500).send({ error: 'Azure authentication failed' });
  }
}