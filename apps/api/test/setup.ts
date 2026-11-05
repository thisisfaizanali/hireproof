// Tests read the same .env as the dev server; CI sets the variables directly.
try {
  process.loadEnvFile("../../.env");
} catch {
  // No .env file.
}
