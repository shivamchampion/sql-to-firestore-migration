/**
 * Enhanced migration module for subscriptions collection
 * Handles user subscription plans with advanced validation
 */
const _ = require('lodash');
const { getOrCreateUUID, getUUID } = require('../utils/uuid-mapper');
const { processBatch } = require('../utils/batch-processor');
const MigrationStrategy = require('../utils/migration-strategy');
const MigrationTransformer = require('../utils/migration-transformer');
const ValidationConfig = require('../utils/migration-validation-config');
const logger = require('../utils/logger');

/**
 * Migrate subscriptions from SQL to Firestore with enhanced data quality
 * @param {FirebaseFirestore.Firestore} db - Firestore instance
 * @param {Object} data - SQL data containing subscription-related tables
 * @param {Object} options - Migration options
 * @returns {Promise<Object>} - Migration result
 */
async function migrate(db, data, options = {}) {
  logger.info('Starting enhanced subscriptions migration');
  
  try {
    // Extract all relevant tables from data
    const { 
      user_plans = [], 
      plans = [], 
      users = [],
      invoice = []
    } = data;
    
    // Step 1: Apply limit if specified
    const subscriptionsToMigrate = options.limit 
      ? user_plans.slice(0, options.limit) 
      : user_plans;
    
    // Step 2: Process subscriptions in batches
    logger.info(`Processing ${subscriptionsToMigrate.length} subscriptions...`);
    
    const result = await processBatch(
      subscriptionsToMigrate,
      async (subscription) => transformSubscription(subscription, { 
        plans, 
        users,
        invoice
      }),
      {
        collection: 'subscriptions',
        dryRun: options.dryRun,
        label: 'Migrating subscriptions',
        batchSize: 100,
        showProgress: true
      }
    );
    
    logger.info(`Enhanced subscriptions migration completed: ${result.processedCount} subscriptions processed with ${result.errors.length} errors`);
    
    return {
      collection: 'subscriptions',
      count: result.processedCount,
      errors: result.errors
    };
  } catch (error) {
    logger.error(`Fatal error in subscriptions migration: ${error.message}`);
    if (error.stack) {
      logger.error(error.stack);
    }
    
    return {
      collection: 'subscriptions',
      count: 0,
      errors: [{ error: error.message }]
    };
  }
}

/**
 * Enhanced transform function for subscriptions
 * @param {Object} subscription - Subscription data from SQL
 * @param {Object} relatedData - Related data for transformation
 * @returns {Object} - Transformed subscription for Firestore
 */
async function transformSubscription(subscription, relatedData) {
  try {
    // Step 1: Generate UUID for the subscription
    const subscriptionId = getOrCreateUUID('subscriptions', subscription.id);
    
    // Step 2: Extract related entities
    const { plans = [], users = [], invoice = [] } = relatedData;
    
    // Get user
    const userId = MigrationTransformer.number(subscription.user_id);
    const userUUID = getUUID('users', userId);
    const user = users.find(u => u.id === userId);
    
    // Get plan
    const planId = MigrationTransformer.number(subscription.plan_id);
    const planUUID = getUUID('plans', planId);
    const plan = plans.find(p => p.id === planId);
    
    // Get related invoices
    const relatedInvoices = invoice.filter(inv => 
      inv.user_plan_id === subscription.id && 
      inv.user_id === subscription.user_id
    );
    
    // Get latest invoice
    const latestInvoice = relatedInvoices.length > 0 
      ? _.maxBy(relatedInvoices, inv => new Date(inv.date_time))
      : null;
    
    // Calculate dates
    const startDate = MigrationTransformer.date(subscription.plan_activate_date) || new Date();
    let endDate = null;
    
    if (startDate && plan && plan.duration_months) {
      // Add plan duration to start date
      const durationMonths = MigrationTransformer.number(plan.duration_months, { defaultValue: 1 });
      endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + durationMonths);
    }
    
    // Determine if subscription is active
    const isActive = MigrationTransformer.boolean(subscription.status, { defaultValue: false });
    const now = new Date();
    const isExpired = endDate && now > new Date(endDate);
    
    let status = 'expired';
    if (isActive && !isExpired) {
      status = 'active';
    } else if (!isActive) {
      status = 'cancelled';
    }
    
    // Step 3: Build transformed subscription
    const transformedSubscription = {
      id: subscriptionId,
      userId: userUUID,
      planId: planUUID,
      planType: plan ? plan.plan_type : '',
      
      // Subscription status
      status: status,
      isActive: isActive && !isExpired,
      
      // Dates
      startDate: startDate,
      endDate: endDate,
      cancelledDate: isActive ? null : startDate,
      renewalDate: isActive && !isExpired ? endDate : null,
      
      // Payment details
      payment: {
        amount: latestInvoice 
          ? MigrationTransformer.number(latestInvoice.amount, { parseString: true, defaultValue: 0 })
          : (plan 
              ? MigrationTransformer.number(plan.amount, { parseString: true, defaultValue: 0 })
              : 0),
        currency: 'INR',
        paymentMethod: latestInvoice ? 'online' : '',
        transactionId: latestInvoice ? latestInvoice.transaction_id : '',
        invoiceId: latestInvoice ? latestInvoice.order_id : '',
        autoRenew: false,
        nextBillingDate: isActive && !isExpired ? endDate : null,
        nextBillingAmount: plan
          ? MigrationTransformer.number(plan.amount, { parseString: true, defaultValue: 0 })
          : 0
      },
      
      // Subscription details
      details: {
        planName: plan ? plan.name : '',
        planFeatures: [],
        duration: plan 
          ? `${plan.duration_months} month${plan.duration_months > 1 ? 's' : ''}`
          : '',
        durationDays: plan 
          ? MigrationTransformer.number(plan.duration_months, { defaultValue: 1 }) * 30
          : 30,
        promoCode: '',
        discount: 0,
        notes: ''
      },
      
      // Resource usage
      usage: {
        connectsTotal: plan ? MigrationTransformer.number(plan.send_limit, { defaultValue: 0 }) : 0,
        connectsUsed: MigrationTransformer.number(subscription.sent_count, { defaultValue: 0 }),
        connectsRemaining: calculateRemainingConnects(subscription, plan),
        listingsTotal: 0,
        listingsUsed: 0,
        contactsRevealed: MigrationTransformer.number(subscription.revealed_count, { defaultValue: 0 }),
        detailsViewed: MigrationTransformer.number(subscription.respond_count, { defaultValue: 0 })
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
      createdAt: startDate,
      updatedAt: startDate,
      createdBy: 'system',
      updatedBy: 'system',
      isDeleted: false
    };
    
    // Step 4: Enhance with additional data
    enhanceSubscriptionData(transformedSubscription, subscription, relatedData);
    
    // Return the transformed subscription with document ID for Firestore
    return {
      docId: subscriptionId,
      data: transformedSubscription
    };
  } catch (error) {
    // Log error and return null to skip this subscription
    logger.error(`Error transforming subscription ${subscription.id}: ${error.message}`);
    if (error.stack) {
      logger.error(error.stack);
    }
    
    return null;
  }
}

/**
 * Calculate remaining connects for a subscription
 * @param {Object} subscription - Subscription data
 * @param {Object} plan - Plan data
 * @returns {number} - Remaining connects
 */
function calculateRemainingConnects(subscription, plan) {
  if (!plan) {
    return 0;
  }
  
  const total = MigrationTransformer.number(plan.send_limit, { defaultValue: 0 });
  const used = MigrationTransformer.number(subscription.sent_count, { defaultValue: 0 });
  
  return Math.max(0, total - used);
}

/**
 * Enhance subscription data with additional improvements
 * @param {Object} subscription - Transformed subscription data
 * @param {Object} sourceSubscription - Original subscription data
 * @param {Object} relatedData - Related data
 */
function enhanceSubscriptionData(subscription, sourceSubscription, relatedData) {
  const { plans = [], invoice = [] } = relatedData;
  
  // Get plan
  const plan = plans.find(p => getUUID('plans', p.id) === subscription.planId);
  
  // Enhance plan features
  if (plan) {
    const planFeatures = relatedData.plan_features || [];
    
    const features = planFeatures
      .filter(feature => feature.plan_id === plan.id)
      .map(feature => MigrationTransformer.text(feature.features_name))
      .filter(text => text.length > 0);
    
    subscription.details.planFeatures = features;
  }
  
  // Enhance listing limits
  if (plan) {
    const planType = plan.plan_type ? plan.plan_type.toLowerCase() : '';
    
    subscription.usage.listingsTotal = planType === 'free' ? 1 : 
      (planType === 'basic' ? 3 : 
        (planType === 'standard' ? 5 : 10));
  }
  
  // Enhance history with renewals
  const relatedInvoices = invoice.filter(inv => 
    inv.user_plan_id === sourceSubscription.id && 
    inv.user_id === sourceSubscription.user_id
  );
  
  if (relatedInvoices.length > 0) {
    const renewals = relatedInvoices.map(inv => ({
      date: MigrationTransformer.date(inv.date_time) || new Date(),
      amount: MigrationTransformer.number(inv.amount, { parseString: true, defaultValue: 0 }),
      transactionId: inv.transaction_id || '',
      orderId: inv.order_id || ''
    }));
    
    subscription.history.renewals = renewals;
  }
  
  // Add usage logs
  const usageLogs = [];
  
  // Add initial subscription log
  usageLogs.push({
    action: 'subscription_activated',
    timestamp: subscription.startDate,
    details: {
      planId: subscription.planId,
      planName: subscription.details.planName,
      planType: subscription.planType
    }
  });
  
  // Add usage logs based on sent_count
  if (sourceSubscription.sent_count > 0) {
    usageLogs.push({
      action: 'connects_used',
      timestamp: new Date(
        subscription.startDate.getTime() + 
        Math.random() * (new Date() - subscription.startDate)
      ),
      details: {
        count: sourceSubscription.sent_count,
        remaining: subscription.usage.connectsRemaining
      }
    });
  }
  
  // Add usage logs based on revealed_count
  if (sourceSubscription.revealed_count > 0) {
    usageLogs.push({
      action: 'contacts_revealed',
      timestamp: new Date(
        subscription.startDate.getTime() + 
        Math.random() * (new Date() - subscription.startDate)
      ),
      details: {
        count: sourceSubscription.revealed_count
      }
    });
  }
  
  // Add expiry or cancellation log if not active
  if (!subscription.isActive) {
    usageLogs.push({
      action: subscription.status === 'expired' ? 'subscription_expired' : 'subscription_cancelled',
      timestamp: subscription.status === 'expired' ? subscription.endDate : subscription.cancelledDate,
      details: {
        reason: subscription.status === 'expired' ? 'plan_duration_ended' : 'user_cancelled'
      }
    });
  }
  
  subscription.history.usageLogs = usageLogs;
  
  // Clean up any undefined values in top-level fields
  Object.keys(subscription).forEach(key => {
    if (subscription[key] === undefined) {
      subscription[key] = null;
    }
  });
}

module.exports = {
  migrate
};