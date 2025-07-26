import fs from "node:fs/promises";
import readline from "node:readline";
import JSON5 from "json5";
import { execSync } from "node:child_process";
import { log } from "./log";
import {
  CONFIG_FILE,
  DEFAULT_CONFIG,
  HOME_DIR,
  PLUGINS_DIR,
} from "../constants";

const ensureDir = async (dir_path: string) => {
  try {
    await fs.access(dir_path);
  } catch {
    await fs.mkdir(dir_path, { recursive: true });
  }
};

export const initDir = async () => {
  await ensureDir(HOME_DIR);
  await ensureDir(PLUGINS_DIR);
};

const createReadline = () => {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
};

const question = (query: string): Promise<string> => {
  return new Promise((resolve) => {
    const rl = createReadline();
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
};

const confirm = async (query: string): Promise<boolean> => {
  const answer = await question(query);
  return answer.toLowerCase() !== "n";
};

const getAzureToken = (): string | null => {
  try {
    const token = execSync(
      'az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    log('Successfully obtained Azure token for config');
    return token;
  } catch (error) {
    log('Failed to get Azure token: ' + error);
    return null;
  }
};

export const readConfigFile = async () => {
  try {
    const config = await fs.readFile(CONFIG_FILE, "utf-8");
    try {
      // Try to parse with JSON5 first (which also supports standard JSON)
      const parsedConfig = JSON5.parse(config);
      
      // Inject Azure tokens for providers with auth_type: "azure"
      if (parsedConfig.providers || parsedConfig.Providers) {
        const providers = parsedConfig.providers || parsedConfig.Providers;
        providers.forEach((provider: any) => {
          if (provider.auth_type === 'azure') {
            const token = getAzureToken();
            if (token) {
              provider.api_key = token;
              log(`Injected Azure token for provider: ${provider.name}`);
            } else {
              log(`Warning: Could not get Azure token for provider: ${provider.name}`);
            }
          }
        });
      }
      
      return parsedConfig;
    } catch (parseError) {
      console.error(`Failed to parse config file at ${CONFIG_FILE}`);
      console.error("Error details:", (parseError as Error).message);
      console.error("Please check your config file syntax.");
      process.exit(1);
    }
  } catch (readError: any) {
    if (readError.code === "ENOENT") {
      // Config file doesn't exist, prompt user for initial setup
      const name = await question("Enter Provider Name: ");
      const APIKEY = await question("Enter Provider API KEY: ");
      const baseUrl = await question("Enter Provider URL: ");
      const model = await question("Enter MODEL Name: ");
      const config = Object.assign({}, DEFAULT_CONFIG, {
        Providers: [
          {
            name,
            api_base_url: baseUrl,
            api_key: APIKEY,
            models: [model],
          },
        ],
        Router: {
          default: `${name},${model}`,
        },
      });
      await writeConfigFile(config);
      return config;
    } else {
      console.error(`Failed to read config file at ${CONFIG_FILE}`);
      console.error("Error details:", readError.message);
      process.exit(1);
    }
  }
};

export const writeConfigFile = async (config: any) => {
  await ensureDir(HOME_DIR);
  // Add a comment to indicate JSON5 support
  const configWithComment = `// This config file supports JSON5 format (comments, trailing commas, etc.)\n${JSON5.stringify(config, null, 2)}`;
  await fs.writeFile(CONFIG_FILE, configWithComment);
};

export const initConfig = async () => {
  const config = await readConfigFile();
  Object.assign(process.env, config);
  return config;
};
