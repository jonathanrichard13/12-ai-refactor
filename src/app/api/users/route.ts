// Enhanced Users API with comprehensive error handling, validation, and performance optimization
import { NextRequest, NextResponse } from "next/server";
import { UserService, ValidationError, UserData, UserStats } from "@/lib/user-service";
import { ResponseFormatter, parseQueryParams, RateLimiter } from "@/lib/response-formatter";
import { DatabaseError } from "@/lib/database";

// Helper function to get client identifier for rate limiting
function getClientIdentifier(request: NextRequest): string {
  // In production, use proper IP extraction considering proxies
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const ip = forwarded ? forwarded.split(',')[0] : realIp || 'unknown';
  return ip;
}

export async function GET(request: NextRequest) {
  const startTime = performance.now();
  console.time("Users API Execution");
  
  let requestId: string | undefined;

  try {
    // Generate request ID for tracking
    requestId = `users_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // Rate limiting check
    const clientId = getClientIdentifier(request);
    const rateLimit = RateLimiter.checkRateLimit(clientId, 100, 60000); // 100 requests per minute
    
    if (!rateLimit.allowed) {
      console.timeEnd("Users API Execution");
      return ResponseFormatter.error(
        'Rate limit exceeded. Please try again later.',
        429,
        'RATE_LIMIT_EXCEEDED',
        {
          resetTime: new Date(rateLimit.resetTime).toISOString(),
          remaining: rateLimit.remaining
        },
        requestId
      );
    }

    // Parse and validate query parameters
    const queryParams = parseQueryParams(request);
    const { division, page, limit, includeStats, search, sortBy, sortOrder } = queryParams;

    // Log request for monitoring (in development)
    if (process.env.NODE_ENV === 'development') {
      console.log(`🔍 Users API Request ${requestId}:`, {
        division,
        page,
        limit,
        includeStats,
        search: search ? `"${search}"` : undefined,
        sortBy,
        sortOrder,
        clientId
      });
    }

    // Build user service options
    const userOptions = {
      division,
      page,
      limit,
      search,
      sortBy: sortBy as 'created_at' | 'username' | 'full_name' | undefined,
      sortOrder,
    };

    // Execute database operations in parallel for optimal performance
    const [users, totalCount, stats]: [UserData[], number, UserStats | null] = await Promise.all([
      UserService.getUsers(userOptions),
      UserService.getTotalCount(division, search),
      includeStats ? UserService.getUserStats(division) : Promise.resolve(null),
    ]);

    // Create pagination metadata
    const pagination = ResponseFormatter.createPagination(page, limit, totalCount);

    // Prepare response metadata
    const meta: Record<string, unknown> = {
      filteredBy: division,
      searchTerm: search,
      sortBy: sortBy || 'created_at',
      sortOrder,
      executionTime: `${(performance.now() - startTime).toFixed(2)}ms`,
      rateLimit: {
        remaining: rateLimit.remaining,
        resetTime: new Date(rateLimit.resetTime).toISOString()
      }
    };

    // Add statistics if requested
    if (stats) {
      meta.statistics = {
        totalUsers: stats.totalUsers,
        activeUsers: stats.activeUsers,
        usersByDivision: stats.usersByDivision,
        usersByRole: stats.usersByRole,
      };
    }

    console.timeEnd("Users API Execution");
    
    // Log successful response (in development)
    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ Users API Response ${requestId}:`, {
        userCount: users.length,
        totalCount,
        page,
        hasNext: pagination.hasNext,
        executionTime: meta.executionTime
      });
    }

    return ResponseFormatter.success(
      users,
      "Users retrieved successfully",
      pagination,
      meta,
      requestId
    );

  } catch (error) {
    console.timeEnd("Users API Execution");
    
    // Enhanced error handling with specific error types
    if (error instanceof ValidationError) {
      console.warn(`⚠️  Validation error in Users API ${requestId}:`, {
        field: error.field,
        message: error.message
      });
      
      return ResponseFormatter.validationError(
        error.message,
        error.field,
        'Invalid value',
        requestId
      );
    }

    if (error instanceof DatabaseError) {
      console.error(`❌ Database error in Users API ${requestId}:`, {
        message: error.message,
        originalError: error.originalError.message,
        query: error.query?.substring(0, 100)
      });
      
      return ResponseFormatter.error(
        "Database operation failed",
        500,
        'DATABASE_ERROR',
        {
          message: error.message,
          // Don't expose sensitive database details in production
          ...(process.env.NODE_ENV === 'development' && {
            originalError: error.originalError.message
          })
        },
        requestId
      );
    }

    // Generic error handling
    console.error(`❌ Unexpected error in Users API ${requestId}:`, {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined
    });

    return ResponseFormatter.error(
      "An unexpected error occurred",
      500,
      'INTERNAL_SERVER_ERROR',
      undefined,
      requestId
    );
  }
}
