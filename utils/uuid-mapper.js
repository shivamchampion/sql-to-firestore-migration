/**
 * Enhanced utility for UUID generation and relationship mapping
 * Provides robust ID mapping between SQL and Firestore 
 */
const { v4: uuidv4, v5: uuidv5 } = require('uuid');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// UUID namespace for consistent generation
const UUID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

// Store mappings between old SQL IDs and new UUID v4 IDs
const idMappings = {
  users: {},
  businesses: {},
  franchise: {},
  investors: {},
  listings: {}, // Consolidated businesses, franchises, investors, etc.
  plans: {},
  reviews: {},
  subscriptions: {},
  transactions: {},
  chatrooms: {},
  messages: {},
  industries: {},
  sub_industries: {},
  cities: {},
  states: {},
  _meta: {
    lastUpdated: new Date(),
    totalMappings: 0
  }
};

// Keep track of reverse mappings for lookups by UUID
const reverseIdMappings = {};

/**
 * Get or create a UUID for a given entity using deterministic generation
 * @param {string} entity - The entity type (e.g., 'users', 'businesses')
 * @param {number|string} oldId - The old SQL ID
 * @param {Object} options - Options for UUID generation
 * @returns {string} - The UUID v4 or v5 for the entity
 */
function getOrCreateUUID(entity, oldId, options = {}) {
  if (!oldId || oldId === 0) {
    return null;
  }
  
  const {
    deterministic = true, // Use deterministic UUID generation (v5) or random (v4)
    updateReverse = true, // Update reverse mappings
    namespaceOverride = null, // Optional custom namespace
    entityPrefix = ''      // Optional prefix for namespacing entities
  } = options;
  
  // Convert oldId to string for consistent handling
  const id = String(oldId);
  
  // Create the entity mapping if it doesn't exist
  if (!idMappings[entity]) {
    idMappings[entity] = {};
  }
  
  // Return existing UUID if already mapped
  if (idMappings[entity][id]) {
    return idMappings[entity][id];
  }
  
  // Create new UUID with deterministic or random generation
  let newUuid;
  
  if (deterministic) {
    // Create deterministic UUID based on entity and ID
    const namespace = namespaceOverride || UUID_NAMESPACE;
    const seed = `${entityPrefix}${entity}:${id}`;
    newUuid = uuidv5(seed, namespace);
  } else {
    // Create random UUID
    newUuid = uuidv4();
  }
  
  // Store the mapping
  idMappings[entity][id] = newUuid;
  
  // Update reverse mapping if enabled
  if (updateReverse) {
    if (!reverseIdMappings[entity]) {
      reverseIdMappings[entity] = {};
    }
    reverseIdMappings[entity][newUuid] = id;
  }
  
  // Update metadata
  idMappings._meta.lastUpdated = new Date();
  idMappings._meta.totalMappings++;
  
  // Special case for listings: If entity is a listing type, also map to consolidated listings
  const listingEntities = ['businesses', 'franchise', 'investors', 'startups', 'digital_assets'];
  if (listingEntities.includes(entity)) {
    idMappings.listings[id] = newUuid;
    
    if (updateReverse) {
      if (!reverseIdMappings.listings) {
        reverseIdMappings.listings = {};
      }
      reverseIdMappings.listings[newUuid] = id;
    }
  }
  
  return newUuid;
}

/**
 * Get UUID for an entity if it exists, otherwise return null
 * @param {string} entity - The entity type
 * @param {number|string} oldId - The old SQL ID
 * @returns {string|null} - The UUID if found, null otherwise
 */
function getUUID(entity, oldId) {
  if (!oldId || oldId === 0) {
    return null;
  }
  
  const id = String(oldId);
  
  // Try direct entity mapping first
  if (idMappings[entity]?.[id]) {
    return idMappings[entity][id];
  }
  
  // For listing types, check consolidated listings mapping
  const listingEntities = ['businesses', 'franchise', 'investors', 'startups', 'digital_assets'];
  if (listingEntities.includes(entity) && idMappings.listings?.[id]) {
    return idMappings.listings[id];
  }
  
  return null;
}

/**
 * Get original SQL ID from UUID
 * @param {string} entity - The entity type
 * @param {string} uuid - The UUID to lookup
 * @returns {string|null} - The original SQL ID if found, null otherwise
 */
function getOriginalId(entity, uuid) {
  if (!uuid) {
    return null;
  }
  
  if (reverseIdMappings[entity]?.[uuid]) {
    return reverseIdMappings[entity][uuid];
  }
  
  // For consolidated listings, check specific entity types
  if (entity === 'listings') {
    const listingEntities = ['businesses', 'franchise', 'investors', 'startups', 'digital_assets'];
    for (const listingEntity of listingEntities) {
      if (reverseIdMappings[listingEntity]?.[uuid]) {
        return reverseIdMappings[listingEntity][uuid];
      }
    }
  }
  
  return null;
}

/**
 * Set a specific UUID for an entity's old ID
 * @param {string} entity - The entity type
 * @param {number|string} oldId - The old SQL ID
 * @param {string} uuid - The UUID to set
 * @param {Object} options - Options for setting UUID
 */
function setUUID(entity, oldId, uuid, options = {}) {
  if (!oldId || oldId === 0 || !uuid) {
    return;
  }
  
  const { updateReverse = true } = options;
  const id = String(oldId);
  
  if (!idMappings[entity]) {
    idMappings[entity] = {};
  }
  
  // Store the mapping
  idMappings[entity][id] = uuid;
  
  // Update reverse mapping if enabled
  if (updateReverse) {
    if (!reverseIdMappings[entity]) {
      reverseIdMappings[entity] = {};
    }
    reverseIdMappings[entity][uuid] = id;
  }
  
  // Update metadata
  idMappings._meta.lastUpdated = new Date();
  idMappings._meta.totalMappings++;
  
  // Special case for listings
  const listingEntities = ['businesses', 'franchise', 'investors', 'startups', 'digital_assets'];
  if (listingEntities.includes(entity)) {
    idMappings.listings[id] = uuid;
    
    if (updateReverse) {
      if (!reverseIdMappings.listings) {
        reverseIdMappings.listings = {};
      }
      reverseIdMappings.listings[uuid] = id;
    }
  }
}

/**
 * Convert an array of old IDs to an array of UUIDs for a given entity
 * @param {string} entity - The entity type
 * @param {Array<number|string>} oldIds - Array of old SQL IDs
 * @returns {Array<string>} - Array of UUIDs
 */
function mapIdsToUUIDs(entity, oldIds) {
  if (!oldIds || !Array.isArray(oldIds)) {
    return [];
  }
  
  return oldIds
    .map(id => getUUID(entity, id))
    .filter(id => id !== null);
}

/**
 * Generate a new UUID without mapping
 * @param {Object} options - Options for UUID generation
 * @returns {string} - A new UUID
 */
function generateUUID(options = {}) {
  const { deterministic = false, seed = null, namespace = UUID_NAMESPACE } = options;
  
  if (deterministic && seed) {
    return uuidv5(String(seed), namespace);
  }
  
  return uuidv4();
}

/**
 * Ensure UUID mapping exists for a relationship
 * @param {string} sourceEntity - Source entity type
 * @param {string} targetEntity - Target entity type
 * @param {number|string} sourceId - Source entity ID
 * @param {number|string} targetId - Target entity ID
 * @returns {Object} - UUIDs for source and target
 */
function ensureRelationshipMappings(sourceEntity, targetEntity, sourceId, targetId) {
  const sourceUUID = getOrCreateUUID(sourceEntity, sourceId);
  const targetUUID = getOrCreateUUID(targetEntity, targetId);
  
  return {
    sourceUUID,
    targetUUID
  };
}

/**
 * Get all mappings for a specific entity
 * @param {string} entity - The entity type
 * @returns {Object} - Mapping of old IDs to UUIDs
 */
function getEntityMappings(entity) {
  return idMappings[entity] || {};
}

/**
 * Get total count of mappings for a specific entity
 * @param {string} entity - The entity type
 * @returns {number} - Count of mappings
 */
function getEntityMappingsCount(entity) {
  return idMappings[entity] ? Object.keys(idMappings[entity]).length : 0;
}

/**
 * Dump all ID mappings for debugging or persistence
 * @returns {Object} - All ID mappings
 */
function getAllMappings() {
  return idMappings;
}

/**
 * Save the ID mappings to a JSON file for future reference
 * @param {string} filePath - Path to save the mappings
 */
function saveMappingsToFile(filePath) {
  try {
    const dirPath = path.dirname(filePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    // Update metadata before saving
    idMappings._meta.lastUpdated = new Date();
    idMappings._meta.totalMappings = Object.keys(idMappings)
      .filter(key => key !== '_meta')
      .reduce((total, entity) => {
        return total + Object.keys(idMappings[entity]).length;
      }, 0);
    
    fs.writeFileSync(filePath, JSON.stringify(idMappings, null, 2));
    logger.info(`UUID mappings saved to ${filePath}`);
    
    return true;
  } catch (error) {
    logger.error(`Error saving UUID mappings: ${error.message}`);
    return false;
  }
}

/**
 * Load ID mappings from a JSON file
 * @param {string} filePath - Path to the mappings file
 * @returns {boolean} - Success status
 */
function loadMappingsFromFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      const loadedMappings = JSON.parse(data);
      
      // Merge loaded mappings with existing mappings
      Object.assign(idMappings, loadedMappings);
      
      // Rebuild reverse mappings
      Object.keys(idMappings).forEach(entity => {
        if (entity === '_meta') return;
        
        if (!reverseIdMappings[entity]) {
          reverseIdMappings[entity] = {};
        }
        
        Object.entries(idMappings[entity]).forEach(([id, uuid]) => {
          reverseIdMappings[entity][uuid] = id;
        });
      });
      
      logger.info(`UUID mappings loaded from ${filePath}`);
      return true;
    }
    
    logger.warn(`UUID mappings file not found: ${filePath}`);
    return false;
  } catch (error) {
    logger.error(`Error loading UUID mappings: ${error.message}`);
    return false;
  }
}

/**
 * Get statistics about the UUID mappings
 * @returns {Object} - Statistics
 */
function getMappingStats() {
  const stats = {
    totalMappings: 0,
    lastUpdated: idMappings._meta.lastUpdated,
    entityCounts: {}
  };
  
  Object.keys(idMappings).forEach(entity => {
    if (entity === '_meta') return;
    
    const count = Object.keys(idMappings[entity]).length;
    stats.entityCounts[entity] = count;
    stats.totalMappings += count;
  });
  
  return stats;
}

module.exports = {
  getOrCreateUUID,
  getUUID,
  getOriginalId,
  setUUID,
  mapIdsToUUIDs,
  generateUUID,
  ensureRelationshipMappings,
  getEntityMappings,
  getEntityMappingsCount,
  getAllMappings,
  saveMappingsToFile,
  loadMappingsFromFile,
  getMappingStats
};