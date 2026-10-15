// Runs before each integration test file: unique prefix per file so suites never share state, and only OWN resources are touched
// (tables `<run>-insights` / `<run>-idempotency`, queue `<run>.analytics`, S3 keys of reports created by the test).
const unique = `it${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
process.env.IT_RUN_ID = unique;
process.env.IT_DYNAMODB_ENDPOINT ??= 'http://localhost:8000';
process.env.IT_RABBITMQ_URL ??= 'amqp://bandada:bandada@localhost:5672';
process.env.IT_S3_ENDPOINT ??= 'http://localhost:9000';
process.env.AWS_ACCESS_KEY_ID ??= 'local';
process.env.AWS_SECRET_ACCESS_KEY ??= 'local';
