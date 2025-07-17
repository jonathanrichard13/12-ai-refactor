// Enhanced JWT module with security best practices
import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";
import { NextRequest, NextResponse } from "next/server";
import { ResponseFormatter } from "./response-formatter";

// Secure JWT configuration with environment validation
const JWT_CONFIG = {
  secret: process.env.JWT_SECRET || (() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET environment variable is required in production');
    }
    console.warn('⚠️  Using default JWT secret - only for development!');
    return "development-secret-key-change-in-production";
  })(),
  
  accessTokenExpiry: process.env.JWT_ACCESS_EXPIRY || "15m", // Short-lived access tokens
  refreshTokenExpiry: process.env.JWT_REFRESH_EXPIRY || "7d", // Longer refresh tokens
  issuer: process.env.JWT_ISSUER || "demo-app",
  audience: process.env.JWT_AUDIENCE || "demo-app-users",
};

// Enhanced JWT payload interface
export interface JWTPayload extends JwtPayload {
  userId: number;
  email: string;
  role?: string;
  tokenType: 'access' | 'refresh';
  sessionId?: string;
}

// JWT token response interface
export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

// Enhanced JWT errors
export class JWTError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 401
  ) {
    super(message);
    this.name = 'JWTError';
  }
}

export class JWTService {
  // Generate secure token pair (access + refresh)
  static async generateTokens(payload: Omit<JWTPayload, 'tokenType' | 'iat' | 'exp' | 'iss' | 'aud'>): Promise<TokenResponse> {
    console.time("JWT Token Generation");
    
    try {
      const sessionId = this.generateSessionId();
      const now = Math.floor(Date.now() / 1000);
      
      // Generate access token
      const accessTokenPayload: JWTPayload = {
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
        tokenType: 'access',
        sessionId,
        iat: now,
        iss: JWT_CONFIG.issuer,
        aud: JWT_CONFIG.audience,
      };

      const accessToken = await this.signTokenAsync(accessTokenPayload, {
        expiresIn: JWT_CONFIG.accessTokenExpiry,
      } as SignOptions);

      // Generate refresh token
      const refreshTokenPayload: JWTPayload = {
        userId: payload.userId,
        email: payload.email,
        tokenType: 'refresh',
        sessionId,
        iat: now,
        iss: JWT_CONFIG.issuer,
        aud: JWT_CONFIG.audience,
      };

      const refreshToken = await this.signTokenAsync(refreshTokenPayload, {
        expiresIn: JWT_CONFIG.refreshTokenExpiry,
      } as SignOptions);

      // Calculate expiration time in seconds
      const expiresIn = this.parseExpiry(JWT_CONFIG.accessTokenExpiry);

      console.timeEnd("JWT Token Generation");
      
      return {
        accessToken,
        refreshToken,
        expiresIn,
        tokenType: 'Bearer',
      };
    } catch (error) {
      console.timeEnd("JWT Token Generation");
      console.error("JWT generation error:", error);
      throw new JWTError(
        'Failed to generate JWT tokens',
        'TOKEN_GENERATION_FAILED',
        500
      );
    }
  }

  // Verify and decode JWT token
  static async verifyToken(token: string, expectedType: 'access' | 'refresh' = 'access'): Promise<JWTPayload> {
    console.time("JWT Token Verification");
    
    try {
      if (!token || typeof token !== 'string') {
        throw new JWTError('Token is required', 'TOKEN_MISSING');
      }

      const decoded = await this.verifyTokenAsync(token);
      
      // Validate token structure
      if (!this.isValidJWTPayload(decoded)) {
        throw new JWTError('Invalid token structure', 'TOKEN_INVALID_STRUCTURE');
      }

      // Validate token type
      if (decoded.tokenType !== expectedType) {
        throw new JWTError(
          `Expected ${expectedType} token, got ${decoded.tokenType}`,
          'TOKEN_TYPE_MISMATCH'
        );
      }

      // Validate issuer and audience
      if (decoded.iss !== JWT_CONFIG.issuer || decoded.aud !== JWT_CONFIG.audience) {
        throw new JWTError('Token issuer or audience mismatch', 'TOKEN_INVALID_CLAIMS');
      }

      console.timeEnd("JWT Token Verification");
      return decoded;
    } catch (error) {
      console.timeEnd("JWT Token Verification");
      
      if (error instanceof JWTError) {
        throw error;
      }

      if (error instanceof jwt.JsonWebTokenError) {
        if (error.name === 'TokenExpiredError') {
          throw new JWTError('Token has expired', 'TOKEN_EXPIRED');
        }
        if (error.name === 'JsonWebTokenError') {
          throw new JWTError('Invalid token format', 'TOKEN_INVALID');
        }
        if (error.name === 'NotBeforeError') {
          throw new JWTError('Token not active yet', 'TOKEN_NOT_ACTIVE');
        }
      }

      console.error("JWT verification error:", error);
      throw new JWTError('Token verification failed', 'TOKEN_VERIFICATION_FAILED');
    }
  }

  // Refresh access token using refresh token
  static async refreshAccessToken(refreshToken: string): Promise<Pick<TokenResponse, 'accessToken' | 'expiresIn'>> {
    try {
      const decoded = await this.verifyToken(refreshToken, 'refresh');
      
      // Generate new access token with same session ID
      const accessTokenPayload: JWTPayload = {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
        tokenType: 'access',
        sessionId: decoded.sessionId,
        iat: Math.floor(Date.now() / 1000),
        iss: JWT_CONFIG.issuer,
        aud: JWT_CONFIG.audience,
      };

      const accessToken = await this.signTokenAsync(accessTokenPayload, {
        expiresIn: JWT_CONFIG.accessTokenExpiry,
      } as SignOptions);

      const expiresIn = this.parseExpiry(JWT_CONFIG.accessTokenExpiry);

      return { accessToken, expiresIn };
    } catch (error) {
      if (error instanceof JWTError) {
        throw error;
      }
      throw new JWTError('Failed to refresh token', 'TOKEN_REFRESH_FAILED');
    }
  }

  // Promise-based JWT sign
  private static signTokenAsync(payload: JWTPayload, options: SignOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      jwt.sign(payload, JWT_CONFIG.secret, options, (error, token) => {
        if (error || !token) {
          reject(error || new Error('Failed to sign token'));
        } else {
          resolve(token);
        }
      });
    });
  }

  // Promise-based JWT verify
  private static verifyTokenAsync(token: string): Promise<JWTPayload> {
    return new Promise((resolve, reject) => {
      jwt.verify(token, JWT_CONFIG.secret, {
        issuer: JWT_CONFIG.issuer,
        audience: JWT_CONFIG.audience,
      }, (error, decoded) => {
        if (error) {
          reject(error);
        } else {
          resolve(decoded as JWTPayload);
        }
      });
    });
  }

  // Type guard for JWT payload
  private static isValidJWTPayload(decoded: any): decoded is JWTPayload {
    return (
      decoded &&
      typeof decoded === 'object' &&
      typeof decoded.userId === 'number' &&
      typeof decoded.email === 'string' &&
      ['access', 'refresh'].includes(decoded.tokenType) &&
      typeof decoded.iss === 'string' &&
      typeof decoded.aud === 'string'
    );
  }

  // Generate unique session ID
  private static generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  // Parse expiry string to seconds
  private static parseExpiry(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 900; // Default 15 minutes

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      default: return 900;
    }
  }
}

// Enhanced authentication middleware with proper typing
export function authMiddleware<T extends NextRequest>(
  handler: (request: T & { user: JWTPayload }) => Promise<NextResponse>
) {
  return async (request: T): Promise<NextResponse> => {
    console.time("Auth Middleware Execution");

    try {
      const authHeader = request.headers.get("authorization");

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        console.timeEnd("Auth Middleware Execution");
        return ResponseFormatter.error(
          "Authentication required",
          401,
          'AUTH_REQUIRED'
        );
      }

      const token = authHeader.substring(7);
      const decoded = await JWTService.verifyToken(token, 'access');

      // Attach user to request with proper typing
      const authenticatedRequest = request as T & { user: JWTPayload };
      authenticatedRequest.user = decoded;

      console.timeEnd("Auth Middleware Execution");
      return handler(authenticatedRequest);
    } catch (error) {
      console.timeEnd("Auth Middleware Execution");
      
      if (error instanceof JWTError) {
        console.warn("Auth middleware error:", {
          code: error.code,
          message: error.message
        });
        
        return ResponseFormatter.error(
          error.message,
          error.statusCode,
          error.code
        );
      }

      console.error("Unexpected auth middleware error:", error);
      return ResponseFormatter.error(
        "Authentication failed",
        401,
        'AUTH_FAILED'
      );
    }
  };
}
