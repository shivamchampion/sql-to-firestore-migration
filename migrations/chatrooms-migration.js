/**
 * Migration module for chatrooms collection
 */
const { getOrCreateUUID, getUUID } = require('../utils/uuid-mapper');
const { processBatch } = require('../utils/batch-processor');
const { DEFAULTS } = require('../config/migration-config');
const logger = require('../utils/logger');

/**
 * Migrate chatrooms from SQL to Firestore
 * @param {FirebaseFirestore.Firestore} db - Firestore instance
 * @param {Object} data - SQL data containing userchat and users tables
 * @param {Object} options - Migration options
 * @returns {Promise<Object>} - Migration result
 */
async function migrate(db, data, options = {}) {
  logger.info('Starting chatrooms migration');
  
  const { userchat = [], users = [] } = data;
  
  // Apply limit if specified
  const chatroomsToMigrate = options.limit ? userchat.slice(0, options.limit) : userchat;
  
  // Process chatrooms in batches
  const result = await processBatch(
    chatroomsToMigrate,
    async (chatroom) => transformChatroom(chatroom, { users }),
    {
      collection: 'chatrooms',
      dryRun: options.dryRun,
      label: 'Migrating chatrooms',
      batchSize: 100
    }
  );
  
  logger.info(`Chatrooms migration completed: ${result.processedCount} chatrooms processed`);
  
  return {
    collection: 'chatrooms',
    count: result.processedCount,
    errors: result.errors
  };
}

/**
 * Transform SQL chat to Firestore chatroom document
 * @param {Object} chatroom - SQL chat record
 * @param {Object} relatedData - Related data (users)
 * @returns {Object} - Firestore document operation
 */
function transformChatroom(chatroom, relatedData) {
  const { users = [] } = relatedData;
  
  // Generate a UUID for the chatroom
  const chatroomId = getOrCreateUUID('chatrooms', chatroom.id);
  
  // Get participant UUIDs
  const ownerUuid = getUUID('users', chatroom.chat_owner);
  const partnerUuid = getUUID('users', chatroom.chat_partner);
  
  // Find related users
  const owner = users.find(user => user.id === chatroom.chat_owner);
  const partner = users.find(user => user.id === chatroom.chat_partner);
  
  // Determine chatroom status
  let status = 'active';
  if (chatroom.status === 0) {
    status = 'archived';
  } else if (chatroom.status === 2) {
    status = 'blocked';
  }
  
  // Get listing reference if available
  const listingId = getUUID('listings', chatroom.type_id);
  
  // Transform chatroom data to match Firestore schema
  const firestoreChatroom = {
    id: chatroomId,
    
    // Participants
    participants: [ownerUuid, partnerUuid].filter(Boolean),
    participantDetails: [
      owner ? {
        userId: ownerUuid,
        name: owner.full_name || `${owner.f_name || ''} ${owner.l_name || ''}`.trim(),
        photo: owner.profile_image || '',
        role: owner.user_role || 'user'
      } : null,
      partner ? {
        userId: partnerUuid,
        name: partner.full_name || `${partner.f_name || ''} ${partner.l_name || ''}`.trim(),
        photo: partner.profile_image || '',
        role: partner.user_role || 'user'
      } : null
    ].filter(Boolean),
    
    // Listing reference
    listing: {
      id: listingId || null,
      name: chatroom.type_name || '',
      type: chatroom.url_type || '',
      image: ''
    },
    
    // Chatroom status
    status: status,
    
    // Last message
    lastMessage: {
      id: '',
      text: '',
      sender: '',
      timestamp: chatroom.last_action || DEFAULTS.CREATED_AT,
      type: 'text'
    },
    
    // Counters
    counters: {
      messageCount: 0,
      unreadCount: {},
      mediaCount: 0,
      offerCount: 0
    },
    
    // Activity
    activity: {
      lastActive: chatroom.last_action || DEFAULTS.CREATED_AT,
      createdBy: ownerUuid,
      pinnedBy: []
    },
    
    // Connection lifecycle
    lifecycle: {
      connectionInitiated: chatroom.created_at || DEFAULTS.CREATED_AT,
      initialResponseTime: 0,
      responseRate: 0,
      averageResponseTime: 0,
      dealStage: '',
      lastEngagement: chatroom.last_action || DEFAULTS.CREATED_AT
    },
    
    // Metadata
    metadata: {
      initiatedFrom: '',
      labels: [],
      notes: [],
      tags: []
    },
    
    // Timestamps
    createdAt: chatroom.created_at || DEFAULTS.CREATED_AT,
    updatedAt: chatroom.last_action || DEFAULTS.UPDATED_AT,
    isDeleted: chatroom.status === 2
  };
  
  return {
    docId: chatroomId,
    data: firestoreChatroom
  };
}

module.exports = {
  migrate
};