import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

// Database configuration with proper environment validation
const validateDatabaseConfig = () => {
  const requiredEnvVars = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);
  
  if (missing.length > 0 && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
};

// Validate configuration on module load
validateDatabaseConfig();

// Optimized connection pool configuration
const pool = new Pool({
  user: process.env.DB_USER || "postgres",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "workshop_db",
  password: process.env.DB_PASSWORD || "admin123",
  port: parseInt(process.env.DB_PORT || "5432"),
  // Production-ready connection pool settings
  max: parseInt(process.env.DB_POOL_MAX || "20"),
  min: parseInt(process.env.DB_POOL_MIN || "5"),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || "30000"),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || "10000"),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT || "30000"),
  query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT || "30000"),
});

// Enhanced error handling and logging
pool.on('error', (err: Error) => {
  console.error('Unexpected error on idle client', err);
});

pool.on('connect', () => {
  if (process.env.NODE_ENV === 'development') {
    console.log('📊 Database connection established');
  }
});

// Log database configuration for debugging (only in development)
if (process.env.NODE_ENV === "development") {
  console.log("🔧 Database Configuration:");
  console.log("Host:", process.env.DB_HOST || "localhost");
  console.log("Port:", process.env.DB_PORT || "5432");
  console.log("User:", process.env.DB_USER || "postgres");
  console.log("Database:", process.env.DB_NAME || "workshop_db");
  console.log("Pool Max:", parseInt(process.env.DB_POOL_MAX || "20"));
}

// Database error types for better error handling
export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly originalError: Error,
    public readonly query?: string,
    public readonly params?: unknown[]
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

// Enhanced query execution with proper error handling and logging
export async function executeQuery<T extends QueryResultRow = QueryResultRow>(
  query: string, 
  params: unknown[] = []
): Promise<QueryResult<T>> {
  const queryId = Math.random().toString(36).substring(7);
  console.time(`DB Query ${queryId}`);
  
  let client: PoolClient | undefined;
  
  try {
    client = await pool.connect();
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`🔍 Executing query ${queryId}:`, query.substring(0, 100) + '...');
    }
    
    const result = await client.query<T>(query, params);
    
    console.timeEnd(`DB Query ${queryId}`);
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ Query ${queryId} returned ${result.rowCount} rows`);
    }
    
    return result;
  } catch (error) {
    console.timeEnd(`DB Query ${queryId}`);
    console.error(`❌ Database error in query ${queryId}:`, {
      error: error instanceof Error ? error.message : error,
      query: query.substring(0, 200) + '...',
      params: params?.slice(0, 5) // Log only first 5 params for security
    });
    
    throw new DatabaseError(
      `Database query failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error instanceof Error ? error : new Error(String(error)),
      query,
      params
    );
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Connection pool management with graceful shutdown
export async function closePool(): Promise<void> {
  try {
    await pool.end();
    console.log('🔒 Database connection pool closed gracefully');
  } catch (error) {
    console.error('❌ Error closing database pool:', error);
    throw error;
  }
}

// Health check for database connectivity
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const result = await executeQuery('SELECT 1 as health_check');
    return result.rows.length > 0 && result.rows[0].health_check === 1;
  } catch (error) {
    console.error('❌ Database health check failed:', error);
    return false;
  }
}

// Transaction support for complex operations
export async function executeTransaction<T>(
  operations: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    const result = await operations(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw new DatabaseError(
      `Transaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error instanceof Error ? error : new Error(String(error))
    );
  } finally {
    client.release();
  }
}

// Database initialization with proper table creation
export async function initializeDatabase(): Promise<void> {
  const tables = [
    // Auth table
    `CREATE TABLE IF NOT EXISTS auth (
      id SERIAL PRIMARY KEY,
      email VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    
    // Users table
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      auth_id INTEGER REFERENCES auth(id) ON DELETE CASCADE,
      full_name VARCHAR(100) NOT NULL,
      username VARCHAR(50) UNIQUE NOT NULL,
      birth_date DATE,
      bio TEXT,
      long_bio TEXT,
      profile_json JSONB,
      address TEXT,
      phone_number VARCHAR(20),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    
    // User roles table
    `CREATE TABLE IF NOT EXISTS user_roles (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, role)
    )`,
    
    // User divisions table
    `CREATE TABLE IF NOT EXISTS user_divisions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      division_name VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, division_name)
    )`,
    
    // User logs table
    `CREATE TABLE IF NOT EXISTS user_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      action VARCHAR(100) NOT NULL,
      metadata JSONB,
      ip_address INET,
      user_agent TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)',
    'CREATE INDEX IF NOT EXISTS idx_user_divisions_division_name ON user_divisions(division_name)',
    'CREATE INDEX IF NOT EXISTS idx_user_logs_user_id ON user_logs(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_user_logs_action ON user_logs(action)',
    'CREATE INDEX IF NOT EXISTS idx_user_logs_created_at ON user_logs(created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_users_profile_json ON users USING GIN(profile_json)'
  ];

  try {
    console.log('🏗️  Initializing database tables...');
    
    // Create tables
    for (const tableQuery of tables) {
      await executeQuery(tableQuery);
    }
    
    // Create indexes for performance
    console.log('📊 Creating database indexes...');
    for (const indexQuery of indexes) {
      await executeQuery(indexQuery);
    }
    
    console.log('✅ Database initialized successfully with optimized indexes');
  } catch (error) {
    console.error('❌ Failed to initialize database:', error);
    throw error;
  }
}

// Graceful shutdown handler
process.on('SIGINT', async () => {
  console.log('🛑 Received SIGINT, closing database connections...');
  await closePool();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM, closing database connections...');
  await closePool();
  process.exit(0);
});
