/**
 * Configuration loading and validation
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import YAML from "yaml";
import { MzdConfig, MzdConfigSchema, getDefaultConfig } from "./types.js";

/** Default config directory */
export const DEFAULT_CONFIG_DIR = path.join(os.homedir(), ".mzd");

/** Default config file name */
export const CONFIG_FILE_NAME = "config.yaml";

/** Environment variable for config path override */
export const MZD_CONFIG_PATH_ENV = "MZD_CONFIG_PATH";

/** Environment variable for config directory override */
export const MZD_CONFIG_DIR_ENV = "MZD_CONFIG_DIR";

/**
 * Get the configuration directory path
 */
export function getConfigDir(): string {
  return process.env[MZD_CONFIG_DIR_ENV] || DEFAULT_CONFIG_DIR;
}

/**
 * Get the configuration file path
 */
export function getConfigPath(): string {
  if (process.env[MZD_CONFIG_PATH_ENV]) {
    return process.env[MZD_CONFIG_PATH_ENV];
  }
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

/**
 * Check if config file exists
 */
export async function configExists(): Promise<boolean> {
  try {
    await fs.access(getConfigPath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Load configuration from file
 */
export async function loadConfig(): Promise<MzdConfig> {
  const configPath = getConfigPath();

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const parsed = YAML.parse(content);
    return MzdConfigSchema.parse(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // Return default config if file doesn't exist
      return getDefaultConfig();
    }
    throw new Error(
      `Failed to load config from ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Save configuration to file
 */
export async function saveConfig(config: MzdConfig): Promise<void> {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);

  // Ensure directory exists
  await fs.mkdir(configDir, { recursive: true });

  // Validate before saving
  const validated = MzdConfigSchema.parse(config);

  // Write as YAML
  const content = YAML.stringify(validated, { indent: 2 });
  await fs.writeFile(configPath, content, "utf-8");
}

/**
 * Initialize configuration with defaults
 */
export async function initConfig(
  workspacePath?: string,
): Promise<{ configPath: string; config: MzdConfig }> {
  const configPath = getConfigPath();

  // Check if config already exists
  if (await configExists()) {
    throw new Error(`Config already exists at ${configPath}`);
  }

  const config = getDefaultConfig();

  // Add workspace if provided
  if (workspacePath) {
    const absolutePath = path.resolve(workspacePath);
    const workspaceName = path.basename(absolutePath);

    config.workspaces.push({
      name: workspaceName,
      path: absolutePath,
      tier: "read",
      denyPatterns: [],
      allowGit: true,
    });
    config.defaultWorkspace = workspaceName;
  }

  await saveConfig(config);

  return { configPath, config };
}

/**
 * Add a workspace to the configuration
 */
export async function addWorkspace(
  workspacePath: string,
  options?: {
    name?: string;
    tier?: "read" | "write" | "exec";
    setDefault?: boolean;
  },
): Promise<void> {
  const config = await loadConfig();
  const absolutePath = path.resolve(workspacePath);
  const workspaceName = options?.name || path.basename(absolutePath);

  // Check if workspace already exists
  if (config.workspaces.some((w) => w.name === workspaceName)) {
    throw new Error(`Workspace "${workspaceName}" already exists`);
  }

  config.workspaces.push({
    name: workspaceName,
    path: absolutePath,
    tier: options?.tier || "read",
    denyPatterns: [],
    allowGit: true,
  });

  if (options?.setDefault) {
    config.defaultWorkspace = workspaceName;
  }

  await saveConfig(config);
}

/**
 * Get workspace configuration by name or path
 */
export function getWorkspace(
  config: MzdConfig,
  nameOrPath: string,
): { workspace: (typeof config.workspaces)[0]; index: number } | null {
  // Try by name first
  let index = config.workspaces.findIndex((w) => w.name === nameOrPath);

  if (index === -1) {
    // Try by path
    const absolutePath = path.resolve(nameOrPath);
    index = config.workspaces.findIndex((w) => w.path === absolutePath);
  }

  if (index === -1) {
    return null;
  }

  return { workspace: config.workspaces[index], index };
}
