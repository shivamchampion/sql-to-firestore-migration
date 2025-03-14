/**
 * Migration module for plans collection
 */
const { getOrCreateUUID } = require('../utils/uuid-mapper');
const { processBatch } = require('../utils/batch-processor');
const { DEFAULTS, PLAN_TYPES } = require('../config/migration-config');
const logger = require('../utils/logger');

/**
 * Migrate plans from SQL to Firestore
 * @param {FirebaseFirestore.Firestore} db - Firestore instance
 * @param {Object} data - SQL data containing plans and plan_features tables
 * @param {Object} options - Migration options
 * @returns {Promise<Object>} - Migration result
 */
async function migrate(db, data, options = {}) {
  logger.info('Starting plans migration');
  
  const { plans = [], plan_features = [] } = data;
  
  // Apply limit if specified
  const plansToMigrate = options.limit ? plans.slice(0, options.limit) : plans;
  
  // Process plans in batches
  const result = await processBatch(
    plansToMigrate,
    async (plan) => transformPlan(plan, { plan_features }),
    {
      collection: 'plans',
      dryRun: options.dryRun,
      label: 'Migrating plans',
      batchSize: 100
    }
  );
  
  logger.info(`Plans migration completed: ${result.processedCount} plans processed`);
  
  return {
    collection: 'plans',
    count: result.processedCount,
    errors: result.errors
  };
}

/**
 * Transform SQL plan to Firestore plan document
 * @param {Object} plan - SQL plan record
 * @param {Object} relatedData - Related data (plan features)
 * @returns {Object} - Firestore document operation
 */
function transformPlan(plan, relatedData) {
  const { plan_features = [] } = relatedData;
  
  // Generate a UUID for the plan
  const planId = getOrCreateUUID('plans', plan.id);
  
  // Find plan features
  const features = plan_features.filter(feature => feature.plan_id === plan.id)
    .map(feature => feature.features_name);
  
  // Map plan type to standard types
  let planType = PLAN_TYPES.BASIC;
  if (plan.plan_type) {
    const planTypeLower = plan.plan_type.toLowerCase();
    if (planTypeLower.includes('premium')) {
      planType = PLAN_TYPES.PREMIUM;
    } else if (planTypeLower.includes('standard')) {
      planType = PLAN_TYPES.STANDARD;
    } else if (planTypeLower.includes('free')) {
      planType = PLAN_TYPES.FREE;
    } else if (planTypeLower.includes('business')) {
      planType = PLAN_TYPES.BUSINESS;
    }
  }
  
  // Parse amount from string to number
  let amount = 0;
  if (plan.amount) {
    // Remove non-numeric characters except decimal point
    const amountStr = plan.amount.replace(/[^0-9.]/g, '');
    amount = parseFloat(amountStr) || 0;
  }
  
  // Calculate price per month
  const pricePerMonth = plan.duration_months > 0 
    ? Math.round(amount / plan.duration_months) 
    : amount;
  
  // Transform plan data to match Firestore schema
  const firestorePlan = {
    id: planId,
    name: plan.name || '',
    type: planType,
    description: '',
    shortDescription: '',
    features: features,
    
    // Pricing
    pricing: {
      amount: amount,
      currency: 'INR',
      billingCycle: plan.duration_months === 1 ? 'monthly' : 
                    plan.duration_months === 3 ? 'quarterly' :
                    plan.duration_months === 6 ? 'biannual' : 'annual',
      discountedFrom: 0,
      pricePerMonth: pricePerMonth,
      setupFee: 0,
      trialDays: 0
    },
    
    // Duration
    duration: {
      displayText: `${plan.duration_months} month${plan.duration_months > 1 ? 's' : ''}`,
      days: plan.duration_months * 30,
      months: plan.duration_months
    },
    
    // Resource limits
    limits: {
      connectsPerMonth: 0,
      totalConnects: 0,
      listings: {
        total: 1,
        featured: 0,
        premium: 0,
        perType: {
          business: 1,
          franchise: 1,
          startup: 1,
          investor: 1,
          digital_asset: 1
        }
      },
      views: {
        details: plan.reveal_limit || 0,
        contacts: plan.reveal_limit || 0,
        saved: plan.send_limit || 0
      }
    },
    
    // Display settings
    display: {
      color: planType === PLAN_TYPES.PREMIUM ? '#FFD700' : 
             planType === PLAN_TYPES.STANDARD ? '#0031AC' : 
             planType === PLAN_TYPES.BASIC ? '#4CAF50' : '#9E9E9E',
      icon: '',
      badge: planType,
      order: plan.id || 0,
      recommended: planType === PLAN_TYPES.STANDARD,
      highlight: planType === PLAN_TYPES.PREMIUM
    },
    
    // Availability
    availability: {
      isPublic: plan.status === 1,
      forUserTypes: ['user', 'business', 'investor'],
      forListingTypes: [
        PLAN_TYPES.BUSINESS,
        PLAN_TYPES.FRANCHISE,
        PLAN_TYPES.STARTUP,
        PLAN_TYPES.INVESTOR,
        PLAN_TYPES.DIGITAL_ASSET
      ],
      limitedTime: false,
      availableUntil: null,
      maxSubscribers: 0
    },
    
    // Features & permissions
    permissions: {
      canMessage: plan.send_limit > 0,
      canExport: planType === PLAN_TYPES.PREMIUM,
      canAccessAdvancedSearch: planType !== PLAN_TYPES.FREE,
      canAccessReports: planType === PLAN_TYPES.PREMIUM || planType === PLAN_TYPES.STANDARD,
      showAnalytics: plan.show_stats === 1,
      hideAds: planType === PLAN_TYPES.PREMIUM,
      priority: {
        support: planType === PLAN_TYPES.PREMIUM,
        visibility: plan.promotion_priority > 0,
        response: planType === PLAN_TYPES.PREMIUM
      }
    },
    
    // Additional benefits
    benefits: {
      consultationMinutes: planType === PLAN_TYPES.PREMIUM ? 30 : 0,
      additionalServices: [],
      partnerDiscounts: []
    },
    
    // Status
    status: plan.status === 1,
    
    // Tracking
    tracking: {
      subscribers: 0,
      viewCount: 0,
      conversionRate: 0
    },
    
    // Timestamps
    createdAt: DEFAULTS.CREATED_AT,
    updatedAt: DEFAULTS.UPDATED_AT,
    createdBy: 'system',
    updatedBy: 'system',
    isDeleted: false
  };
  
  return {
    docId: planId,
    data: firestorePlan
  };
}

module.exports = {
  migrate
};