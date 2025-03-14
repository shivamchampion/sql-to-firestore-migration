/**
 * Utility to manage UUID generation and maintain relationships
 * between old SQL IDs and new Firestore document IDs
 */
const { v4: uuidv4 } = require('uuid');

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
  states: {}
};

/**
 * Get or create a UUID for a given entity
 * @param {string} entity - The entity type (e.g., 'users', 'businesses')
 * @param {number|string} oldId - The old SQL ID
 * @returns {string} - The UUID v4 for the entity
 */
function getOrCreateUUID(entity, oldId) {
  if (!oldId || oldId === 0) {
    return null;
  }
  
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
  
  // Create new UUID and store the mapping
  const newUuid = uuidv4();
  idMappings[entity][id] = newUuid;
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
  return idMappings[entity]?.[id] || null;
}

/**
 * Set a specific UUID for an entity's old ID
 * @param {string} entity - The entity type
 * @param {number|string} oldId - The old SQL ID
 * @param {string} uuid - The UUID to set
 */
function setUUID(entity, oldId, uuid) {
  if (!oldId || oldId === 0) {
    return;
  }
  
  const id = String(oldId);
  
  if (!idMappings[entity]) {
    idMappings[entity] = {};
  }
  
  idMappings[entity][id] = uuid;
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
 * @returns {string} - A new UUID v4
 */
function generateUUID() {
  return uuidv4();
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
  const fs = require('fs');
  fs.writeFileSync(filePath, JSON.stringify(idMappings, null, 2));
}

/**
 * Load ID mappings from a JSON file
 * @param {string} filePath - Path to the mappings file
 */
function loadMappingsFromFile(filePath) {
  const fs = require('fs');
  if (fs.existsSync(filePath)) {
    const data = fs.readFileSync(filePath, 'utf8');
    const loadedMappings = JSON.parse(data);
    Object.assign(idMappings, loadedMappings);
  }
}

module.exports = {
  getOrCreateUUID,
  getUUID,
  setUUID,
  mapIdsToUUIDs,
  generateUUID,
  getEntityMappings,
  getAllMappings,
  saveMappingsToFile,
  loadMappingsFromFile
};