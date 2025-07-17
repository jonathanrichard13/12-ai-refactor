// Enhanced Response utility functions with comprehensive error handling and validation
import { NextResponse } from "next/server";

// Comprehensive response interfaces with proper typing
export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  offset: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  pagination?: PaginationInfo;
  meta?: Record<string, unknown>;
  timestamp: string;
  requestId?: string;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    message: string;
    code?: string;
    details?: Record<string, unknown>;
  };
  timestamp: string;
  requestId?: string;
}

// Input validation for query parameters
export interface QueryParams {
  division: string;
  page: number;
  limit: number;
  includeStats: boolean;
  search?: string;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly value: unknown
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ResponseFormatter {
  // Generate unique request ID for tracking
  private static generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  // Enhanced success response with proper typing and metadata
  static success<T>(
    data: T,
    message = "Success",
    pagination?: PaginationInfo,
    meta?: Record<string, unknown>,
    requestId?: string
  ): NextResponse {
    const response: ApiResponse<T> = {
      success: true,
      data,
      message,
      timestamp: new Date().toISOString(),
      requestId: requestId || this.generateRequestId(),
      ...(pagination && { pagination }),
      ...(meta && { meta }),
    };
    
    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Request-ID': response.requestId || '',
      }
    });
  }

  // Enhanced error response with categorized error handling
  static error(
    message: string,
    status = 500,
    code?: string,
    details?: Record<string, unknown>,
    requestId?: string
  ): NextResponse {
    const response: ApiErrorResponse = {
      success: false,
      error: {
        message,
        ...(code && { code }),
        ...(details && { details }),
      },
      timestamp: new Date().toISOString(),
      requestId: requestId || this.generateRequestId(),
    };
    
    // Log error for monitoring (in production, use proper logging service)
    if (status >= 500) {
      console.error('🚨 Server Error:', {
        message,
        code,
        status,
        requestId: response.requestId,
        timestamp: response.timestamp,
        details
      });
    }
    
    return NextResponse.json(response, {
      status,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': response.requestId || '',
      }
    });
  }

  // Validation error response
  static validationError(
    message: string,
    field: string,
    value: unknown,
    requestId?: string
  ): NextResponse {
    return this.error(
      message,
      400,
      'VALIDATION_ERROR',
      { field, value },
      requestId
    );
  }

  // Not found error response
  static notFound(
    resource: string,
    identifier: string | number,
    requestId?: string
  ): NextResponse {
    return this.error(
      `${resource} not found`,
      404,
      'RESOURCE_NOT_FOUND',
      { resource, identifier },
      requestId
    );
  }

  // Enhanced pagination with validation and metadata
  static createPagination(
    page: number,
    limit: number,
    total: number
  ): PaginationInfo {
    // Validate inputs
    if (!Number.isInteger(page) || page < 1) {
      throw new ValidationError('Page must be a positive integer', 'page', page);
    }
    
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ValidationError('Limit must be between 1 and 100', 'limit', limit);
    }
    
    if (!Number.isInteger(total) || total < 0) {
      throw new ValidationError('Total must be a non-negative integer', 'total', total);
    }

    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    
    return {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
      offset,
    };
  }
}

// Enhanced query parameter parsing with comprehensive validation
export function parseQueryParams(request: Request): QueryParams {
  const url = new URL(request.url);
  
  // Extract and validate division
  const division = url.searchParams.get("division") || "all";
  if (division && typeof division !== 'string') {
    throw new ValidationError('Division must be a string', 'division', division);
  }

  // Extract and validate page
  const pageParam = url.searchParams.get("page");
  let page = 1;
  if (pageParam) {
    page = parseInt(pageParam, 10);
    if (isNaN(page) || page < 1) {
      throw new ValidationError('Page must be a positive integer', 'page', pageParam);
    }
  }

  // Extract and validate limit
  const limitParam = url.searchParams.get("limit");
  let limit = 50; // Default limit
  if (limitParam) {
    limit = parseInt(limitParam, 10);
    if (isNaN(limit) || limit < 1 || limit > 100) {
      throw new ValidationError('Limit must be between 1 and 100', 'limit', limitParam);
    }
  }

  // Extract and validate includeStats
  const includeStatsParam = url.searchParams.get("includeStats");
  const includeStats = includeStatsParam === "true";

  // Extract and validate search term
  const search = url.searchParams.get("search") || undefined;
  if (search && search.length > 100) {
    throw new ValidationError('Search term cannot exceed 100 characters', 'search', search);
  }

  // Extract and validate sort parameters
  const sortBy = url.searchParams.get("sortBy") || undefined;
  const allowedSortColumns = ['created_at', 'username', 'full_name'];
  if (sortBy && !allowedSortColumns.includes(sortBy)) {
    throw new ValidationError(
      `Sort column must be one of: ${allowedSortColumns.join(', ')}`,
      'sortBy',
      sortBy
    );
  }

  const sortOrderParam = url.searchParams.get("sortOrder");
  let sortOrder: 'ASC' | 'DESC' = 'DESC';
  if (sortOrderParam) {
    if (!['ASC', 'DESC'].includes(sortOrderParam.toUpperCase())) {
      throw new ValidationError('Sort order must be ASC or DESC', 'sortOrder', sortOrderParam);
    }
    sortOrder = sortOrderParam.toUpperCase() as 'ASC' | 'DESC';
  }

  return {
    division,
    page,
    limit,
    includeStats,
    search: search?.trim() || undefined,
    sortBy,
    sortOrder,
  };
}

// Rate limiting helpers (basic implementation)
export class RateLimiter {
  private static requests = new Map<string, { count: number; resetTime: number }>();

  static checkRateLimit(
    identifier: string,
    maxRequests = 100,
    windowMs = 60000 // 1 minute
  ): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now();
    const record = this.requests.get(identifier);

    if (!record || now > record.resetTime) {
      // Reset or create new record
      this.requests.set(identifier, {
        count: 1,
        resetTime: now + windowMs,
      });
      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetTime: now + windowMs,
      };
    }

    if (record.count >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: record.resetTime,
      };
    }

    record.count++;
    return {
      allowed: true,
      remaining: maxRequests - record.count,
      resetTime: record.resetTime,
    };
  }
}
