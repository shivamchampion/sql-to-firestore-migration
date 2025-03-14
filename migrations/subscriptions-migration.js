/**
 * Migration module for subscriptions collection
 */
const { getOrCreateUUID, getUUID } = require('../utils/uuid-mapper');
const { processBatch } = require('../utils/batch-processor');
const { DEFAULTS } = require('../config/migration-config');
const logger = require('../utils/logger');

/**
 * Migrate subscriptions from SQL to Firestore
 * @param {FirebaseFirestore.Firestore} db - Firestore instance
 * @param {Object} data - SQL data containing user_plans, plans and users tables
 * @param {Object} options - Migration options
 * @returns {Promise<Object>} - Migration result
 */
async function migrate(db, data, options = {}) {
  logger.info('Starting subscriptions migration');
  
  const { user_plans = [], plans = [], users = [] } = data;
  
  // Apply limit if specified
  const subscriptionsToMigrate = options.limit ? user_plans.slice(0, options.limit) : user_plans;
  
  // Process subscriptions in batches
  const result = await processBatch(
    subscriptionsToMigrate,
    async (subscription) => transformSubscription(subscription, { plans, users }),
    {
      collection: 'subscriptions',
      dryRun: options.dryRun,
      label: 'Migrating subscriptions',
      batchSize: 100
    }
  );
  
  logger.info(`Subscriptions migration completed: ${result.processedCount} subscriptions processed`);
  
  return {
    collection: 'subscriptions',
    count: result.processedCount,
    errors: result.errors
  };
}

/**
 * Transform SQL user_plans to Firestore subscription document
 * @param {Object} subscription - SQL user_plans record
 * @param {Object} relatedData - Related data (plans, users)
 * @returns {Object} - Firestore document operation
 */
function transformSubscription(subscription, relatedData) {
  const { plans = [], users = [] } = relatedData;
  
  // Generate a UUID for the subscription
  const subscriptionId = getOrCreateUUID('subscriptions', subscription.id);
  
  // Get referenced entities
  const userId = getUUID('users', subscription.user_id);
  const planId = getUUID('plans', subscription.plan_id);
  
  // Find plan details
  const plan = plans.find(p => p.id === subscription.plan_id);
  
  // Find user details
  const user = users.find(u => u.id === subscription.user_id);
  
  // Calculate dates
  const startDate = subscription.plan_activate_date || DEFAULTS.CREATED_AT;
  let endDate = null;
  
  if (startDate && plan && plan.duration_months) {
    // Add plan duration to start date
    const startDateObj = new Date(startDate);
    endDate = new Date(startDateObj);
    endDate.setMonth(endDate.getMonth() + plan.duration_months);
  }
  
  // Determine if subscription is active
  const isActive = subscription.status === 1;
  const now = new Date();
  const isExpired = endDate && now > new Date(endDate);
  
  let status = 'expired';
  if (isActive && !isExpired) {
    status = 'active';
  } else if (!isActive) {
    status = 'cancelled';
  }
  
  // Transform subscription data to match Firestore schema
  const firestoreSubscription = {
    id: subscriptionId,
    userId: userId,
    planId: planId,
    planType: plan ? plan.plan_type : '',
    
    // Subscription status
    status: status,
    isActive: isActive && !isExpired,
    
    // Dates
    startDate: startDate,
    endDate: endDate,
    cancelledDate: isActive ? null : subscription.plan_activate_date || null,
    renewalDate: isActive && !isExpired ? endDate : null,
    
    // Payment details
    payment: {
      amount: plan ? parseFloat(plan.amount.replace(/[^0-9.]/g, '')) || 0 : 0,
      currency: 'INR',
      paymentMethod: '',
      transactionId: '',
      invoiceId: '',
      autoRenew: false,
      nextBillingDate: isActive && !isExpired ? endDate : null,
      nextBillingAmount: plan ? parseFloat(plan.amount.replace(/[^0-9.]/g, '')) || 0 : 0
    },
    
    // Subscription details
    details: {
      planName: plan ? plan.name : '',
      planFeatures: [],
      duration: plan ? `${plan.duration_months} month${plan.duration_months > 1 ? 's' : ''}` : '',
      durationDays: plan ? plan.duration_months * 30 : 0,
      promoCode: '',
      discount: 0,
      notes: ''
    },
    
    // Resource usage
    usage: {
      connectsTotal: 0,
      connectsUsed: 0,
      connectsRemaining: 0,
      listingsTotal: 0,
      listingsUsed: 0,
      contactsRevealed: subscription.revealed_count || 0,
      detailsViewed: subscription.respond_count || 0
    },
    
    // Specific listing type (if applicable)
    listingType: {
      typeId: subscription.type_id || '',
      typeName: subscription.type_name || ''
    },
    
    // History & logs
    history: {
      previousPlans: [],
      upgrades: [],
      renewals: [],
      usageLogs: []
    },
    
    // Timestamps
    createdAt: subscription.plan_activate_date || DEFAULTS.CREATED_AT,
    updatedAt: subscription.plan_activate_date || DEFAULTS.UPDATED_AT,
    createdBy: 'system',
    updatedBy: 'system',
    isDeleted: false
  };
  
  return {
    docId: subscriptionId,
    data: firestoreSubscription
  };
}

module.exports = {
  migrate
};