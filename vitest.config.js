import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_PUBLISHABLE_KEY: '',
      VITE_SUPABASE_ANON_KEY: ''
    },
    // The Edge Function's pure logic lives under supabase/functions so Deno can
    // import it directly; its tests run here with everything else.
    include: ['src/**/*.test.{js,jsx}', 'supabase/functions/**/*.test.js'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/lib/**/*.{js,jsx}', 'src/components/**/*.jsx', 'src/pages/**/*.jsx'],
      exclude: ['src/**/*.test.*', 'src/test/**']
    }
  }
});
