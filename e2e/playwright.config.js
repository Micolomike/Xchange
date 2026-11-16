import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Base de données jetable, partagée par le processus principal et les workers.
process.env.XCHANGE_E2E_DATA ??= fs.mkdtempSync(path.join(os.tmpdir(), 'xchange-e2e-'));

// XCHANGE_E2E_MODE=pc : l'API sert elle-même le site compilé, sur 127.0.0.1 (configuration d'un PC).
const PC_MODE = process.env.XCHANGE_E2E_MODE === 'pc';
const API_URL = 'http://127.0.0.1:4000';
const APP_URL = PC_MODE ? API_URL : 'http://localhost:4173';
// Dossier qui joue le rôle d'une clé USB pour la sauvegarde écrite par le serveur.
const USB_DIR = path.join(process.env.XCHANGE_E2E_DATA, 'cle-usb');
fs.mkdirSync(USB_DIR, { recursive: true });
const apiEnv = {
  PORT: '4000',
  DATA_DIR: process.env.XCHANGE_E2E_DATA,
  JWT_SECRET: 'e2e-secret',
  RATE_LIMIT: 'false',
  MFA_REQUIRED: 'true',
  BACKUP_TARGETS: USB_DIR,
};

// En local, CHROME_PATH permet d'utiliser un Chrome déjà installé.
const launchOptions = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};

export default defineConfig({
  testDir: './tests',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: APP_URL,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions,
  },
  projects: [
    {
      name: 'ordinateur',
      testMatch: /desktop\.spec\.js/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.js/,
      dependencies: ['ordinateur'], // réutilise les comptes et tickets créés sur ordinateur
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: PC_MODE
    ? [
        {
          command: 'npm run build:pc --prefix ../frontend && node index.js',
          cwd: '../backend',
          url: `${API_URL}/api/health`,
          env: { ...apiEnv, HOST: '127.0.0.1', SERVE_FRONTEND: 'true', TRUST_PROXY: '1' },
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ]
    : [
        {
          command: 'node index.js',
          cwd: '../backend',
          url: `${API_URL}/api/health`,
          env: apiEnv,
          reuseExistingServer: false,
          timeout: 30_000,
        },
        {
          // Build sans VITE_API_URL : l'aperçu Vite relaie /api vers l'API locale.
          command: 'npx vite build --mode e2e && npx vite preview --port 4173 --strictPort',
          cwd: '../frontend',
          url: APP_URL,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ],
});
