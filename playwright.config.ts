import { defineConfig } from '@playwright/test'

/**
 * E2E accessibility gate. Tests run against the production build served by
 * `vite preview`, so what passes here is what actually ships to Pages.
 * Port 4295 is unique to this lab (siblings hold 4288, 4303, 4304, ...) so a
 * stray `reuseExistingServer` never scans a different lab's preview.
 */
export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4295/crypto-lab-accumulator/',
    // Pin the emulated scheme to dark so the default scan is the real dark
    // default and the shared-header toggle deterministically reaches light.
    colorScheme: 'dark',
  },
  webServer: {
    // Build first: `vite preview` only serves whatever is already in `dist/`.
    // Without the build, a source change that fails to compile leaves the last
    // good bundle in place and the suite passes green against code that no
    // longer builds — which silently invalidates mutation checks.
    command: 'npm run build && npm run preview -- --port 4295 --strictPort',
    url: 'http://localhost:4295/crypto-lab-accumulator/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
