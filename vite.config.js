import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1'
  },
  build: {
    rollupOptions: {
      output: {
        // Keep the auth/vendor SDK out of the critical entry chunk so the first
        // paint stays small; both chunks are still loaded at boot, in parallel.
        manualChunks: {
          supabase: ['@supabase/supabase-js']
        }
      }
    }
  }
});
