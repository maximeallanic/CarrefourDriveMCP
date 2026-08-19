import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import type { SessionCookies, StoredSession } from '../types/index.js';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = join(__dirname, '../../data/sessions/session.enc');
const ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY || 'carrefour-mcp-default-key-32ch';

class SessionService {
  private session: StoredSession | null = null;
  private encryptionKey: Buffer;

  constructor() {
    this.encryptionKey = scryptSync(ENCRYPTION_KEY, 'salt', 32);
  }

  private encrypt(text: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  private decrypt(encryptedText: string): string {
    const [ivHex, encrypted] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  async loadSession(): Promise<StoredSession | null> {
    if (this.session) {
      return this.session;
    }

    try {
      if (!existsSync(SESSION_FILE)) {
        logger.info('No session file found');
        return null;
      }

      const encryptedData = await readFile(SESSION_FILE, 'utf8');
      const decrypted = this.decrypt(encryptedData);
      this.session = JSON.parse(decrypted);
      logger.info('Session loaded successfully');
      return this.session;
    } catch (error) {
      logger.error('Failed to load session:', error);
      return null;
    }
  }

  async saveSession(session: StoredSession): Promise<void> {
    try {
      const dir = dirname(SESSION_FILE);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      const encrypted = this.encrypt(JSON.stringify(session));
      await writeFile(SESSION_FILE, encrypted, 'utf8');
      this.session = session;
      logger.info('Session saved successfully');
    } catch (error) {
      logger.error('Failed to save session:', error);
      throw new Error('Failed to save session');
    }
  }

  async setCookies(cookies: SessionCookies): Promise<void> {
    const now = new Date().toISOString();
    const existingSession = await this.loadSession();

    const session: StoredSession = {
      cookies,
      storeId: existingSession?.storeId,
      storeName: existingSession?.storeName,
      createdAt: existingSession?.createdAt || now,
      lastUsed: now,
    };

    await this.saveSession(session);
  }

  async getCookies(): Promise<SessionCookies | null> {
    const session = await this.loadSession();
    return session?.cookies || null;
  }

  async getCookieString(): Promise<string> {
    const cookies = await this.getCookies();
    if (!cookies) {
      return '';
    }

    return Object.entries(cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  async setStore(storeId: string, storeName: string): Promise<void> {
    const session = await this.loadSession();
    if (!session) {
      throw new Error('No session found. Please set cookies first.');
    }

    session.storeId = storeId;
    session.storeName = storeName;
    session.lastUsed = new Date().toISOString();
    await this.saveSession(session);
  }

  async getStore(): Promise<{ id: string; name: string } | null> {
    const session = await this.loadSession();
    if (!session?.storeId) {
      return null;
    }

    return {
      id: session.storeId,
      name: session.storeName || '',
    };
  }

  async clearSession(): Promise<void> {
    try {
      if (existsSync(SESSION_FILE)) {
        await unlink(SESSION_FILE);
      }
      this.session = null;
      logger.info('Session cleared');
    } catch (error) {
      logger.error('Failed to clear session:', error);
      throw new Error('Failed to clear session');
    }
  }

  async updateLastUsed(): Promise<void> {
    const session = await this.loadSession();
    if (session) {
      session.lastUsed = new Date().toISOString();
      await this.saveSession(session);
    }
  }

  async hasValidSession(): Promise<boolean> {
    const cookies = await this.getCookies();
    return cookies !== null && Object.keys(cookies).length > 0;
  }
}

export const sessionService = new SessionService();
