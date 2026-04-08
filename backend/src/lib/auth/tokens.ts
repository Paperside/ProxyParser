import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface AccessTokenPayload {
  sub: string;
  username: string;
  iss: string;
  typ: "access";
  iat: number;
  exp: number;
}

interface CreateAccessTokenOptions {
  userId: string;
  username: string;
  issuer: string;
  secret: string;
  ttlSeconds: number;
}

interface VerifyAccessTokenOptions {
  token: string;
  issuer: string;
  secret: string;
}

const encodeJson = (value: unknown) => {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
};

const decodeJson = <T,>(value: string): T => {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf-8")) as T;
};

const signTokenPart = (value: string, secret: string) => {
  return createHmac("sha256", secret).update(value).digest("base64url");
};

export const createOpaqueToken = (bytes = 32) => {
  return randomBytes(bytes).toString("base64url");
};

export const hashOpaqueToken = (value: string) => {
  return createHash("sha256").update(value).digest("hex");
};

export const createAccessToken = ({
  userId,
  username,
  issuer,
  secret,
  ttlSeconds
}: CreateAccessTokenOptions) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: AccessTokenPayload = {
    sub: userId,
    username,
    iss: issuer,
    typ: "access",
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds
  };
  const headerPart = encodeJson({
    alg: "HS256",
    typ: "JWT"
  });
  const payloadPart = encodeJson(payload);
  const unsignedToken = `${headerPart}.${payloadPart}`;
  const signature = signTokenPart(unsignedToken, secret);

  return {
    token: `${unsignedToken}.${signature}`,
    expiresAt: new Date(payload.exp * 1000).toISOString()
  };
};

export const verifyAccessToken = ({
  token,
  issuer,
  secret
}: VerifyAccessTokenOptions): AccessTokenPayload | null => {
  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const expectedSignature = signTokenPart(`${headerPart}.${payloadPart}`, secret);

  const left = Buffer.from(signaturePart);
  const right = Buffer.from(expectedSignature);

  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }

  const payload = decodeJson<AccessTokenPayload>(payloadPart);

  if (payload.typ !== "access" || payload.iss !== issuer) {
    return null;
  }

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
};
