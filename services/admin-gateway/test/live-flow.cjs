/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS script run with plain node */
// Manual check against the live infra: node test/live-flow.cjs (gateway on :17010 with JWKS_URL=http://host.docker.internal:19002/jwks.json)
const http = require('node:http');
(async () => {
  const { exportJWK, generateKeyPair, SignJWT } = await import('jose');
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'live-rs', alg: 'RS256', use: 'sig' };
  const jwks = http.createServer((_q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ keys: [jwk] })); }).listen(19002, '0.0.0.0');
  const token = await new SignJWT({ roles: ['ADMIN'], typ: 'user' }).setProtectedHeader({ alg: 'RS256', kid: 'live-rs' }).setSubject('0192a3b4-0000-7000-8000-00000000a001').setIssuer('http://api.bandada.localhost').setAudience('bandada-admin').setIssuedAt().setExpirationTime('10m').sign(privateKey);
  const gql = (query, tk = token) => fetch('http://localhost:17010/graphql', { method: 'POST', headers: { 'content-type': 'application/json', ...(tk ? { authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ query }) }).then((r) => r.json());
  console.log('anonymous:', JSON.stringify((await gql('{ universities { id } }', null)).errors[0].extensions));
  console.log('serviceHealth:', JSON.stringify((await gql('{ serviceHealth { overall services { name status latencyMs error } queues { name messagesReady isDeadLetter } } }')).data.serviceHealth, (k, v) => (k === 'queues' ? v.length + ' queues' : v)));
  console.log('me (identity down):', JSON.stringify((await gql('{ me { id } }')).errors[0].extensions));
  console.log('alerts:', JSON.stringify((await gql('{ alerts { id } }')).errors[0].extensions));
  console.log('introspection (prod image):', JSON.stringify((await gql('{ __schema { queryType { name } } }')).errors?.[0]?.message));
  jwks.close();
})();
