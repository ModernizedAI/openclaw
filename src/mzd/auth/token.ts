/**
 * Authentication token management for the local agent daemon
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getConfigDir } from "../config/loader.js";

/** Token file name */
const TOKEN_FILE = "daemon-token";

/** Token length in bytes (32 bytes = 256 bits) */
const TOKEN_LENGTH = 32;

/**
 * Generate a new random token
 */
export function generateToken(): string {
  return crypto.randomBytes(TOKEN_LENGTH).toString("base64url");
}

/**
 * Get the path to the token file
 */
export function getTokenPath(): string {
  return path.join(getConfigDir(), TOKEN_FILE);
}

/**
 * Load the daemon auth token from disk
 * Returns null if no token exists
 */
export async function loadToken(): Promise<string | null> {
  const tokenPath = getTokenPath();

  try {
    const content = await fs.readFile(tokenPath, "utf-8");
    return content.trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Save the daemon auth token to disk
 * Creates the config directory if needed
 */
export async function saveToken(token: string): Promise<void> {
  const tokenPath = getTokenPath();
  const configDir = getConfigDir();

  // Ensure config directory exists
  await fs.mkdir(configDir, { recursive: true });

  // Write token with restricted permissions (owner read/write only)
  await fs.writeFile(tokenPath, token + "\n", { mode: 0o600 });
}

/**
 * Get or create the daemon auth token
 * Loads existing token or generates and saves a new one
 */
export async function getOrCreateToken(): Promise<string> {
  const existing = await loadToken();
  if (existing) {
    return existing;
  }

  const newToken = generateToken();
  await saveToken(newToken);
  return newToken;
}

/**
 * Regenerate the daemon auth token
 * Generates a new token and saves it, replacing any existing token
 */
export async function regenerateToken(): Promise<string> {
  const newToken = generateToken();
  await saveToken(newToken);
  return newToken;
}

/**
 * Delete the daemon auth token
 */
export async function deleteToken(): Promise<void> {
  const tokenPath = getTokenPath();

  try {
    await fs.unlink(tokenPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

/**
 * Validate a token format
 */
export function isValidTokenFormat(token: string): boolean {
  // Base64url encoded, 32 bytes = 43 characters
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
