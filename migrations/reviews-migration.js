/**
 * Migration module for reviews collection
 */
const { getOrCreateUUID, getUUID } = require('../utils/uuid-mapper');
const { processBatch } = require('../utils/batch-processor');
const { DEFAULTS } = require('../config/migration-config');
const logger = require('../utils/logger');

/**
 * Migrate reviews from SQL to Firestore
 * @param {FirebaseFirestore.Firestore} db - Firestore instance
 * @param {Object} data - SQL data containing comments table
 * @param {Object} options - Migration options
 * @returns {Promise<Object>} - Migration result
 */
async function migrate(db, data, options = {}) {
  logger.info('Starting reviews migration');
  
  const { comments = [] } = data;
  
  // Apply limit if specified
  const reviewsToMigrate = options.limit ? comments.slice(0, options.limit) : comments;
  
  // Process reviews in batches
  const result = await processBatch(
    reviewsToMigrate,
    async (review) => transformReview(review),
    {
      collection: 'reviews',
      dryRun: options.dryRun,
      label: 'Migrating reviews',
      batchSize: 100
    }
  );
  
  logger.info(`Reviews migration completed: ${result.processedCount} reviews processed`);
  
  return {
    collection: 'reviews',
    count: result.processedCount,
    errors: result.errors
  };
}

/**
 * Transform SQL comment/review to Firestore review document
 * @param {Object} review - SQL review record
 * @returns {Object} - Firestore document operation
 */
function transformReview(review) {
  // Generate a UUID for the review
  const reviewId = getOrCreateUUID('reviews', review.id);
  
  // Get listing UUID if available (article_id in comments maps to listing ID)
  const listingId = getUUID('listings', review.article_id) || null;
  
  // If no listing ID is found, this might be a comment on an article, not a review
  if (!listingId) {
    logger.warn(`Review ${review.id} has no corresponding listing ID (article_id=${review.article_id})`);
  }
  
  // Transform review data to match Firestore schema
  const firestoreReview = {
    id: reviewId,
    listingId: listingId,
    userId: null, // Anonymous review
    
    // Rating
    rating: 0, // Not available in original data
    verification: {
      verified: false,
      verificationType: '',
      verificationDate: null
    },
    
    // Review content
    content: {
      title: '',
      text: review.message || '',
      pros: [],
      cons: [],
      recommendation: true,
      experience: '',
      photos: [],
      media: []
    },
    
    // User metadata
    author: {
      name: review.name || 'Anonymous',
      photo: '',
      verified: false,
      previousReviews: 0,
      location: ''
    },
    
    // Transaction details
    transaction: {
      date: null,
      type: '',
      amount: { amount: 0, currency: 'INR' }
    },
    
    // Visibility & moderation
    visibility: {
      isPublic: review.status === 1,
      featured: false,
      status: review.status === 1 ? 'live' : 'pending',
      moderationNotes: '',
      moderatedBy: 'system',
      moderatedAt: review.doc || DEFAULTS.CREATED_AT
    },
    
    // Community engagement
    engagement: {
      helpfulCount: 0,
      unhelpfulCount: 0,
      reportCount: 0,
      reportReasons: [],
      commentCount: 0
    },
    
    // Owner response
    ownerResponse: {
      text: '',
      respondedBy: '',
      respondedAt: null,
      edited: false,
      editedAt: null
    },
    
    // Update history
    history: {
      originalRating: 0,
      originalText: review.message || '',
      editCount: 0,
      lastEditedAt: null
    },
    
    // Timestamps
    createdAt: review.doc || DEFAULTS.CREATED_AT,
    updatedAt: review.doc || DEFAULTS.CREATED_AT,
    isDeleted: false
  };
  
  return {
    docId: reviewId,
    data: firestoreReview
  };
}

module.exports = {
  migrate
};