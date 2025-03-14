/**
 * Migration module for messages collection
 */
const { getOrCreateUUID, getUUID } = require('../utils/uuid-mapper');
const { processBatch } = require('../utils/batch-processor');
const { DEFAULTS } = require('../config/migration-config');
const logger = require('../utils/logger');

/**
 * Migrate messages from SQL to Firestore
 * @param {FirebaseFirestore.Firestore} db - Firestore instance
 * @param {Object} data - SQL data containing messages-related tables
 * @param {Object} options - Migration options
 * @returns {Promise<Object>} - Migration result
 */
async function migrate(db, data, options = {}) {
  logger.info('Starting messages migration');
  
  const { userchat_msg = [], userchat = [], users = [], chat_files = [] } = data;
  
  // Apply limit if specified
  const messagesToMigrate = options.limit ? userchat_msg.slice(0, options.limit) : userchat_msg;
  
  // Process messages in batches
  const result = await processBatch(
    messagesToMigrate,
    async (message) => transformMessage(message, { userchat, users, chat_files }),
    {
      collection: 'messages',
      dryRun: options.dryRun,
      label: 'Migrating messages',
      batchSize: 100
    }
  );
  
  logger.info(`Messages migration completed: ${result.processedCount} messages processed`);
  
  return {
    collection: 'messages',
    count: result.processedCount,
    errors: result.errors
  };
}

/**
 * Transform SQL message to Firestore message document
 * @param {Object} message - SQL message record
 * @param {Object} relatedData - Related data (chats, users, files)
 * @returns {Object} - Firestore document operation
 */
function transformMessage(message, relatedData) {
  const { userchat = [], users = [], chat_files = [] } = relatedData;
  
  // Generate a UUID for the message
  const messageId = getOrCreateUUID('messages', message.id);
  
  // Find chatroom
  const chatroom = userchat.find(chat => chat.id === message.chat_id);
  const chatroomId = getUUID('chatrooms', message.chat_id);
  
  // Get sender and recipient UUIDs
  const senderId = getUUID('users', message.sender);
  const recipientId = getUUID('users', message.recipient);
  
  // Find related users
  const sender = users.find(user => user.id === message.sender);
  const recipient = users.find(user => user.id === message.recipient);
  
  // Find related file if message has one
  const file = message.msg_file ? chat_files.find(file => file.id === message.msg_file) : null;
  
  // Determine message type
  let messageType = 'text';
  if (message.msg_type && message.msg_type !== 'text') {
    messageType = message.msg_type;
  } else if (file) {
    // Determine file type from extension
    if (file.ext) {
      const ext = file.ext.toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
        messageType = 'image';
      } else if (['.doc', '.docx', '.pdf', '.xls', '.xlsx', '.ppt', '.pptx', '.txt'].includes(ext)) {
        messageType = 'document';
      } else if (['.mp4', '.avi', '.mov', '.wmv'].includes(ext)) {
        messageType = 'video';
      } else {
        messageType = 'file';
      }
    } else {
      messageType = 'file';
    }
  }
  
  // Determine message status
  let messageStatus = {
    sent: true,
    delivered: message.msg_status !== 2, // Not deleted
    read: message.msg_status === 0, // Read
    readAt: message.msg_status === 0 ? message.msg_date : null,
    deliveredAt: message.msg_date
  };
  
  // Get listing reference if available
  let listingRef = {
    id: null,
    name: '',
    type: ''
  };
  
  if (chatroom && chatroom.type_id && chatroom.type_name) {
    listingRef = {
      id: getUUID('listings', chatroom.type_id) || null,
      name: chatroom.type_name || '',
      type: chatroom.url_type || ''
    };
  }
  
  // Transform message data to match Firestore schema
  const firestoreMessage = {
    id: messageId,
    chatroomId: chatroomId,
    sender: senderId,
    senderName: sender ? sender.full_name || `${sender.f_name || ''} ${sender.l_name || ''}`.trim() : '',
    recipient: recipientId,
    recipientName: recipient ? recipient.full_name || `${recipient.f_name || ''} ${recipient.l_name || ''}`.trim() : '',
    
    // Message content
    content: {
      text: message.msg_text || '',
      type: messageType,
      isForwarded: false,
      quotedMessage: null,
      mentions: [],
      links: []
    },
    
    // Message status
    status: messageStatus,
    
    // Rich content
    attachments: file ? [{
      type: messageType,
      url: file.path || '',
      name: file.filename || '',
      size: parseInt(file.size, 10) || 0,
      mimeType: '',
      previewUrl: ''
    }] : [],
    
    // Reference to listing
    listing: listingRef,
    
    // Message metadata
    metadata: {
      deviceInfo: '',
      ipAddress: '',
      location: '',
      clientVersion: ''
    },
    
    // Moderation
    moderation: {
      flagged: false,
      flagReason: '',
      moderationStatus: '',
      moderatedBy: '',
      moderatedAt: null
    },
    
    // Timestamps
    createdAt: message.msg_date || DEFAULTS.CREATED_AT,
    updatedAt: message.msg_date || DEFAULTS.CREATED_AT,
    isDeleted: message.msg_status === 2 // Deleted
  };
  
  return {
    docId: messageId,
    data: firestoreMessage
  };
}

module.exports = {
  migrate
};