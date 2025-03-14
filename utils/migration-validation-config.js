/**
 * Comprehensive validation configuration for migration
 * Defines validation rules, type mappings, and field constraints
 */

// Validation rules for different entity types
const VALIDATION_RULES = {
    // Common validation rules
    COMMON: {
      TEXT_LENGTHS: {
        SHORT: 100,
        MEDIUM: 255,
        LONG: 500,
        DESCRIPTION: 2000
      },
      NUMBER_RANGES: {
        PERCENT: { min: 0, max: 100 },
        RATING: { min: 0, max: 10 },
        YEAR: { min: 1900, max: new Date().getFullYear() + 10 }
      },
      DEFAULT_VALUES: {
        COUNTRY: 'India',
        CURRENCY: 'INR',
        STATUS: 'active'
      }
    },
  
    // User-specific validation
    USERS: {
      REQUIRED_FIELDS: ['email'],
      ROLES: ['user', 'admin', 'moderator', 'business', 'investor'],
      STATUS: ['active', 'inactive', 'suspended', 'deleted'],
      EMAIL_DOMAINS_BLOCKLIST: ['example.com', 'test.com']
    },
  
    // Listing-specific validation
    LISTINGS: {
      TYPES: [
        'business', 
        'franchise', 
        'startup', 
        'investor', 
        'digital_asset'
      ],
      STATUS: [
        'draft',
        'pending',
        'active',
        'inactive',
        'expired',
        'featured',
        'sold',
        'rejected',
        'deleted'
      ],
      REQUIRED_FIELDS: {
        business: ['name', 'description', 'type'],
        franchise: ['name', 'description', 'type'],
        investor: ['name', 'description', 'type'],
        startup: ['name', 'description', 'type'],
        digital_asset: ['name', 'description', 'type']
      },
      BUSINESS_TYPES: ['service', 'retail', 'manufacturing', 'wholesale', 'distribution'],
      ENTITY_TYPES: ['proprietorship', 'partnership', 'llp', 'pvt-ltd', 'public-ltd']
    },
  
    // Plan-specific validation
    PLANS: {
      TYPES: ['free', 'basic', 'standard', 'premium', 'business'],
      REQUIRED_FIELDS: ['name', 'type'],
      BILLING_CYCLES: ['monthly', 'quarterly', 'biannual', 'annual']
    },
  
    // Review-specific validation
    REVIEWS: {
      RATING_RANGE: { min: 1, max: 5 },
      STATUS: ['pending', 'approved', 'rejected', 'reported'],
      REQUIRED_FIELDS: ['content.text', 'rating']
    },
  
    // Transaction-specific validation
    TRANSACTIONS: {
      TYPES: ['subscription', 'promotion', 'connect_purchase', 'refund'],
      STATUS: ['pending', 'completed', 'failed', 'refunded'],
      PAYMENT_METHODS: ['card', 'upi', 'netbanking', 'wallet']
    },
  
    // Message-specific validation
    MESSAGES: {
      TYPES: ['text', 'image', 'document', 'system'],
      STATUS: ['sent', 'delivered', 'read', 'deleted']
    }
  };
  
  // SQL to Firestore type mappings
  const TYPE_MAPPINGS = {
    // SQL types to JavaScript types
    SQL_TO_JS: {
      tinyint: 'boolean',
      int: 'number',
      bigint: 'number',
      float: 'number',
      double: 'number',
      decimal: 'number',
      varchar: 'string',
      char: 'string',
      text: 'string',
      mediumtext: 'string',
      longtext: 'string',
      datetime: 'date',
      timestamp: 'date',
      date: 'date',
      time: 'string',
      year: 'number',
      enum: 'string',
      set: 'array',
      json: 'object',
      blob: 'buffer'
    },
  
    // SQL to Firestore field type mappings
    SQL_TO_FIRESTORE: {
      tinyint: 'boolean',
      int: 'number',
      bigint: 'number',
      float: 'number',
      double: 'number',
      decimal: 'number',
      varchar: 'string',
      char: 'string',
      text: 'string',
      mediumtext: 'string',
      longtext: 'string',
      datetime: 'timestamp',
      timestamp: 'timestamp',
      date: 'timestamp',
      time: 'string',
      year: 'number',
      enum: 'string',
      set: 'array',
      json: 'map',
      blob: 'bytes'
    }
  };
  
  // Field transformation configurations
  const FIELD_TRANSFORMATIONS = {
    // Text field transformations
    TEXT: {
      NAME: { 
        trim: true, 
        maxLength: VALIDATION_RULES.COMMON.TEXT_LENGTHS.MEDIUM,
        removeHtml: true
      },
      DESCRIPTION: { 
        trim: true, 
        maxLength: VALIDATION_RULES.COMMON.TEXT_LENGTHS.DESCRIPTION,
        removeHtml: true
      },
      SLUG: { 
        trim: true, 
        maxLength: VALIDATION_RULES.COMMON.TEXT_LENGTHS.MEDIUM,
        lowercase: true,
        removeHtml: true
      },
      EMAIL: { 
        trim: true, 
        lowercase: true,
        validateFormat: true
      },
      PHONE: { 
        validateFormat: true,
        countryCode: '+91'
      }
    },
  
    // Numeric field transformations
    NUMBER: {
      CURRENCY: { 
        precision: 2, 
        min: 0
      },
      PERCENT: { 
        precision: 2, 
        min: 0, 
        max: 100
      },
      COUNT: { 
        precision: 0, 
        min: 0
      },
      RATING: { 
        precision: 1, 
        min: 0, 
        max: 10
      }
    },
  
    // Date field transformations
    DATE: {
      STANDARD: { 
        format: 'YYYY-MM-DD HH:mm:ss',
        returnTimestamp: true
      },
      DATE_ONLY: { 
        format: 'YYYY-MM-DD',
        returnTimestamp: true
      },
      YEAR_ONLY: { 
        format: 'YYYY',
        returnTimestamp: true
      }
    },
  
    // Boolean field transformations
    BOOLEAN: {
      STANDARD: { 
        treatAsTrue: [1, '1', 'true', 'yes', 'y', true],
        treatAsFalse: [0, '0', 'false', 'no', 'n', false]
      }
    }
  };
  
  // Table to collection mapping
  const TABLE_COLLECTION_MAPPING = {
    users: 'users',
    businesses: 'listings',
    business_media: '_media',
    franchise: 'listings',
    franchise_media: '_media',
    investors: 'listings',
    investor_sub_industries: '_subIndustries',
    investor_location_preference: '_locations',
    plans: 'plans',
    plan_features: '_features',
    comments: 'reviews',
    user_plans: 'subscriptions',
    invoice: 'transactions',
    payment: '_payments',
    userchat: 'chatrooms',
    userchat_msg: 'messages',
    chat_files: '_files',
    inbox: 'notifications',
    user_history: 'activities',
    industries: '_industries',
    sub_industries: '_subIndustries',
    cities: '_cities',
    states: '_states'
  };
  
  // Entity relationship mapping
  const ENTITY_RELATIONSHIPS = {
    LISTINGS: {
      INDUSTRIES: 'many-to-many',
      SUB_INDUSTRIES: 'many-to-many',
      CITIES: 'many-to-one',
      STATES: 'many-to-one',
      USERS: 'many-to-one'
    },
    USERS: {
      PLANS: 'many-to-many',
      CITIES: 'many-to-one',
      STATES: 'many-to-one'
    },
    CHATROOMS: {
      USERS: 'many-to-many',
      LISTINGS: 'many-to-one'
    }
  };
  
  // Schema validation configurations (simplified for specific entities)
  const SCHEMA_VALIDATIONS = {
    USERS: {
      email: { type: 'email', required: true },
      displayName: { type: 'text', options: FIELD_TRANSFORMATIONS.TEXT.NAME },
      status: { type: 'text', options: { allowedValues: VALIDATION_RULES.USERS.STATUS } },
      role: { type: 'text', options: { allowedValues: VALIDATION_RULES.USERS.ROLES } }
    },
    LISTINGS: {
      name: { type: 'text', required: true, options: FIELD_TRANSFORMATIONS.TEXT.NAME },
      description: { type: 'text', options: FIELD_TRANSFORMATIONS.TEXT.DESCRIPTION },
      type: { type: 'text', required: true, options: { allowedValues: VALIDATION_RULES.LISTINGS.TYPES } },
      status: { type: 'text', options: { allowedValues: VALIDATION_RULES.LISTINGS.STATUS } }
    },
    PLANS: {
      name: { type: 'text', required: true, options: FIELD_TRANSFORMATIONS.TEXT.NAME },
      type: { type: 'text', required: true, options: { allowedValues: VALIDATION_RULES.PLANS.TYPES } }
    }
  };
  
  module.exports = {
    VALIDATION_RULES,
    TYPE_MAPPINGS,
    FIELD_TRANSFORMATIONS,
    TABLE_COLLECTION_MAPPING,
    ENTITY_RELATIONSHIPS,
    SCHEMA_VALIDATIONS
  };