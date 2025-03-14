/**
 * Global configuration for the migration process
 */

// Listing types mapping
const LISTING_TYPES = {
    BUSINESS: 'business',
    FRANCHISE: 'franchise',
    STARTUP: 'startup',
    INVESTOR: 'investor',
    DIGITAL_ASSET: 'digital_asset'
  };
  
  // Listing status mapping
  const LISTING_STATUS = {
    DRAFT: 'draft',
    PENDING: 'pending',
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    EXPIRED: 'expired',
    SOLD: 'sold',
    FEATURED: 'featured',
    REJECTED: 'rejected',
    DELETED: 'deleted'
  };
  
  // Plan types mapping
  const PLAN_TYPES = {
    FREE: 'free',
    BASIC: 'basic',
    STANDARD: 'standard',
    PREMIUM: 'premium',
    BUSINESS: 'business'
  };
  
  // User roles mapping
  const USER_ROLES = {
    USER: 'user',
    ADMIN: 'admin',
    MODERATOR: 'moderator',
    ADVISOR: 'advisor',
    BUSINESS: 'business',
    INVESTOR: 'investor'
  };
  
  // Connect types mapping
  const CONNECT_TYPES = {
    VIEW_CONTACT: 'view_contact',
    SEND_MESSAGE: 'send_message',
    REVEAL_DETAILS: 'reveal_details',
    REQUEST_INFO: 'request_info'
  };
  
  // Migration batch sizes
  const BATCH_SIZES = {
    USERS: 500,
    LISTINGS: 200,
    REVIEWS: 500,
    SUBSCRIPTIONS: 500,
    PLANS: 500,
    TRANSACTIONS: 500,
    MESSAGES: 1000,
    CHATROOMS: 500,
    NOTIFICATIONS: 1000,
    ACTIVITIES: 1000,
    CONTENT_PAGES: 500
  };
  
  // Default values
  const DEFAULTS = {
    CREATED_AT: new Date('2024-01-01T00:00:00Z'),
    UPDATED_AT: new Date('2024-01-01T00:00:00Z'),
    STATUS: 'active',
    COUNTRY: 'India',
    CURRENCY: 'INR'
  };
  
  // File paths
  const FILE_PATHS = {
    SQL_DUMP: '../data/u485278146_backup.sql',
    ID_MAPPINGS: '../data/id-mappings.json',
    MIGRATION_LOG: '../logs/migration.log',
    ERROR_LOG: '../logs/error.log'
  };
  
  // SQL to Firestore type mappings
  const TYPE_MAPPINGS = {
    // SQL types to Firestore types
    tinyint: 'boolean',
    int: 'number',
    float: 'number',
    decimal: 'number',
    varchar: 'string',
    text: 'string',
    mediumtext: 'string',
    datetime: 'timestamp',
    timestamp: 'timestamp',
    date: 'timestamp',
    json: 'object',
    year: 'number'
  };
  
  // Entity relationship mappings
  const RELATIONSHIPS = {
    // Maps entity relationships for maintaining referential integrity
    users: {
      listings: { type: 'one-to-many', foreignKey: 'user_id' },
      plans: { type: 'many-to-many', joinTable: 'user_plans' }
    },
    listings: {
      users: { type: 'many-to-one', foreignKey: 'user_id' },
      reviews: { type: 'one-to-many', foreignKey: 'listing_id' }
    },
    plans: {
      users: { type: 'many-to-many', joinTable: 'user_plans' }
    }
  };
  
  // SQL tables to Firestore collections index mapping
  const TABLE_TO_COLLECTION = {
    users: 'users',
    businesses: 'listings',
    franchise: 'listings',
    investors: 'listings',
    comments: 'reviews',
    user_plans: 'subscriptions',
    plans: 'plans',
    invoice: 'transactions',
    payment: 'transactions',
    userchat: 'chatrooms',
    userchat_msg: 'messages',
    inbox: 'notifications',
    user_history: 'activities',
    articles: 'contentPages'
  };
  
  module.exports = {
    LISTING_TYPES,
    LISTING_STATUS,
    PLAN_TYPES,
    USER_ROLES,
    CONNECT_TYPES,
    BATCH_SIZES,
    DEFAULTS,
    FILE_PATHS,
    TYPE_MAPPINGS,
    RELATIONSHIPS,
    TABLE_TO_COLLECTION
  };