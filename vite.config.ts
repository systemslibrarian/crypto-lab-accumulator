import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/crypto-lab-accumulator/',
  test: {
    include: ['src/**/*.test.ts'],
  },
})
