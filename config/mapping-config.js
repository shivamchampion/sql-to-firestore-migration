/**
 * Configuration for mapping SQL tables to Firestore collections
 */

// Define the collection mappings
const COLLECTION_MAPPINGS = {
    users: {
      collection: 'users',
      primaryTable: 'users',
      requiredTables: ['users', 'login_history', 'user_plans'],
      idField: 'id',
      timestampFields: ['joining_date', 'activate_date', 'block_date'],
      description: 'User profiles and account information'
    },
    
    listings: {
      collection: 'listings',
      primaryTable: null, // Special case, combines multiple tables
      requiredTables: [
        'businesses', 
        'business_media', 
        'franchise', 
        'franchise_media', 
        'franchise_formats',
        'investors', 
        'investor_sub_industries',
        'investor_location_preference',
        'sub_industries',
        'industries',
        'cities',
        'states'
      ],
      description: 'All listing types (business, franchise, startup, investor, digital asset)'
    },
    
    reviews: {
      collection: 'reviews',
      primaryTable: 'comments',
      requiredTables: ['comments'],
      idField: 'id',
      timestampFields: ['doc'],
      description: 'Reviews for listings'
    },
    
    subscriptions: {
      collection: 'subscriptions',
      primaryTable: 'user_plans',
      requiredTables: ['user_plans', 'plans', 'users'],
      idField: 'id',
      description: 'User subscription details'
    },
    
    plans: {
      collection: 'plans',
      primaryTable: 'plans',
      requiredTables: ['plans', 'plan_features'],
      idField: 'id',
      description: 'Subscription plan definitions'
    },
    
    transactions: {
      collection: 'transactions',
      primaryTable: 'invoice',
      requiredTables: ['invoice', 'payment', 'users', 'user_plans'],
      idField: 'id',
      timestampFields: ['date_time', 'order_date'],
      description: 'Payment and connect usage transactions'
    },
    
    messages: {
      collection: 'messages',
      primaryTable: 'userchat_msg',
      requiredTables: ['userchat_msg', 'userchat', 'users', 'chat_files'],
      idField: 'id',
      timestampFields: ['msg_date'],
      description: 'User-to-user messages'
    },
    
    chatrooms: {
      collection: 'chatrooms',
      primaryTable: 'userchat',
      requiredTables: ['userchat', 'users'],
      idField: 'id',
      timestampFields: ['last_action', 'created_at'],
      description: 'Message groupings between users'
    },
    
    notifications: {
      collection: 'notifications',
      primaryTable: 'inbox',
      requiredTables: ['inbox'],
      idField: 'id',
      timestampFields: ['date_of_message'],
      description: 'User notifications'
    },
    
    activities: {
      collection: 'activities',
      primaryTable: 'user_history',
      requiredTables: ['user_history', 'post_activities'],
      idField: 'id',
      timestampFields: ['date_of_click', 'date_of_update'],
      description: 'User activity logs'
    },
    
    contentPages: {
      collection: 'contentPages',
      primaryTable: 'articles',
      requiredTables: ['articles'],
      idField: 'id',
      timestampFields: ['date_of_creation', 'date_of_action'],
      description: 'CMS content pages'
    }
  };
  
  /**
   * Get collection configuration by name
   * @param {string} collectionName - Collection name
   * @returns {Object} - Collection configuration
   */
  function getCollectionConfig(collectionName) {
    return COLLECTION_MAPPINGS[collectionName] || null;
  }
  
  /**
   * Get all collection configurations
   * @returns {Object} - All collection configurations
   */
  function getAllCollectionConfigs() {
    return COLLECTION_MAPPINGS;
  }
  
  module.exports = {
    getCollectionConfig,
    getAllCollectionConfigs
  };