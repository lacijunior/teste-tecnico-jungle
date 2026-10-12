const TOKEN_ENDPOINT =
  process.env.AUTH_TOKEN_ENDPOINT ??
  'http://localhost:8080/realms/wagering/protocol/openid-connect/token';

export async function fetchProviderAccessToken(): Promise<string> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: 'wagering-provider',
      client_secret: 'wagering-provider-secret',
    }),
  });
  if (!response.ok) {
    throw new Error(
      `failed to obtain test access token: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { access_token: string };
  return body.access_token;
}
