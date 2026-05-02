export interface JwtPayload {
  sub: string;
  privyUserId: string;
  appId: string;
  sessionId: string;
  issuer: string;
  email?: string;
  iat?: number;
  exp?: number;
}
