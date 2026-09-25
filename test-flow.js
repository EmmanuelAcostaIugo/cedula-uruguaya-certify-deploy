const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

const BASE = 'https://certify-iugolabs.duckdns.org';
const agent = new https.Agent({ keepAlive: true });

function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const url = new URL(BASE + path);
    const options = {
      method,
      agent,
      headers: { ...headers },
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const r = https.request(url, options, (res) => {
      let chunks = '';
      res.on('data', (c) => (chunks += c));
      res.on('end', () => resolve({ status: res.statusCode, body: chunks }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeProof(nonce, aud) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.use = 'sig';
  jwk.alg = 'ES256';
  const didJwk = 'did:jwk:' + b64url(JSON.stringify(jwk));
  const header = { alg: 'ES256', typ: 'openid4vci-proof+jwt', kid: didJwk + '#0' };
  const payload = { aud, nonce, iat: Math.floor(Date.now() / 1000) };
  const signingInput = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload));
  const signature = crypto.sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return signingInput + '.' + b64url(signature);
}

(async () => {
  const t0 = Date.now();
  const preauthBody = fs.readFileSync('preauth_body.json', 'utf8');
  const r1 = await req('POST', '/v1/certify/pre-authorized-data', preauthBody, { 'Content-Type': 'application/json' });
  const offerUri = JSON.parse(r1.body).credential_offer_uri;
  const offerId = decodeURIComponent(offerUri).split('/credential-offer-data/')[1];
  console.log('t+', Date.now() - t0, 'offer created', offerId);

  const r2 = await req('GET', '/v1/certify/credential-offer-data/' + offerId);
  const code = JSON.parse(r2.body).grants['urn:ietf:params:oauth:grant-type:pre-authorized_code']['pre-authorized_code'];
  console.log('t+', Date.now() - t0, 'code fetched');

  const form = `grant_type=urn:ietf:params:oauth:grant-type:pre-authorized_code&pre-authorized_code=${encodeURIComponent(code)}`;
  const r3 = await req('POST', '/v1/certify/oauth/token', form, { 'Content-Type': 'application/x-www-form-urlencoded' });
  const tok = JSON.parse(r3.body);
  console.log('t+', Date.now() - t0, 'token issued, c_nonce_expires_in=', tok.c_nonce_expires_in);

  const proof = makeProof(tok.c_nonce, BASE);
  console.log('t+', Date.now() - t0, 'proof generated');

  const credBody = {
    format: 'ldp_vc',
    credential_definition: {
      '@context': ['https://www.w3.org/2018/credentials/v1', 'https://emmanuelacostaiugo.github.io/DID/hackathon/cedula-uruguaya-context.json'],
      type: ['VerifiableCredential', 'CedulaUruguayaCredential'],
    },
    proof: { proof_type: 'jwt', jwt: proof },
  };
  const r4 = await req('POST', '/v1/certify/issuance/credential', credBody, {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + tok.access_token,
  });
  console.log('t+', Date.now() - t0, 'HTTP', r4.status);
  console.log(r4.body.substring(0, 800));
})();
