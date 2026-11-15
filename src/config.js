// Reads environment variables once, so a missing one fails loudly at startup
// instead of causing a confusing error on some later request.

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}. See .env.example.`);
  }
  return value;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  apiKey: required('API_KEY'),
  port: Number(process.env.PORT) || 3000,
};
