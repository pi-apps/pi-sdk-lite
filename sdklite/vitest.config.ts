import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __SDKLITE_BACKEND_URL__: JSON.stringify("http://localhost:3005"),
  },
});
