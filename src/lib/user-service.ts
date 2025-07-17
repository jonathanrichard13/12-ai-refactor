// Enhanced User service module with proper error handling and validation
import { executeQuery, DatabaseError } from "@/lib/database";
import { QueryResultRow } from "pg";

// Comprehensive interfaces with proper typing
export interface UserQueryOptions {
  division?: string;
  page?: number;
  limit?: number;
  includeStats?: boolean;
  sortBy?: 'created_at' | 'username' | 'full_name';
  sortOrder?: 'ASC' | 'DESC';
  search?: string;
}

export interface UserData {
  id: number;
  username: string;
  fullName: string;
  email: string;
  birthDate: string | null;
  bio?: string | null;
  longBio?: string | null;
  profileJson?: Record<string, unknown> | null;
  address?: string | null;
  phoneNumber?: string | null;
  createdAt: string;
  updatedAt: string;
  role?: string | null;
  division?: string | null;
}

export interface UserStats {
  totalUsers: number;
  activeUsers: number;
  usersByDivision: Record<string, number>;
  usersByRole: Record<string, number>;
}

export interface UserRow extends QueryResultRow {
  id: number;
  username: string;
  full_name: string;
  email: string;
  birth_date: string | null;
  bio: string | null;
  long_bio: string | null;
  profile_json: Record<string, unknown> | null;
  address: string | null;
  phone_number: string | null;
  created_at: string;
  updated_at: string;
  role: string | null;
  division_name: string | null;
}

// Input validation utilities
export class ValidationError extends Error {
  constructor(message: string, public readonly field: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class UserService {
  // Validate pagination parameters
  private static validatePaginationOptions(options: UserQueryOptions): {
    page: number;
    limit: number;
    sortBy: string;
    sortOrder: string;
  } {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(Math.max(1, options.limit || 50), 100); // Max 100 items per page
    const sortBy = options.sortBy || 'created_at';
    const sortOrder = options.sortOrder || 'DESC';

    // Validate sort column to prevent SQL injection
    const allowedSortColumns = ['created_at', 'username', 'full_name', 'id'];
    if (!allowedSortColumns.includes(sortBy)) {
      throw new ValidationError(`Invalid sort column: ${sortBy}`, 'sortBy');
    }

    // Validate sort order
    if (!['ASC', 'DESC'].includes(sortOrder)) {
      throw new ValidationError(`Invalid sort order: ${sortOrder}`, 'sortOrder');
    }

    return { page, limit, sortBy, sortOrder };
  }

  // Build optimized query with proper parameterization
  private static buildUsersQuery(options: UserQueryOptions): {
    query: string;
    params: unknown[];
  } {
    const { page, limit, sortBy, sortOrder } = this.validatePaginationOptions(options);
    const { division, search } = options;
    
    let query = `
      SELECT 
        u.id,
        u.username,
        u.full_name,
        u.birth_date,
        u.bio,
        u.long_bio,
        u.profile_json,
        u.address,
        u.phone_number,
        u.created_at,
        u.updated_at,
        a.email,
        ur.role,
        ud.division_name
      FROM users u
      LEFT JOIN auth a ON u.auth_id = a.id
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN user_divisions ud ON u.id = ud.user_id
    `;

    const whereConditions: string[] = [];
    const params: unknown[] = [];

    // Division filter
    if (division && division !== "all") {
      whereConditions.push(`ud.division_name = $${params.length + 1}`);
      params.push(division);
    }

    // Search filter
    if (search && search.trim()) {
      const searchTerm = `%${search.trim().toLowerCase()}%`;
      whereConditions.push(`(
        LOWER(u.username) LIKE $${params.length + 1} OR
        LOWER(u.full_name) LIKE $${params.length + 1} OR
        LOWER(a.email) LIKE $${params.length + 1}
      )`);
      params.push(searchTerm);
    }

    // Add WHERE clause if conditions exist
    if (whereConditions.length > 0) {
      query += ` WHERE ${whereConditions.join(' AND ')}`;
    }

    // Add sorting and pagination
    query += ` ORDER BY u.${sortBy} ${sortOrder}`;
    
    const offset = (page - 1) * limit;
    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    return { query, params };
  }

  // Get users with enhanced filtering and pagination
  static async getUsers(options: UserQueryOptions = {}): Promise<UserData[]> {
    try {
      const { query, params } = this.buildUsersQuery(options);
      const result = await executeQuery<UserRow>(query, params);
      
      return result.rows.map(this.mapUserData);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new DatabaseError(
        'Failed to fetch users',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Get comprehensive user statistics
  static async getUserStats(division?: string): Promise<UserStats> {
    try {
      const baseWhereClause = division && division !== "all" 
        ? "WHERE ud.division_name = $1" 
        : "";
      const params = division && division !== "all" ? [division] : [];

      // Get user counts by division and role in parallel
      const [divisionStats, roleStats, activityStats] = await Promise.all([
        // Division statistics
        executeQuery<{ division_name: string; user_count: string }>(`
          SELECT 
            COALESCE(ud.division_name, 'Unknown') as division_name,
            COUNT(DISTINCT u.id) as user_count
          FROM users u
          LEFT JOIN user_divisions ud ON u.id = ud.user_id
          ${baseWhereClause}
          GROUP BY ud.division_name
          ORDER BY user_count DESC
        `, params),

        // Role statistics
        executeQuery<{ role: string; user_count: string }>(`
          SELECT 
            COALESCE(ur.role, 'No Role') as role,
            COUNT(DISTINCT u.id) as user_count
          FROM users u
          LEFT JOIN user_roles ur ON u.id = ur.user_id
          LEFT JOIN user_divisions ud ON u.id = ud.user_id
          ${baseWhereClause}
          GROUP BY ur.role
          ORDER BY user_count DESC
        `, params),

        // Activity statistics (users with recent logs)
        executeQuery<{ active_users: string; total_users: string }>(`
          SELECT 
            COUNT(DISTINCT CASE WHEN ul.user_id IS NOT NULL THEN u.id END) as active_users,
            COUNT(DISTINCT u.id) as total_users
          FROM users u
          LEFT JOIN user_divisions ud ON u.id = ud.user_id
          LEFT JOIN (
            SELECT DISTINCT user_id 
            FROM user_logs 
            WHERE created_at > CURRENT_DATE - INTERVAL '30 days'
          ) ul ON u.id = ul.user_id
          ${baseWhereClause}
        `, params)
      ]);

      const usersByDivision = divisionStats.rows.reduce((acc, row) => {
        acc[row.division_name] = parseInt(row.user_count, 10);
        return acc;
      }, {} as Record<string, number>);

      const usersByRole = roleStats.rows.reduce((acc, row) => {
        acc[row.role] = parseInt(row.user_count, 10);
        return acc;
      }, {} as Record<string, number>);

      const totalUsers = parseInt(activityStats.rows[0]?.total_users || '0', 10);
      const activeUsers = parseInt(activityStats.rows[0]?.active_users || '0', 10);

      return {
        totalUsers,
        activeUsers,
        usersByDivision,
        usersByRole,
      };
    } catch (error) {
      throw new DatabaseError(
        'Failed to fetch user statistics',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Get total count for pagination
  static async getTotalCount(division?: string, search?: string): Promise<number> {
    try {
      const whereConditions: string[] = [];
      const params: unknown[] = [];

      if (division && division !== "all") {
        whereConditions.push(`ud.division_name = $${params.length + 1}`);
        params.push(division);
      }

      if (search && search.trim()) {
        const searchTerm = `%${search.trim().toLowerCase()}%`;
        whereConditions.push(`(
          LOWER(u.username) LIKE $${params.length + 1} OR
          LOWER(u.full_name) LIKE $${params.length + 1} OR
          LOWER(a.email) LIKE $${params.length + 1}
        )`);
        params.push(searchTerm);
      }

      let query = `
        SELECT COUNT(DISTINCT u.id) as total 
        FROM users u
        LEFT JOIN auth a ON u.auth_id = a.id
        LEFT JOIN user_divisions ud ON u.id = ud.user_id
      `;

      if (whereConditions.length > 0) {
        query += ` WHERE ${whereConditions.join(' AND ')}`;
      }

      const result = await executeQuery<{ total: string }>(query, params);
      return parseInt(result.rows[0]?.total || '0', 10);
    } catch (error) {
      throw new DatabaseError(
        'Failed to get user count',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Get user by ID with comprehensive data
  static async getUserById(id: number): Promise<UserData | null> {
    try {
      if (!Number.isInteger(id) || id <= 0) {
        throw new ValidationError('Invalid user ID', 'id');
      }

      const query = `
        SELECT 
          u.id, u.username, u.full_name, u.birth_date, u.bio, u.long_bio,
          u.profile_json, u.address, u.phone_number, u.created_at, u.updated_at,
          a.email, ur.role, ud.division_name
        FROM users u
        LEFT JOIN auth a ON u.auth_id = a.id
        LEFT JOIN user_roles ur ON u.id = ur.user_id
        LEFT JOIN user_divisions ud ON u.id = ud.user_id
        WHERE u.id = $1
      `;

      const result = await executeQuery<UserRow>(query, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }

      return this.mapUserData(result.rows[0]);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new DatabaseError(
        `Failed to fetch user with ID ${id}`,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Enhanced data mapping with null safety
  private static mapUserData(row: UserRow): UserData {
    return {
      id: row.id,
      username: row.username,
      fullName: row.full_name,
      email: row.email,
      birthDate: row.birth_date,
      bio: row.bio,
      longBio: row.long_bio,
      profileJson: row.profile_json,
      address: row.address,
      phoneNumber: row.phone_number,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      role: row.role,
      division: row.division_name,
    };
  }
}
