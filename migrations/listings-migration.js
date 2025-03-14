/**
 * Enhanced migration module for listings collection
 * Handles businesses, franchises, investors with robust transformations
 */
const _ = require('lodash');
const { getOrCreateUUID, getUUID } = require('../utils/uuid-mapper');
const { processBatch } = require('../utils/batch-processor');
const MigrationStrategy = require('../utils/migration-strategy');
const MigrationTransformer = require('../utils/migration-transformer');
const ValidationConfig = require('../utils/migration-validation-config');
const logger = require('../utils/logger');

/**
 * Migrate listings from SQL to Firestore with enhanced data integrity
 * @param {FirebaseFirestore.Firestore} db - Firestore instance
 * @param {Object} data - SQL data containing all listing-related tables
 * @param {Object} options - Migration options
 * @returns {Promise<Object>} - Migration result
 */
async function migrate(db, data, options = {}) {
  logger.info('Starting enhanced listings migration');
  
  try {
    // Extract all relevant tables from data
    const {
      businesses = [],
      business_media = [],
      franchise = [],
      franchise_media = [],
      franchise_formats = [],
      investors = [],
      investor_sub_industries = [],
      investor_location_preference = [],
      sub_industries = [],
      industries = [],
      cities = [],
      states = []
    } = data;
    
    // Step 1: Ensure all reference data is properly mapped with UUIDs
    logger.info('Preparing reference data mappings...');
    
    // Create mappings for industries and ensure consistent UUIDs
    const industryMap = await prepareIndustryMap(industries, sub_industries);
    
    // Create mappings for locations (cities and states)
    const locationMap = await prepareLocationMap(cities, states);
    
    // Step 2: Define migration tasks for different listing types
    logger.info('Defining migration tasks...');
    
    const migrationTasks = [
      {
        name: 'businesses',
        sourceData: businesses,
        type: 'business',
        relatedData: {
          media: business_media,
          industryMap: industryMap.industries,
          subIndustryMap: industryMap.subIndustries,
          industryRelationships: industryMap.relationships,
          cityMap: locationMap.cities,
          stateMap: locationMap.states
        }
      },
      {
        name: 'franchises',
        sourceData: franchise,
        type: 'franchise',
        relatedData: {
          media: franchise_media,
          formats: franchise_formats,
          industryMap: industryMap.industries,
          subIndustryMap: industryMap.subIndustries,
          industryRelationships: industryMap.relationships,
          cityMap: locationMap.cities,
          stateMap: locationMap.states
        }
      },
      {
        name: 'investors',
        sourceData: investors,
        type: 'investor',
        relatedData: {
          sub_industries,
          investor_sub_industries,
          investor_location_preference,
          industryMap: industryMap.industries,
          subIndustryMap: industryMap.subIndustries,
          industryRelationships: industryMap.relationships,
          cityMap: locationMap.cities,
          stateMap: locationMap.states
        }
      }
    ];
    
    // Step 3: Execute migration tasks
    logger.info('Executing migration tasks...');
    
    const results = await Promise.all(
      migrationTasks.map(async (task) => {
        logger.info(`Processing ${task.name}...`);
        
        // Apply limit if specified
        const sourceData = options.limit 
          ? task.sourceData.slice(0, options.limit) 
          : task.sourceData;
        
        return processBatch(
          sourceData,
          async (item) => transformListing(item, task.type, task.relatedData),
          {
            collection: 'listings',
            dryRun: options.dryRun,
            label: `Migrating ${task.name}`,
            batchSize: 50,
            showProgress: true
          }
        );
      })
    );
    
    // Step 4: Combine results and finalize
    const combinedResult = {
      collection: 'listings',
      count: results.reduce((sum, result) => sum + result.processedCount, 0),
      errors: results.reduce((errors, result) => [...errors, ...result.errors], [])
    };
    
    logger.info(`Enhanced listings migration completed: ${combinedResult.count} listings processed with ${combinedResult.errors.length} errors`);
    
    return combinedResult;
  } catch (error) {
    logger.error(`Fatal error in listings migration: ${error.message}`);
    if (error.stack) {
      logger.error(error.stack);
    }
    
    return {
      collection: 'listings',
      count: 0,
      errors: [{ error: error.message }]
    };
  }
}

/**
 * Prepare industry mapping with proper references
 * @param {Array<Object>} industries - Industries data
 * @param {Array<Object>} subIndustries - Sub-industries data
 * @returns {Promise<Object>} - Industry mappings
 */
async function prepareIndustryMap(industries, subIndustries) {
  // Create industry mappings
  const industryResult = MigrationStrategy.map.entities(
    industries,
    'industries',
    {
      nameField: 'name',
      transformFn: (industry) => ({
        id: getOrCreateUUID('industries', industry.id),
        name: MigrationTransformer.text(industry.name),
        slug: MigrationTransformer.slug(industry.slug, { sourceField: industry.name }),
        sourceId: industry.id,
        status: industry.status === 1
      })
    }
  );
  
  // Create sub-industry mappings with parent references
  const subIndustryResult = MigrationStrategy.map.entities(
    subIndustries,
    'sub_industries',
    {
      nameField: 'name',
      parentField: 'industry_id',
      parentType: 'industries',
      transformFn: (subIndustry) => {
        // Get parent industry UUID
        const parentId = getUUID('industries', subIndustry.industry_id);
        
        return {
          id: getOrCreateUUID('sub_industries', subIndustry.id),
          name: MigrationTransformer.text(subIndustry.name),
          slug: MigrationTransformer.slug(subIndustry.slug, { sourceField: subIndustry.name }),
          sourceId: subIndustry.id,
          industryId: subIndustry.industry_id,
          parentId: parentId, // Industry UUID reference
          status: subIndustry.status === 1
        };
      }
    }
  );
  
  return {
    industries: industryResult.entities,
    subIndustries: subIndustryResult.entities,
    relationships: {
      byIndustry: industryResult.dependencies,
      bySubIndustry: subIndustryResult.dependencies
    }
  };
}

/**
 * Prepare location mapping with proper references
 * @param {Array<Object>} cities - Cities data
 * @param {Array<Object>} states - States data
 * @returns {Promise<Object>} - Location mappings
 */
async function prepareLocationMap(cities, states) {
  // Create state mappings
  const stateResult = MigrationStrategy.map.entities(
    states,
    'states',
    {
      nameField: 'name',
      transformFn: (state) => ({
        id: getOrCreateUUID('states', state.id),
        name: MigrationTransformer.text(state.name),
        sourceId: state.id,
        countryId: state.country_id || 1
      })
    }
  );
  
  // Create city mappings with state references
  const cityResult = MigrationStrategy.map.entities(
    cities,
    'cities',
    {
      nameField: 'name',
      parentField: 'state_id',
      parentType: 'states',
      transformFn: (city) => {
        // Get parent state UUID
        const stateId = getUUID('states', city.state_id);
        
        return {
          id: getOrCreateUUID('cities', city.id),
          name: MigrationTransformer.text(city.name),
          sourceId: city.id,
          stateId: city.state_id,
          parentId: stateId, // State UUID reference
          isState: city.is_state === 1
        };
      }
    }
  );
  
  return {
    cities: cityResult.entities,
    states: stateResult.entities,
    relationships: {
      byState: stateResult.dependencies,
      byCity: cityResult.dependencies
    }
  };
}

/**
 * Enhanced transform function for listings of any type
 * @param {Object} listing - Listing data from SQL
 * @param {string} type - Listing type (business, franchise, investor)
 * @param {Object} relatedData - Related data for transformation
 * @returns {Object} - Transformed listing for Firestore
 */
async function transformListing(listing, type, relatedData) {
  try {
    // Step 1: Validate listing data first
    const validationResult = MigrationStrategy.validate.listing(listing, type);
    
    if (!validationResult.isValid) {
      // Log validation errors but continue with transformation
      validationResult.errors.forEach(error => {
        logger.warn(`Validation warning for ${type} listing ${listing.id}: ${error}`);
      });
    }
    
    // Step 2: Transform listing using the appropriate strategy
    const transformedListing = MigrationStrategy.transform.listing(listing, type, relatedData);
    
    // Step 3: Apply enhanced data standardization
    enhanceListingData(transformedListing, type);
    
    // Return the transformed listing with document ID for Firestore
    return {
      docId: transformedListing.id,
      data: transformedListing
    };
  } catch (error) {
    // Log error and return null to skip this listing
    logger.error(`Error transforming ${type} listing ${listing.id}: ${error.message}`);
    if (error.stack) {
      logger.error(error.stack);
    }
    
    return null;
  }
}

/**
 * Enhance listing data with additional standardization
 * @param {Object} listing - Transformed listing data
 * @param {string} type - Listing type
 */
function enhanceListingData(listing, type) {
  // Ensure all required fields exist
  listing.isDeleted = listing.isDeleted || false;
  
  // Ensure media structure is complete
  if (!listing.media) {
    listing.media = {};
  }
  
  if (!listing.media.featuredImage) {
    listing.media.featuredImage = {};
  }
  
  if (!listing.media.galleryImages) {
    listing.media.galleryImages = [];
  }
  
  if (!listing.media.videos) {
    listing.media.videos = [];
  }
  
  if (!listing.media.documents) {
    listing.media.documents = [];
  }
  
  // Ensure display settings are complete
  if (!listing.displaySettings) {
    listing.displaySettings = {};
  }
  
  // Ensure timestamps
  if (!listing.createdAt) {
    listing.createdAt = new Date();
  }
  
  if (!listing.updatedAt) {
    listing.updatedAt = new Date();
  }
  
  if (!listing.publishedAt) {
    listing.publishedAt = listing.createdAt;
  }
  
  // Type-specific enhancements
  if (type === 'business' && !listing.businessDetails) {
    listing.businessDetails = {};
  } else if (type === 'franchise' && !listing.franchiseDetails) {
    listing.franchiseDetails = {};
  } else if (type === 'investor' && !listing.investorDetails) {
    listing.investorDetails = {};
  }
  
  // Clean up any undefined or null values in top-level fields
  Object.keys(listing).forEach(key => {
    if (listing[key] === undefined) {
      listing[key] = null;
    }
  });
}

module.exports = {
  migrate
};