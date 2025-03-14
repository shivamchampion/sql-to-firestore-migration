/**
 * Firestore service for handling database operations
 */
const admin = require('firebase-admin');
const path = require('path');
const logger = require('./logger');

let db = null;

/**
 * Initialize Firestore connection
 * @returns {FirebaseFirestore.Firestore} - Firestore instance
 */
function initializeFirestore() {
  if (db) {
    return db;
  }

  try {
    const serviceAccountPath = path.resolve(__dirname, '../serviceAccount.json');
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath)
    });
    
    db = admin.firestore();
    logger.info('Firestore initialized successfully');
    return db;
  } catch (error) {
    logger.error(`Failed to initialize Firestore: ${error.message}`);
    throw error;
  }
}

/**
 * Get Firestore instance
 * @returns {FirebaseFirestore.Firestore} - Firestore instance
 */
function getFirestore() {
  if (!db) {
    return initializeFirestore();
  }
  return db;
}

/**
 * Write a document to Firestore
 * @param {string} collection - Collection name
 * @param {string} docId - Document ID
 * @param {Object} data - Document data
 * @param {Object} options - Additional options
 * @returns {Promise<FirebaseFirestore.WriteResult>} - Write result
 */
async function writeDocument(collection, docId, data, options = {}) {
  const firestore = getFirestore();
  
  if (options.dryRun) {
    return Promise.resolve();
  }
  
  const docRef = firestore.collection(collection).doc(docId);
  return docRef.set(data);
}

/**
 * Write multiple documents in a batch operation
 * @param {Array<Object>} operations - Array of operations
 * @param {Object} options - Additional options
 * @returns {Promise<void>} - Resolution when batch is committed
 */
async function writeBatch(operations, options = {}) {
  if (operations.length === 0) {
    return Promise.resolve();
  }
  
  const firestore = getFirestore();
  
  if (options.dryRun) {
    return Promise.resolve();
  }
  
  // Firestore has a limit of 500 operations per batch
  const BATCH_LIMIT = 490;
  
  // Create batches for operations
  const batches = [];
  for (let i = 0; i < operations.length; i += BATCH_LIMIT) {
    const batch = firestore.batch();
    const operationSlice = operations.slice(i, i + BATCH_LIMIT);
    
    for (const op of operationSlice) {
      const { collection, docId, data } = op;
      const docRef = firestore.collection(collection).doc(docId);
      batch.set(docRef, data);
    }
    
    batches.push(batch);
  }
  
  // Commit all batches
  const promises = batches.map(batch => batch.commit());
  await Promise.all(promises);
}

/**
 * Create a document operation for batch processing
 * @param {string} collection - Collection name
 * @param {string} docId - Document ID
 * @param {Object} data - Document data
 * @returns {Object} - Document operation
 */
function createDocumentOperation(collection, docId, data) {
  return {
    collection,
    docId,
    data
  };
}

module.exports = {
  initializeFirestore,
  getFirestore,
  writeDocument,
  writeBatch,
  createDocumentOperation
};