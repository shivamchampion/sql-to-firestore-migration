/**
 * Enhanced migration module for plans collection
 * Handles subscription plans with comprehensive validation
 */
const _ = require('lodash');
const { getOrCreateUUID } = require('../utils/uuid-mapper');
const { processBatch } = require('../utils/batch-processor');
const MigrationStrategy = require('../utils/migration-strategy');
const MigrationTransformer = require('../utils/migration-transformer');
const ValidationConfig = require('../utils/migration-validation-config');
const logger = require('../utils/logger');

/**
 * Migrate plans from SQL to Firestore with enhanced data quality
 * @param {FirebaseFirestore.Firestore} db - Firestore instance
 * @param {Object} data - SQL data containing plans and plan_features tables
 * @param {Object} options - Migration options
 * @returns {Promise<Object>} - Migration result
 */
async function migrate(db, data, options = {}) {
  logger.info('Starting enhanced plans migration');
  
  try {
    // Extract all relevant tables from data
    const { plans = [], plan_features = [] } = data;
    
    // Step 1: Apply limit if specified
    const plansToMigrate = options.limit ? plans.slice(0, options.limit) : plans;
    
    // Step 2: Process plans in batches
    logger.info(`Processing ${plansToMigrate.length} plans...`);
    
    const result = await processBatch(
      plansToMigrate,
      async (plan) => transformPlan(plan, { plan_features }),
      {
        collection: 'plans',
        dryRun: options.dryRun,
        label: 'Migrating plans',
        batchSize: 100,
        showProgress: true
      }
    );
    
    logger.info(`Enhanced plans migration completed: ${result.processedCount} plans processed with ${result.errors.length} errors`);
    
    return {
      collection: 'plans',
      count: result.processedCount,
      errors: result.errors
    };
  } catch (error) {
    logger.error(`Fatal error in plans migration: ${error.message}`);
    if (error.stack) {
      logger.error(error.stack);
    }
    
    return {
      collection: 'plans',
      count: 0,
      errors: [{ error: error.message }]
    };
  }
}

/**
 * Enhanced transform function for plans
 * @param {Object} plan - Plan data from SQL
 * @param {Object} relatedData - Related data for transformation
 * @returns {Object} - Transformed plan for Firestore
 */
async function transformPlan(plan, relatedData) {
  try {
    // Step 1: Validate plan data first
    const validationResult = MigrationStrategy.validate.plan(plan);
    
    if (!validationResult.isValid) {
      // Log validation errors but continue with transformation
      validationResult.errors.forEach(error => {
        logger.warn(`Validation warning for plan ${plan.id}: ${error}`);
      });
    }
    
    // Step 2: Transform plan using the strategy
    const transformedPlan = MigrationStrategy.transform.plan(plan, relatedData);
    
    // Step 3: Enhance with additional data
    enhancePlanData(transformedPlan, plan, relatedData);
    
    // Return the transformed plan with document ID for Firestore
    return {
      docId: transformedPlan.id,
      data: transformedPlan
    };
  } catch (error) {
    // Log error and return null to skip this plan
    logger.error(`Error transforming plan ${plan.id}: ${error.message}`);
    if (error.stack) {
      logger.error(error.stack);
    }
    
    return null;
  }
}

/**
 * Enhance plan data with additional improvements
 * @param {Object} plan - Transformed plan data
 * @param {Object} sourcePlan - Original plan data
 * @param {Object} relatedData - Related data
 */
function enhancePlanData(plan, sourcePlan, relatedData) {
  const { plan_features = [] } = relatedData;
  
  // Format features more nicely
  const features = plan_features
    .filter(feature => feature.plan_id === sourcePlan.id)
    .map(feature => MigrationTransformer.text(feature.features_name))
    .filter(text => text.length > 0);
  
  plan.features = features;
  
  // Add structured description based on features
  if (features.length > 0) {
    plan.description = `${plan.name} - ${features.length} features including: ${features.slice(0, 3).join(', ')}${features.length > 3 ? '...' : ''}`;
    plan.shortDescription = `${plan.name} plan with ${features.length} features`;
  } else {
    plan.description = `${plan.name} subscription plan`;
    plan.shortDescription = plan.name;
  }
  
  // Update pricing details
  plan.pricing = {
    ...plan.pricing,
    setupFee: 0,
    trialDays: 0,
    discountedFrom: Math.round(plan.pricing.amount * 1.25) // Create a "discounted from" price
  };
  
  // Enhance plan limits
  plan.limits = {
    ...plan.limits,
    connectsPerMonth: MigrationTransformer.number(sourcePlan.send_limit, { defaultValue: 0 }),
    totalConnects: MigrationTransformer.number(sourcePlan.send_limit, { defaultValue: 0 }) * plan.duration.months,
    listings: {
      total: plan.type === 'free' ? 1 : (plan.type === 'basic' ? 3 : (plan.type === 'standard' ? 5 : 10)),
      featured: plan.type === 'premium' ? 2 : (plan.type === 'standard' ? 1 : 0),
      premium: plan.type === 'premium' ? 1 : 0,
      perType: {
        business: plan.type === 'free' ? 1 : (plan.type === 'basic' ? 2 : (plan.type === 'standard' ? 3 : 5)),
        franchise: plan.type === 'free' ? 1 : (plan.type === 'basic' ? 2 : (plan.type === 'standard' ? 3 : 5)),
        startup: plan.type === 'free' ? 1 : (plan.type === 'basic' ? 2 : (plan.type === 'standard' ? 3 : 5)),
        investor: plan.type === 'free' ? 1 : (plan.type === 'basic' ? 2 : (plan.type === 'standard' ? 3 : 5)),
        digital_asset: plan.type === 'free' ? 1 : (plan.type === 'basic' ? 2 : (plan.type === 'standard' ? 3 : 5))
      }
    },
    views: {
      details: MigrationTransformer.number(sourcePlan.reveal_limit, { defaultValue: 0 }),
      contacts: MigrationTransformer.number(sourcePlan.reveal_limit, { defaultValue: 0 }),
      saved: plan.type === 'free' ? 5 : (plan.type === 'basic' ? 20 : (plan.type === 'standard' ? 50 : 100))
    }
  };
  
  // Add additional benefits
  plan.benefits = {
    consultationMinutes: plan.type === 'premium' ? 30 : (plan.type === 'standard' ? 15 : 0),
    additionalServices: generateAdditionalServices(plan.type),
    partnerDiscounts: plan.type === 'premium' ? ['10% discount on Business Registration Services'] : []
  };
  
  // Enhance availability
  plan.availability = {
    ...plan.availability,
    forUserTypes: ['user', 'business', 'investor'],
    forListingTypes: [
      'business',
      'franchise',
      'startup',
      'investor',
      'digital_asset'
    ],
    limitedTime: false,
    availableUntil: null,
    maxSubscribers: 0
  };
  
  // Add display settings
  if (!plan.display) {
    plan.display = {};
  }
  
  plan.display = {
    ...plan.display,
    icon: getPlanIcon(plan.type),
    order: getPlanOrder(plan.type),
    recommended: plan.type === 'standard',
    highlight: plan.type === 'premium'
  };
  
  // Add tracking
  plan.tracking = {
    subscribers: 0,
    viewCount: 0,
    conversionRate: 0
  };
  
  // Ensure permissions are complete
  plan.permissions = {
    ...plan.permissions,
    canMessage: plan.type !== 'free',
    canExport: plan.type === 'premium' || plan.type === 'business',
    canAccessAdvancedSearch: plan.type !== 'free',
    canAccessReports: plan.type === 'premium' || plan.type === 'business',
    showAnalytics: MigrationTransformer.boolean(sourcePlan.show_stats, { defaultValue: plan.type !== 'free' }),
    hideAds: plan.type === 'premium' || plan.type === 'business',
    priority: {
      support: plan.type === 'premium' || plan.type === 'business',
      visibility: MigrationTransformer.number(sourcePlan.promotion_priority, { defaultValue: 0 }) > 0,
      response: plan.type === 'premium' || plan.type === 'business'
    }
  };
  
  // Ensure timestamps
  if (!plan.createdAt) {
    plan.createdAt = new Date();
  }
  
  if (!plan.updatedAt) {
    plan.updatedAt = new Date();
  }
  
  plan.createdBy = 'system';
  plan.updatedBy = 'system';
  
  // Add isDeleted flag
  plan.isDeleted = false;
  
  // Clean up any undefined values in top-level fields
  Object.keys(plan).forEach(key => {
    if (plan[key] === undefined) {
      plan[key] = null;
    }
  });
}

/**
 * Generate plan icon name based on type
 * @param {string} planType - Plan type
 * @returns {string} - Icon name
 */
function getPlanIcon(planType) {
  switch (planType) {
    case 'free':
      return 'gift';
    case 'basic':
      return 'package';
    case 'standard':
      return 'award';
    case 'premium':
      return 'star';
    case 'business':
      return 'briefcase';
    default:
      return 'package';
  }
}

/**
 * Generate plan display order based on type
 * @param {string} planType - Plan type
 * @returns {number} - Display order
 */
function getPlanOrder(planType) {
  switch (planType) {
    case 'free':
      return 1;
    case 'basic':
      return 2;
    case 'standard':
      return 3;
    case 'premium':
      return 4;
    case 'business':
      return 5;
    default:
      return 10;
  }
}

/**
 * Generate additional services based on plan type
 * @param {string} planType - Plan type
 * @returns {Array<string>} - Additional services
 */
function generateAdditionalServices(planType) {
  const services = [];
  
  switch (planType) {
    case 'premium':
      services.push(
        'Dedicated Account Manager',
        'Priority Listing Placement',
        'Advanced Analytics Dashboard'
      );
      break;
    case 'standard':
      services.push(
        'Email Support',
        'Enhanced Listing Visibility'
      );
      break;
    case 'basic':
      services.push('Basic Support');
      break;
  }
  
  return services;
}

module.exports = {
  migrate
};