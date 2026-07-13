// Staging gate (Cloudflare Pages Functions middleware). Enforces HTTP basic
// auth ONLY when STAGING_USER + STAGING_PASS are set on the Pages project;
// a project without them (production) serves every request untouched, so
// this file is safe to merge to main.

type Env = {
  STAGING_USER?: string;
  STAGING_PASS?: string;
};

type MiddlewareContext = {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
};

// Constant-time comparison so the credential check leaks no timing signal.
const timingSafeEqual = (a: string, b: string): boolean => {
  const enc = new TextEncoder();
  const bytesA = enc.encode(a);
  const bytesB = enc.encode(b);
  let diff = bytesA.length ^ bytesB.length;
  for (let i = 0; i < bytesA.length; i += 1) {
    diff |= bytesA[i] ^ (bytesB[i % (bytesB.length || 1)] ?? 0);
  }
  return diff === 0;
};

export const onRequest = async ({
  request,
  env,
  next,
}: MiddlewareContext): Promise<Response> => {
  if (!env.STAGING_USER || !env.STAGING_PASS) return next();

  const expected = `Basic ${btoa(`${env.STAGING_USER}:${env.STAGING_PASS}`)}`;
  const provided = request.headers.get('Authorization') ?? '';
  if (timingSafeEqual(provided, expected)) return next();

  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="WAI staging", charset="UTF-8"',
    },
  });
};
