/**
 * Utility for processing data in batches
 */
const ProgressBar = require('progress');
const logger = require('./logger');
const { writeBatch, createDocumentOperation } = require('./firestore-service');

/**
 * Process array of data items in batches
 * @param {Array<any>} items - Array of items to process
 * @param {Function} processFn - Function to process each item
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - Result of batch processing
 */
async function processBatch(items, processFn, options = {}) {
  const {
    batchSize = 500,
    collection,
    dryRun = false,
    showProgress = true,
    label = 'Processing'
  } = options;
  
  if (!items || items.length === 0) {
    logger.warn('No items to process');
    return {
      processedCount: 0,
      operationsCount: 0,
      errors: [],
      operations: []
    };
  }
  
  const operations = [];
  const errors = [];
  let processedCount = 0;
  
  // Create progress bar if needed
  let progressBar;
  if (showProgress) {
    progressBar = new ProgressBar(`${label} [:bar] :current/:total (:percent) :etas`, {
      complete: '=',
      incomplete: ' ',
      width: 30,
      total: items.length
    });
  }
  
  // Process items in batches
  const batches = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  
  for (const batch of batches) {
    const batchOperations = [];
    
    for (const item of batch) {
      try {
        const result = await processFn(item);
        
        if (result) {
          if (Array.isArray(result)) {
            // If result is an array of operations, add them all
            batchOperations.push(...result);
          } else if (result.docId && result.data && collection) {
            // If result has docId and data, create an operation
            batchOperations.push(createDocumentOperation(collection, result.docId, result.data));
          } else if (result.collection && result.docId && result.data) {
            // If result has collection, docId, and data, add it directly
            batchOperations.push(result);
          }
        }
        
        processedCount++;
      } catch (error) {
        logger.error(`Error processing item: ${error.message}`);
        errors.push({
          item,
          error: error.message
        });
      }
      
      // Update progress bar
      if (progressBar) {
        progressBar.tick();
      }
    }
    
    // Add batch operations to the total operations
    operations.push(...batchOperations);
    
    // Write batch to Firestore
    if (batchOperations.length > 0 && !dryRun) {
      try {
        await writeBatch(batchOperations, { dryRun });
      } catch (error) {
        logger.error(`Error writing batch to Firestore: ${error.message}`);
        for (const op of batchOperations) {
          errors.push({
            item: { collection: op.collection, docId: op.docId },
            error: error.message
          });
        }
      }
    }
  }
  
  // Log summary
  logger.info(`Processed ${processedCount}/${items.length} items, generated ${operations.length} operations, encountered ${errors.length} errors`);
  
  return {
    processedCount,
    operationsCount: operations.length,
    errors,
    operations
  };
}

module.exports = {
  processBatch
};