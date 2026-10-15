// Runs before each integration test file: unique queue per file so suites never share state.
const unique = `it${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
process.env.TICKETING_COMMANDS_QUEUE = `${unique}.ticketing-service.commands`;
process.env.IT_RUN_ID = unique;
process.env.IT_DYNAMODB_ENDPOINT ??= 'http://localhost:18006';
process.env.IT_RABBITMQ_URL ??= 'amqp://bandada:bandada@localhost:15706';
process.env.AWS_ACCESS_KEY_ID ??= 'local';
process.env.AWS_SECRET_ACCESS_KEY ??= 'local';
