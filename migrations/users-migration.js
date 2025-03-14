/**
 * Migration module for users collection
 */
const { getOrCreateUUID } = require('../utils/uuid-mapper');
const { processBatch } = require('../utils/batch-processor');
const { DEFAULTS, USER_ROLES } = require('../config/migration-config');
const logger = require('../utils/logger');

/**
 * Migrate users from SQL to Firestore
 * @param {FirebaseFirestore.Firestore} db - Firestore instance
 * @param {Object} data - SQL data containing users table
 * @param {Object} options - Migration options
 * @returns {Promise<Object>} - Migration result
 */
async function migrate(db, data, options = {}) {
  logger.info('Starting users migration');
  
  const { users = [], login_history = [], user_plans = [] } = data;
  
  // Apply limit if specified
  const usersToMigrate = options.limit ? users.slice(0, options.limit) : users;
  
  // Process users in batches
  const result = await processBatch(
    usersToMigrate,
    async (user) => transformUser(user, { login_history, user_plans }),
    {
      collection: 'users',
      dryRun: options.dryRun,
      label: 'Migrating users',
      batchSize: 100
    }
  );
  
  logger.info(`Users migration completed: ${result.processedCount} users processed`);
  
  return {
    collection: 'users',
    count: result.processedCount,
    errors: result.errors
  };
}

/**
 * Transform SQL user to Firestore user document
 * @param {Object} user - SQL user record
 * @param {Object} relatedData - Related data (login history, plans, etc.)
 * @returns {Object} - Firestore document operation
 */
function transformUser(user, relatedData) {
  const { login_history = [], user_plans = [] } = relatedData;
  
  // Generate a UUID for the user
  const userId = getOrCreateUUID('users', user.id);
  
  // Find user's login history
  const userLoginHistory = login_history.filter(log => log.user_id === user.id);
  
  // Find user's subscription plans
  const userSubscriptionPlans = user_plans.filter(plan => plan.user_id === user.id);
  
  // Determine user role
  let userRole = USER_ROLES.USER;
  if (user.user_role) {
    userRole = user.user_role.toLowerCase() === 'admin' ? USER_ROLES.ADMIN : user.user_role;
  }
  
  // Determine user status
  let status = 'active';
  if (user.user_status) {
    status = user.user_status.toLowerCase() === 'blocked' ? 'suspended' : user.user_status.toLowerCase();
  }
  
  // Get last login timestamp
  let lastLogin = null;
  if (userLoginHistory.length > 0) {
    const sortedLogins = userLoginHistory.sort((a, b) => {
      return new Date(b.date_login) - new Date(a.date_login);
    });
    lastLogin = sortedLogins[0].date_login;
  }
  
  // Determine current plan if any
  let currentPlan = null;
  if (userSubscriptionPlans.length > 0) {
    const activePlans = userSubscriptionPlans.filter(plan => plan.status === 1);
    if (activePlans.length > 0) {
      const mostRecentPlan = activePlans.sort((a, b) => {
        return new Date(b.plan_activate_date) - new Date(a.plan_activate_date);
      })[0];
      
      currentPlan = {
        id: getOrCreateUUID('plans', mostRecentPlan.plan_id),
        name: '', // Will be filled in by the plans migration
        type: '', // Will be filled in by the plans migration
        startDate: mostRecentPlan.plan_activate_date,
        endDate: null, // Calculate or will be filled later
        autoRenew: false,
        status: mostRecentPlan.status === 1 ? 'active' : 'expired'
      };
    }
  }
  
  // Transform user data to match Firestore schema
  const firestoreUser = {
    // Auth Info
    uid: userId,
    email: user.email || '',
    emailVerified: user.is_email_verified === 1,
    phoneNumber: user.mobile || '',
    phoneVerified: user.is_mobile_verified === 1,
    
    // Profile
    displayName: user.full_name || `${user.f_name || ''} ${user.l_name || ''}`.trim(),
    firstName: user.f_name || '',
    lastName: user.l_name || '',
    profileImage: user.profile_image ? {
      url: user.profile_image,
      path: `users/${userId}/profile_image`,
      uploadedAt: user.joining_date || DEFAULTS.CREATED_AT
    } : null,
    bio: '',
    
    // Location
    location: {
      address: user.address || '',
      city: user.city_name || '',
      state: user.state || '',
      pincode: user.pincode || '',
      country: user.country || 'India',
      coordinates: null
    },
    
    // Account status
    status: status,
    lastLogin: lastLogin || user.joining_date || DEFAULTS.CREATED_AT,
    accountCompleteness: user.signup_complete === 1 ? 100 : 50,
    
    // Role & permissions
    role: userRole,
    permissions: [],
    
    // Subscription
    currentPlan: currentPlan,
    
    // Resources
    connectsBalance: 0,
    connectsHistory: [],
    
    // Activity data
    listings: [],
    favorites: [],
    recentSearches: [],
    recentlyViewed: [],
    contactedListings: [],
    
    // Preferences & settings
    preferences: {
      notifications: {
        email: true,
        push: true,
        sms: false,
      },
      newsletter: true,
      marketingEmails: true,
      darkMode: false,
      language: 'en'
    },
    
    // Tracking & analytics
    analytics: {
      referredBy: '',
      signupSource: (user.fb_uid ? 'facebook' : (user.ga_uid ? 'google' : 'direct')),
      acquisitionChannel: '',
      deviceTokens: [],
      lastActive: lastLogin || user.joining_date || DEFAULTS.CREATED_AT,
      sessionCount: userLoginHistory.length
    },
    
    // Company/Organization information
    companyInfo: {
      companyName: '',
      role: '',
      gstNumber: '',
      panNumber: '',
      registrationNumber: '',
      websiteUrl: '',
      socialProfiles: {
        linkedin: '',
        facebook: '',
        twitter: '',
        instagram: ''
      }
    },
    
    // KYC & verification
    verification: {
      identityVerified: false,
      identityDocument: null,
      companyVerified: false,
      companyDocuments: []
    },
    
    // Timestamps
    createdAt: user.joining_date || DEFAULTS.CREATED_AT,
    updatedAt: user.activate_date || DEFAULTS.UPDATED_AT,
    emailVerifiedAt: user.is_email_verified === 1 ? (user.activate_date || DEFAULTS.CREATED_AT) : null,
    phoneVerifiedAt: user.is_mobile_verified === 1 ? (user.activate_date || DEFAULTS.CREATED_AT) : null,
    suspendedAt: user.block_date || null,
    suspensionReason: ''
  };
  
  return {
    docId: userId,
    data: firestoreUser
  };
}

module.exports = {
  migrate
};