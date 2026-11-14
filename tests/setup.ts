process.env.AUTH_SECRET =
  "test-only-auth-secret-0123456789abcdef0123456789abcdef";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.APP_URL = "http://localhost:3000";
process.env.ALLOW_REGISTRATION = "true";
process.env.ALLOW_INSECURE_LOCAL_ENDPOINTS = "false";
process.env.PGLITE_DATA_DIR = "memory";
