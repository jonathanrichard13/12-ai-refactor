// Enhanced Profile service with proper validation and error handling
import { executeQuery, DatabaseError, executeTransaction } from "@/lib/database";
import { QueryResultRow } from "pg";

// Comprehensive profile interfaces
export interface ProfileData {
  username: string;
  fullName: string;
  email: string;
  phone: string;
  birthDate: string;
  bio?: string;
  longBio?: string;
  address?: string;
  profileJson?: Record<string, unknown>;
}

export interface UserProfile {
  id: number;
  authId: number;
  username: string;
  fullName: string;
  email: string;
  bio?: string | null;
  longBio?: string | null;
  profileJson?: Record<string, unknown> | null;
  address?: string | null;
  phoneNumber?: string | null;
  birthDate: string | null;
  role?: string | null;
  division?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileRow extends QueryResultRow {
  id: number;
  auth_id: number;
  username: string;
  full_name: string;
  email: string;
  bio: string | null;
  long_bio: string | null;
  profile_json: Record<string, unknown> | null;
  address: string | null;
  phone_number: string | null;
  birth_date: string | null;
  role: string | null;
  division_name: string | null;
  created_at: string;
  updated_at: string;
}

// Enhanced validation errors
export class ProfileValidationError extends Error {
  constructor(
    public readonly errors: Record<string, string>
  ) {
    super('Profile validation failed');
    this.name = 'ProfileValidationError';
  }
}

export class ProfileService {
  // Comprehensive profile validation
  static validateProfileData(data: Partial<ProfileData>): Record<string, string> {
    const errors: Record<string, string> = {};

    // Username validation
    if (!data.username || typeof data.username !== 'string') {
      errors.username = 'Username is required and must be a string';
    } else if (data.username.length < 6 || data.username.length > 50) {
      errors.username = 'Username must be between 6 and 50 characters';
    } else if (!/^[a-zA-Z0-9_]+$/.test(data.username)) {
      errors.username = 'Username can only contain letters, numbers, and underscores';
    }

    // Full name validation
    if (!data.fullName || typeof data.fullName !== 'string') {
      errors.fullName = 'Full name is required and must be a string';
    } else if (data.fullName.length < 2 || data.fullName.length > 100) {
      errors.fullName = 'Full name must be between 2 and 100 characters';
    } else if (!/^[a-zA-Z\s]+$/.test(data.fullName.trim())) {
      errors.fullName = 'Full name can only contain letters and spaces';
    }

    // Email validation
    if (!data.email || typeof data.email !== 'string') {
      errors.email = 'Email is required and must be a string';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      errors.email = 'Must be a valid email format';
    } else if (data.email.length > 100) {
      errors.email = 'Email cannot exceed 100 characters';
    }

    // Phone validation
    if (!data.phone || typeof data.phone !== 'string') {
      errors.phone = 'Phone number is required and must be a string';
    } else if (!/^\+?[1-9]\d{8,14}$/.test(data.phone.replace(/[\s-()]/g, ''))) {
      errors.phone = 'Phone must be a valid international format (8-15 digits)';
    }

    // Birth date validation
    if (data.birthDate) {
      const date = new Date(data.birthDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (isNaN(date.getTime())) {
        errors.birthDate = 'Birth date must be a valid date';
      } else if (date > today) {
        errors.birthDate = 'Birth date cannot be in the future';
      } else if (date < new Date('1900-01-01')) {
        errors.birthDate = 'Birth date cannot be before 1900';
      }
    }

    // Bio validation
    if (data.bio && (typeof data.bio !== 'string' || data.bio.length > 160)) {
      errors.bio = 'Bio must be a string with maximum 160 characters';
    }

    // Long bio validation
    if (data.longBio && (typeof data.longBio !== 'string' || data.longBio.length > 2000)) {
      errors.longBio = 'Long bio must be a string with maximum 2000 characters';
    }

    // Address validation
    if (data.address && (typeof data.address !== 'string' || data.address.length > 500)) {
      errors.address = 'Address must be a string with maximum 500 characters';
    }

    // Profile JSON validation
    if (data.profileJson && typeof data.profileJson !== 'object') {
      errors.profileJson = 'Profile JSON must be a valid object';
    }

    return errors;
  }

  // Get user profile by user ID
  static async getProfile(userId: number): Promise<UserProfile | null> {
    try {
      if (!Number.isInteger(userId) || userId <= 0) {
        throw new Error('Invalid user ID');
      }

      const query = `
        SELECT 
          u.id, u.auth_id, u.username, u.full_name, u.bio, u.long_bio,
          u.profile_json, u.address, u.phone_number, u.birth_date,
          u.created_at, u.updated_at,
          a.email,
          ur.role,
          ud.division_name
        FROM users u
        LEFT JOIN auth a ON u.auth_id = a.id
        LEFT JOIN user_roles ur ON u.id = ur.user_id
        LEFT JOIN user_divisions ud ON u.id = ud.user_id
        WHERE u.id = $1
      `;

      const result = await executeQuery<ProfileRow>(query, [userId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      return this.mapProfileData(result.rows[0]);
    } catch (error) {
      throw new DatabaseError(
        `Failed to fetch profile for user ${userId}`,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Update user profile with transaction support
  static async updateProfile(userId: number, profileData: ProfileData): Promise<UserProfile> {
    try {
      // Validate input data
      const validationErrors = this.validateProfileData(profileData);
      if (Object.keys(validationErrors).length > 0) {
        throw new ProfileValidationError(validationErrors);
      }

      // Check if username is already taken by another user
      await this.checkUsernameAvailability(profileData.username, userId);

      // Update profile within a transaction
      const updatedProfile = await executeTransaction(async (client) => {
        // Update user data
        const updateUserQuery = `
          UPDATE users 
          SET 
            username = $1, 
            full_name = $2, 
            bio = $3, 
            long_bio = $4,
            address = $5, 
            phone_number = $6, 
            profile_json = $7,
            birth_date = $8,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $9
          RETURNING *
        `;

        const userResult = await client.query(updateUserQuery, [
          profileData.username,
          profileData.fullName,
          profileData.bio || null,
          profileData.longBio || null,
          profileData.address || null,
          profileData.phone,
          profileData.profileJson ? JSON.stringify(profileData.profileJson) : null,
          profileData.birthDate || null,
          userId,
        ]);

        if (userResult.rows.length === 0) {
          throw new Error('User not found');
        }

        // Log the profile update action
        await client.query(
          `INSERT INTO user_logs (user_id, action, metadata, created_at) 
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
          [
            userId, 
            'update_profile',
            JSON.stringify({
              fields_updated: Object.keys(profileData),
              timestamp: new Date().toISOString()
            })
          ]
        );

        return userResult.rows[0];
      });

      // Fetch and return the complete updated profile
      const profile = await this.getProfile(userId);
      if (!profile) {
        throw new Error('Failed to retrieve updated profile');
      }

      return profile;
    } catch (error) {
      if (error instanceof ProfileValidationError) {
        throw error;
      }
      throw new DatabaseError(
        `Failed to update profile for user ${userId}`,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Check if username is available for the user
  private static async checkUsernameAvailability(username: string, userId: number): Promise<void> {
    const query = `SELECT id FROM users WHERE username = $1 AND id != $2`;
    const result = await executeQuery(query, [username, userId]);
    
    if (result.rows.length > 0) {
      throw new ProfileValidationError({
        username: 'Username is already taken by another user'
      });
    }
  }

  // Map database row to profile object
  private static mapProfileData(row: ProfileRow): UserProfile {
    return {
      id: row.id,
      authId: row.auth_id,
      username: row.username,
      fullName: row.full_name,
      email: row.email,
      bio: row.bio,
      longBio: row.long_bio,
      profileJson: row.profile_json,
      address: row.address,
      phoneNumber: row.phone_number,
      birthDate: row.birth_date,
      role: row.role,
      division: row.division_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
