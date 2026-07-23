import type { VercelRequest, VercelResponse } from '@vercel/node';
import { env } from './env';

// Constant-shape check of the shared passphrase sent as a bearer token.
export function requirePassphrase(request: VercelRequest, response: VercelResponse): boolean {
  const header = request.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (token !== env.APP_PASSPHRASE) {
    response.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}
